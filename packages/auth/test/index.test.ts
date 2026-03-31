import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearCallbackParams,
  createPkceBundle,
  createSignInUrl,
  decodeIdentityClaims,
  getIdentity,
  persistIdentity,
  clearIdentity,
  parseCallback,
  isCallbackRoute,
  defaults,
  createAvsAuth,
  startSessionMonitor,
  checkSession
} from "../src/index";

// Mock localStorage
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => storage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete storage[key]; })
};

beforeEach(() => {
  Object.keys(storage).forEach((key) => delete storage[key]);
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal("window", { location: { href: "http://localhost", origin: "http://localhost", pathname: "/" } });
  vi.stubGlobal("history", { replaceState: vi.fn() });
});

// Helper: build a fake JWT with given claims
function fakeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.fake-sig`;
}

describe("@avs-auth/auth", () => {
  // --- PKCE ---
  it("creates a PKCE bundle with S256 challenge material", async () => {
    const bundle = await createPkceBundle();
    expect(bundle.state.length).toBeGreaterThan(20);
    expect(bundle.verifier.length).toBeGreaterThan(40);
    expect(bundle.challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("generates unique PKCE bundles", async () => {
    const a = await createPkceBundle();
    const b = await createPkceBundle();
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });

  // --- Sign-in URL ---
  it("creates an authorize URL with derived query parameters", () => {
    const url = new URL(
      createSignInUrl({
        avsBaseUrl: "https://auth.adityavs.tech",
        redirectUri: "https://app.example.com/auth/callback",
        state: "state-123",
        codeChallenge: "challenge-123",
        requestPii: true
      })
    );
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe("origin:https://app.example.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/auth/callback");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("pii")).toBe("true");
  });

  it("creates authorize URL without pii param when not requested", () => {
    const url = new URL(
      createSignInUrl({
        avsBaseUrl: "https://auth.adityavs.tech",
        redirectUri: "https://app.example.com/callback",
        state: "s",
        codeChallenge: "c"
      })
    );
    expect(url.searchParams.get("pii")).toBeNull();
  });

  it("allows overriding clientId", () => {
    const url = new URL(
      createSignInUrl({
        avsBaseUrl: "https://auth.adityavs.tech",
        redirectUri: "https://app.example.com/callback",
        clientId: "origin:https://custom.com",
        state: "s",
        codeChallenge: "c"
      })
    );
    expect(url.searchParams.get("client_id")).toBe("origin:https://custom.com");
  });

  // --- Callback parsing ---
  it("parses callback parameters", () => {
    expect(parseCallback("https://app.example.com/auth/callback?code=demo-code&state=demo-state")).toEqual({
      code: "demo-code",
      state: "demo-state"
    });
  });

  it("returns null when no code or state", () => {
    expect(parseCallback("https://app.example.com/callback")).toBeNull();
  });

  it("clears callback params from URL", () => {
    expect(clearCallbackParams("https://app.example.com/auth/callback?code=demo-code&state=demo-state&error=ignored")).toBe(
      "https://app.example.com/auth/callback"
    );
  });

  // --- Identity persistence ---
  it("persists and retrieves identity", () => {
    persistIdentity("user-1", "token-abc", undefined, { expiresIn: 300 });
    const identity = getIdentity();
    expect(identity.userId).toBe("user-1");
    expect(identity.token).toBe("token-abc");
    expect(identity.expiresIn).toBe(300);
    expect(identity.receivedAt).toBeGreaterThan(0);
  });

  it("returns empty identity when nothing stored", () => {
    const identity = getIdentity();
    expect(identity.userId).toBeNull();
    expect(identity.token).toBeUndefined();
  });

  it("clears identity", () => {
    persistIdentity("user-1", "token");
    clearIdentity();
    const identity = getIdentity();
    expect(identity.userId).toBeNull();
  });

  it("supports custom storage key", () => {
    persistIdentity("user-1", "token", "custom_key");
    expect(getIdentity("custom_key").userId).toBe("user-1");
    expect(getIdentity().userId).toBeNull();
  });

  // --- JWT decode ---
  it("decodes ID token claims without verification", () => {
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://auth.adityavs.tech",
        aud: "origin:https://app.example.com",
        sub: "ps_123",
        pairwise_sub: "ps_123",
        iat: 1, exp: 2, jti: "jti-123"
      })
    ).toString("base64url");
    const token = `header.${payload}.signature`;
    const claims = decodeIdentityClaims(token);
    expect(claims?.pairwise_sub).toBe("ps_123");
    expect(claims?.iss).toBe("https://auth.adityavs.tech");
  });

  it("returns null for invalid token", () => {
    expect(decodeIdentityClaims("not-a-jwt")).toBeNull();
    expect(decodeIdentityClaims(undefined)).toBeNull();
  });

  // --- Callback route matching ---
  it("matches the configured callback route", () => {
    expect(isCallbackRoute("/auth/callback", "/auth/callback")).toBe(true);
    expect(isCallbackRoute("/auth/callback", "/")).toBe(false);
  });

  it("matches the default callback path", () => {
    expect(isCallbackRoute("/avs-auth/callback", "/avs-auth/callback")).toBe(true);
  });

  // --- Defaults ---
  it("exposes defaults object", () => {
    expect(defaults.avsBaseUrl).toBe("https://auth.adityavs.tech");
    expect(defaults.callbackPath).toBe("/avs-auth/callback");
    expect(defaults.storageKey).toBe("avs_auth_identity");
    expect(defaults.sessionMonitorIntervalMs).toBe(60000);
  });

  // --- finishSignIn ---
  it("finishSignIn throws when PKCE is expired", async () => {
    const sessionStorageMock: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((k: string) => sessionStorageMock[k] ?? null),
      setItem: vi.fn((k: string, v: string) => { sessionStorageMock[k] = v; }),
      removeItem: vi.fn((k: string) => { delete sessionStorageMock[k]; })
    });
    const expiredCreatedAt = Date.now() - 11 * 60 * 1000;
    sessionStorageMock["avs_auth_pkce"] = JSON.stringify({
      state: "test-state",
      verifier: "test-verifier",
      createdAt: expiredCreatedAt
    });
    vi.stubGlobal("window", {
      location: { href: "http://localhost/avs-auth/callback?code=test-code&state=test-state", origin: "http://localhost", pathname: "/avs-auth/callback" }
    });
    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    await expect(client.finishSignIn()).rejects.toThrow("PKCE verifier expired");
  });

  it("finishSignIn throws on state mismatch", async () => {
    const sessionStorageMock: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((k: string) => sessionStorageMock[k] ?? null),
      setItem: vi.fn((k: string, v: string) => { sessionStorageMock[k] = v; }),
      removeItem: vi.fn((k: string) => { delete sessionStorageMock[k]; })
    });
    sessionStorageMock["avs_auth_pkce"] = JSON.stringify({
      state: "stored-state",
      verifier: "test-verifier",
      createdAt: Date.now()
    });
    vi.stubGlobal("window", {
      location: { href: "http://localhost/avs-auth/callback?code=test-code&state=different-state", origin: "http://localhost", pathname: "/avs-auth/callback" }
    });
    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    await expect(client.finishSignIn()).rejects.toThrow("State mismatch");
  });

  it("finishSignIn returns null when no callback params in URL", async () => {
    const sessionStorageMock: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((k: string) => sessionStorageMock[k] ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    });
    vi.stubGlobal("window", {
      location: { href: "http://localhost/", origin: "http://localhost", pathname: "/" }
    });
    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.finishSignIn();
    expect(result).toBeNull();
  });

  it("finishSignIn completes successfully with valid PKCE and mocked token exchange", async () => {
    const sessionStorageMock: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((k: string) => sessionStorageMock[k] ?? null),
      setItem: vi.fn((k: string, v: string) => { sessionStorageMock[k] = v; }),
      removeItem: vi.fn((k: string) => { delete sessionStorageMock[k]; })
    });
    sessionStorageMock["avs_auth_pkce"] = JSON.stringify({
      state: "valid-state",
      verifier: "valid-verifier",
      createdAt: Date.now()
    });
    vi.stubGlobal("window", {
      location: { href: "http://localhost/avs-auth/callback?code=valid-code&state=valid-state", origin: "http://localhost", pathname: "/avs-auth/callback" },
      location_replace: vi.fn()
    });
    const mockToken = {
      id_token: fakeToken({ sub: "ps_123", aud: "origin:http://localhost", iss: "https://auth.adityavs.tech", iat: 1, exp: 999999999, jti: "jti1", pairwise_sub: "ps_123" }),
      pairwise_sub: "ps_123",
      token_type: "Bearer",
      expires_in: 300
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockToken)
    }));
    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.finishSignIn();
    expect(result).not.toBeNull();
    expect(result?.id_token).toBeTruthy();
    expect(result?.pairwise_sub).toBe("ps_123");
    const identity = getIdentity();
    expect(identity.userId).toBe("ps_123");
  });
});

// --- checkSession (Shoo parity) ---
describe("checkSession - Shoo parity", () => {
  it("returns login_required when no token is stored", async () => {
    const result = await checkSession();
    expect(result).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  it("pre-validates token aud when clientId is provided", async () => {
    const token = fakeToken({ sub: "ps_1", aud: "origin:https://app.example.com", iss: "test", iat: 1, exp: 99999999999 });
    persistIdentity("user-1", token);
    // clientId does not match token aud
    const result = await checkSession({ clientId: "origin:https://different.com" });
    expect(result).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  it("pre-validates token aud when redirectUri is provided", async () => {
    const token = fakeToken({ sub: "ps_1", aud: "origin:https://app.example.com", iss: "test", iat: 1, exp: 99999999999 });
    persistIdentity("user-1", token);
    // redirectUri derives clientId that does not match
    const result = await checkSession({ redirectUri: "https://different.com/callback" });
    expect(result).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  it("passes aud check when clientId matches token aud", async () => {
    const token = fakeToken({ sub: "ps_1", aud: "origin:https://app.example.com", iss: "test", iat: 1, exp: 99999999999 });
    persistIdentity("user-1", token);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "active" })
    }));
    const result = await checkSession({ clientId: "origin:https://app.example.com", avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "active" });
  });

  it("strictly parses 200 response - returns active for valid payload", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "active" })
    }));
    const result = await checkSession({ avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "active" });
  });

  it("strictly parses 200 response - throws on invalid success payload", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "something_else" })
    }));
    await expect(checkSession({ avsBaseUrl: "https://auth.adityavs.tech" })).rejects.toThrow(
      "Session check returned an invalid success payload"
    );
  });

  it("strictly parses 401 response with valid reason", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ status: "login_required", reason: "revoked" })
    }));
    const result = await checkSession({ avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "login_required", reason: "revoked" });
  });

  it("falls back to invalid_token on malformed 401 payload", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ error: "bad_response" })
    }));
    const result = await checkSession({ avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  it("falls back to invalid_token on 401 with unknown reason", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ status: "login_required", reason: "unknown_reason" })
    }));
    const result = await checkSession({ avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  it("returns unsupported for 404", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    const result = await checkSession({ avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "unsupported" });
  });

  it("returns unsupported for 501", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 501 }));
    const result = await checkSession({ avsBaseUrl: "https://auth.adityavs.tech" });
    expect(result).toEqual({ status: "unsupported" });
  });

  it("throws on unexpected status codes", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500 }));
    await expect(checkSession({ avsBaseUrl: "https://auth.adityavs.tech" })).rejects.toThrow(
      "Session check failed (500)"
    );
  });

  it("throws on 403", async () => {
    persistIdentity("user-1", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 403 }));
    await expect(checkSession({ avsBaseUrl: "https://auth.adityavs.tech" })).rejects.toThrow(
      "Session check failed (403)"
    );
  });
});

// --- startSessionMonitor (Shoo parity) ---
describe("startSessionMonitor - Shoo parity", () => {
  it("calls onLoginRequired when session check returns login_required", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { href: "http://localhost", origin: "http://localhost", pathname: "/" },
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: any) => clearInterval(id)
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ status: "login_required", reason: "revoked" })
    }));
    persistIdentity("user-1", "test-token");

    const onLoginRequired = vi.fn();
    const handle = startSessionMonitor({
      intervalMs: 5000,
      immediate: false,
      onLoginRequired
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(onLoginRequired).toHaveBeenCalledWith(expect.objectContaining({ status: "login_required" }));
    handle.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stop() prevents further checks", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { href: "http://localhost", origin: "http://localhost", pathname: "/" },
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: any) => clearInterval(id)
    });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "active" })
    });
    vi.stubGlobal("fetch", fetchMock);
    persistIdentity("user-1", "test-token");

    const handle = startSessionMonitor({ intervalMs: 1000, immediate: false });
    handle.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("auto-stops after first login_required (Shoo parity)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { href: "http://localhost", origin: "http://localhost", pathname: "/" },
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: any) => clearInterval(id)
    });
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        status: 401,
        json: () => Promise.resolve({ status: "login_required", reason: "revoked" })
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    persistIdentity("user-1", "test-token");

    const onLoginRequired = vi.fn();
    startSessionMonitor({
      intervalMs: 1000,
      immediate: false,
      onLoginRequired
    });

    // First interval: triggers check, gets login_required, auto-stops
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLoginRequired).toHaveBeenCalledTimes(1);

    // Additional intervals: monitor should be stopped, no more fetches
    await vi.advanceTimersByTimeAsync(5000);
    expect(onLoginRequired).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("continues polling when session is active", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      location: { href: "http://localhost", origin: "http://localhost", pathname: "/" },
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: any) => clearInterval(id)
    });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "active" })
    });
    vi.stubGlobal("fetch", fetchMock);
    persistIdentity("user-1", "test-token");

    const handle = startSessionMonitor({ intervalMs: 1000, immediate: false });

    // Advance through 3 intervals
    await vi.advanceTimersByTimeAsync(3500);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    handle.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
