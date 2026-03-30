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
