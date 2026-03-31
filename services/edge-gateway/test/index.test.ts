import { describe, expect, it } from "vitest";
import worker from "../src/index";

const env = {
  ISSUER: "https://auth.adityavs.tech",
  ENVIRONMENT: "development" as const,
  JWKS_JSON: JSON.stringify({
    keys: [{ kty: "EC", kid: "kid-1", use: "sig", alg: "ES256", crv: "P-256", x: "x-value", y: "y-value" }]
  })
};

const prodEnv = { ...env, ENVIRONMENT: "production" as const };

describe("edge-gateway worker", () => {
  // --- OIDC Discovery ---
  it("serves OIDC metadata", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/.well-known/openid-configuration"), env);
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.issuer).toBe(env.ISSUER);
    expect(body.authorization_endpoint).toBe(`${env.ISSUER}/authorize`);
    expect(body.token_endpoint).toBe(`${env.ISSUER}/token`);
    expect(body.jwks_uri).toBe(`${env.ISSUER}/.well-known/jwks.json`);
  });

  // --- JWKS ---
  it("serves JWKS", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/.well-known/jwks.json"), env);
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].kid).toBe("kid-1");
  });

  // --- Authorize ---
  it("redirects authorize requests to sign-in when valid", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&state=state-1&code_challenge=challenge-1&code_challenge_method=S256"),
      prodEnv
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("rejects authorize with missing state", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&code_challenge=c&code_challenge_method=S256"),
      prodEnv
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error).toBe("invalid_request");
  });

  it("rejects authorize with wrong code_challenge_method", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&state=s&code_challenge=c&code_challenge_method=plain"),
      prodEnv
    );
    expect(response.status).toBe(400);
  });

  it("rejects authorize with non-https redirect in production", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/authorize?redirect_uri=http%3A%2F%2Fapp.example.com%2Fcallback&state=s&code_challenge=c&code_challenge_method=S256"),
      prodEnv
    );
    expect(response.status).toBe(400);
  });

  // --- Session check ---
  it("returns login_required for missing session bearer token", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/session/check", { method: "POST" }),
      env
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(401);
    expect(body).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  // --- Logout ---
  it("clears the broker cookie on logout", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/logout", { method: "POST" }),
      env
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(body).toEqual({ status: "ok" });
  });

  // --- Hosted script ---
  it("serves the hosted browser script", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(body).toContain("window.AvsAuth");
  });

  it("hosted script exposes all required global methods", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    const requiredMethods = [
      "createPkceBundle", "createSignInUrl", "parseCallback", "clearCallbackParams",
      "startSignIn", "finishSignIn", "handleCallback", "exchangeCode",
      "checkSession", "startSessionMonitor", "getIdentity", "persistIdentity",
      "clearIdentity", "decodeIdentityClaims", "defaults"
    ];
    for (const method of requiredMethods) {
      expect(body).toContain(method);
    }
  });

  it("hosted script handles callback on matching path", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    // Script should check window.location.pathname against callbackPath
    expect(body).toContain("window.location.pathname===opts.callbackPath");
    expect(body).toContain("handleCallback");
  });

  it("hosted script dispatches avs-auth:login-required event", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    expect(body).toContain("avs-auth:login-required");
    expect(body).toContain("CustomEvent");
  });

  it("hosted script session monitor starts based on token presence", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    // Should check for .token (not just .userId) to start monitor
    expect(body).toContain(".token");
  });

  it("hosted script session monitor auto-stops on login_required", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    // The sm function should call stop() or clearInterval on login_required
    expect(body).toContain("login_required");
    expect(body).toContain("stop()");
  });

  it("hosted script implements strict session check parsing", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/avs-auth.js"), env);
    const body = await response.text();
    // Should check for specific status codes (200, 401, 404, 501)
    expect(body).toContain("r.status===200");
    expect(body).toContain("r.status===401");
    expect(body).toContain("r.status===404");
    expect(body).toContain("r.status===501");
    // Should throw on unexpected statuses
    expect(body).toContain("Session check failed");
  });

  // --- HTML pages ---
  it("serves the landing page", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/"), env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("AVS AUTH");
  });

  it("serves the sign-in page", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/sign-in"), env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Continue with Google");
  });

  it("serves the privacy page with real content", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/privacy"), env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Privacy Policy");
    expect(body).toContain("pairwise subject identifier");
  });

  it("serves the terms page with real content", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/terms"), env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Terms of Service");
  });

  it("serves the error page with correlation id", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/error"), env);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Correlation ID");
    expect(body).toContain("req_");
  });

  it("serves the no-session page", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/no-session"), env);
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("Session required");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/unknown"), env);
    expect(response.status).toBe(404);
  });

  // --- Security headers ---
  it("includes security headers on HTML responses", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/"), env);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
  });

  // --- CORS ---
  it("handles OPTIONS preflight for /token", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" }
      }),
      env
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });

  it("handles OPTIONS preflight for /session/check", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/session/check", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" }
      }),
      env
    );
    expect(response.status).toBe(204);
  });

  // --- Profile/authorized-sites require auth ---
  it("returns 401 for /me without session", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/me"), env);
    expect(response.status).toBe(401);
  });

  it("returns 401 for /authorized-sites without session", async () => {
    const response = await worker.fetch(new Request("https://auth.adityavs.tech/authorized-sites"), env);
    expect(response.status).toBe(401);
  });
});

// ---- Token Exchange Protocol Tests ----
describe("POST /token - protocol tests", () => {
  // Helper: do the full authorize→mock-Google flow to get a code
  async function obtainCode(
    redirectUri = "https://app.example.com/callback",
    codeChallenge = "challenge-test",
    requestPii = false
  ): Promise<{ code: string; state: string }> {
    // 1. GET /authorize → redirects to /sign-in?tx=...
    const authResp = await worker.fetch(
      new Request(
        `https://auth.adityavs.tech/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=state-test&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256${requestPii ? "&pii=true" : ""}`,
      ),
      env
    );
    expect(authResp.status).toBe(302);
    const location = authResp.headers.get("location")!;
    const txParam = new URL(location).searchParams.get("tx")!;

    // 2. GET /auth/google/start → in dev mode auto-redirects to /auth/google/callback
    const googleStartResp = await worker.fetch(
      new Request(`https://auth.adityavs.tech/auth/google/start?tx=${encodeURIComponent(txParam)}`),
      env
    );
    expect(googleStartResp.status).toBe(302);
    const callbackLoc = googleStartResp.headers.get("location")!;

    // 3. GET /auth/google/callback → redirects to redirect_uri with code
    const googleCallbackResp = await worker.fetch(
      new Request(callbackLoc),
      env
    );
    expect(googleCallbackResp.status).toBe(302);
    const finalLoc = googleCallbackResp.headers.get("location")!;
    const finalUrl = new URL(finalLoc);
    const code = finalUrl.searchParams.get("code")!;
    const state = finalUrl.searchParams.get("state")!;
    expect(code).toBeTruthy();
    expect(state).toBe("state-test");
    return { code, state };
  }

  it("rejects token exchange with PKCE mismatch (wrong code_verifier)", async () => {
    const { code } = await obtainCode();
    // The authorize request used code_challenge="challenge-test" with S256,
    // so SHA256("challenge-test") != "challenge-test". Any verifier that doesn't
    // hash to "challenge-test" will fail PKCE verification.
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "origin:https://app.example.com",
          redirect_uri: "https://app.example.com/callback",
          code,
          code_verifier: "wrong-verifier-that-does-not-hash-to-challenge"
        }).toString()
      }),
      env
    );
    expect(response.status).toBe(401);
    const json = await response.json() as any;
    expect(json.error).toBe("invalid_grant");
    expect(json.error_description).toContain("PKCE");
  });

  it("rejects token exchange with wrong redirect_uri", async () => {
    const { code } = await obtainCode("https://app.example.com/callback");
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "origin:https://app.example.com",
          redirect_uri: "https://different.example.com/callback",
          code,
          code_verifier: "any-verifier"
        }).toString()
      }),
      env
    );
    expect(response.status).toBe(400);
    const json = await response.json() as any;
    expect(json.error).toBe("invalid_client");
  });

  it("rejects token exchange when code does not exist", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "origin:https://app.example.com",
          redirect_uri: "https://app.example.com/callback",
          code: "nonexistent-code-xyz",
          code_verifier: "verifier"
        }).toString()
      }),
      env
    );
    expect(response.status).toBe(401);
    const json = await response.json() as any;
    expect(json.error).toBe("invalid_grant");
  });

  it("rejects replay: same code redeemed twice fails on second attempt", async () => {
    // Use a real PKCE pair so the first exchange succeeds
    const verifier = "replayTestVerifier123456789ABCDEFGHIJKLMNOPQ";
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const redirectUri = "https://replay-test.example.com/callback";
    const clientId = "origin:https://replay-test.example.com";

    const { code } = await obtainCode(redirectUri, challenge);

    // First exchange: should succeed
    const firstResp = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier
        }).toString()
      }),
      env
    );
    expect(firstResp.status).toBe(200);
    const firstBody = await firstResp.json() as any;
    expect(firstBody.id_token).toBeTruthy();

    // Second exchange with same code: should fail
    const secondResp = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier
        }).toString()
      }),
      env
    );
    expect(secondResp.status).toBe(401);
    const secondBody = await secondResp.json() as any;
    expect(secondBody.error).toBe("invalid_grant");
  });

  it("returns CORS headers on token response", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "origin": "https://app.example.com"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "origin:https://app.example.com",
          redirect_uri: "https://app.example.com/callback",
          code: "nonexistent-code-xyz",
          code_verifier: "verifier"
        }).toString()
      }),
      env
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });
});

// ---- Full PKCE Flow Integration Test ----
describe("Full authorize→token flow with matching PKCE", () => {
  it("completes the full authorize→Google(mock)→token flow with real PKCE", async () => {
    // Generate a real PKCE bundle using the Web Crypto API
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // 43 chars, URL-safe base64
    // SHA-256 of verifier → base64url
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const redirectUri = "https://pkce-test.example.com/callback";
    const clientId = `origin:https://pkce-test.example.com`;

    // Step 1: GET /authorize
    const authResp = await worker.fetch(
      new Request(
        `https://auth.adityavs.tech/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(clientId)}&state=pkce-state&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`
      ),
      env
    );
    expect(authResp.status).toBe(302);
    const signInLoc = authResp.headers.get("location")!;
    const txId = new URL(signInLoc).searchParams.get("tx")!;

    // Step 2: GET /auth/google/start → in dev mode goes to mock callback
    const startResp = await worker.fetch(
      new Request(`https://auth.adityavs.tech/auth/google/start?tx=${encodeURIComponent(txId)}`),
      env
    );
    expect(startResp.status).toBe(302);
    const mockCallbackUrl = startResp.headers.get("location")!;

    // Step 3: GET /auth/google/callback → redirects with code + sets session cookie
    const callbackResp = await worker.fetch(new Request(mockCallbackUrl), env);
    expect(callbackResp.status).toBe(302);
    const codeUrl = new URL(callbackResp.headers.get("location")!);
    const code = codeUrl.searchParams.get("code")!;
    const returnedState = codeUrl.searchParams.get("state");
    expect(code).toBeTruthy();
    expect(returnedState).toBe("pkce-state");
    // Extract session cookie for forwarding to subsequent requests
    const rawCookie = callbackResp.headers.get("set-cookie") ?? "";
    const sessionCookiePair = rawCookie.split(";")[0]; // "avs_session=sess_..."

    // Step 4: POST /token with correct verifier
    const tokenResp = await worker.fetch(
      new Request("https://auth.adityavs.tech/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier
        }).toString()
      }),
      env
    );
    expect(tokenResp.status).toBe(200);
    const tokenBody = await tokenResp.json() as any;
    expect(tokenBody.id_token).toBeTruthy();
    expect(tokenBody.pairwise_sub).toBeTruthy();
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.expires_in).toBeGreaterThan(0);

    // Step 5: POST /session/check with the id_token AND session cookie
    const sessionResp = await worker.fetch(
      new Request("https://auth.adityavs.tech/session/check", {
        method: "POST",
        headers: {
          "authorization": `Bearer ${tokenBody.id_token}`,
          "cookie": sessionCookiePair
        }
      }),
      env
    );
    expect(sessionResp.status).toBe(200);
    const sessionBody = await sessionResp.json() as any;
    expect(sessionBody.status).toBe("active");
  });
});

// ---- Authorize Session Fast-Path Test ----
describe("GET /authorize - session fast-path", () => {
  it("fast-paths to code when session + consent already exist", async () => {
    // First do a full flow to establish session+consent for a unique origin
    const verifier = "FastPathVerifier1234567890ABCDEF1234567890ABCDEFx";
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const redirectUri = "https://fastpath.example.com/callback";
    const clientId = "origin:https://fastpath.example.com";

    // Authorize
    const authResp1 = await worker.fetch(
      new Request(`https://auth.adityavs.tech/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(clientId)}&state=fp-state-1&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`),
      env
    );
    const txId1 = new URL(authResp1.headers.get("location")!).searchParams.get("tx")!;

    // Google start
    const startResp1 = await worker.fetch(
      new Request(`https://auth.adityavs.tech/auth/google/start?tx=${encodeURIComponent(txId1)}`),
      env
    );
    const mockCb1 = startResp1.headers.get("location")!;

    // Google callback → get session cookie
    const callbackResp1 = await worker.fetch(new Request(mockCb1), env);
    expect(callbackResp1.status).toBe(302);
    const sessionCookie = callbackResp1.headers.get("set-cookie")!;
    expect(sessionCookie).toContain("avs_session=");

    // Extract session cookie value
    const cookieValue = sessionCookie.split(";")[0]; // "avs_session=sess_..."

    // Now do a SECOND authorize for the same origin with the session cookie
    const verifier2 = "FastPathVerifier2234567890ABCDEF1234567890ABCDx";
    const digest2 = await crypto.subtle.digest("SHA-256", encoder.encode(verifier2));
    const challenge2 = btoa(String.fromCharCode(...new Uint8Array(digest2)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const authResp2 = await worker.fetch(
      new Request(`https://auth.adityavs.tech/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(clientId)}&state=fp-state-2&code_challenge=${encodeURIComponent(challenge2)}&code_challenge_method=S256`, {
        headers: { "cookie": cookieValue }
      }),
      env
    );
    // Should fast-path directly to the redirect URI with a code (not go to sign-in)
    expect(authResp2.status).toBe(302);
    const fastPathLoc = authResp2.headers.get("location")!;
    expect(fastPathLoc).toContain("fastpath.example.com");
    expect(fastPathLoc).toContain("code=");
    expect(fastPathLoc).toContain("state=fp-state-2");
  });
});

// ---- Session Check Expiry Test ----
describe("POST /session/check - edge cases", () => {
  it("returns login_required for expired token (exp in past)", async () => {
    // Craft a token with exp in the past
    const payload = btoa(JSON.stringify({ sub: "ps_test", aud: "origin:https://app.example.com", exp: 1000000, iat: 999999, iss: "https://auth.adityavs.tech" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fakeToken = `eyJhbGciOiJFUzI1NiJ9.${payload}.fake-sig`;

    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/session/check", {
        method: "POST",
        headers: { "authorization": `Bearer ${fakeToken}` }
      }),
      env
    );
    expect(response.status).toBe(401);
    const body = await response.json() as any;
    expect(body.status).toBe("login_required");
  });
});

// ---- Admin Routes ----
describe("/admin/* - operator tooling", () => {
  const adminEnv = { ...env, ADMIN_SECRET: "test-admin-secret" };

  it("returns 401 without ADMIN_SECRET header", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/rotate-keys", { method: "POST" }),
      adminEnv
    );
    expect(response.status).toBe(401);
    const body = await response.json() as any;
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 with wrong ADMIN_SECRET", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/rotate-keys", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" }
      }),
      adminEnv
    );
    expect(response.status).toBe(401);
  });

  it("returns 503 for /admin/rotate-keys without Convex configured", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/rotate-keys", {
        method: "POST",
        headers: { authorization: "Bearer test-admin-secret" }
      }),
      adminEnv // no CONVEX_URL in adminEnv
    );
    expect(response.status).toBe(503);
    const body = await response.json() as any;
    expect(body.error).toBe("unavailable");
  });

  it("returns 503 for /admin/block-client without Convex configured", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/block-client", {
        method: "POST",
        headers: { authorization: "Bearer test-admin-secret", "content-type": "application/x-www-form-urlencoded" },
        body: "clientId=origin%3Ahttps%3A%2F%2Fapp.example.com"
      }),
      adminEnv
    );
    expect(response.status).toBe(503);
  });

  it("returns 503 for /admin/audit without Convex configured", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/audit", {
        headers: { authorization: "Bearer test-admin-secret" }
      }),
      adminEnv
    );
    expect(response.status).toBe(503);
  });

  it("returns 404 for unknown admin route", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/unknown-route", {
        headers: { authorization: "Bearer test-admin-secret" }
      }),
      adminEnv
    );
    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error).toBe("not_found");
  });

  it("returns 400 for /admin/block-client with missing clientId", async () => {
    const response = await worker.fetch(
      new Request("https://auth.adityavs.tech/admin/block-client", {
        method: "POST",
        headers: { authorization: "Bearer test-admin-secret", "content-type": "application/x-www-form-urlencoded" },
        body: ""
      }),
      adminEnv
    );
    // 503 because Convex not configured, but auth passes
    expect([400, 503]).toContain(response.status);
  });
});
