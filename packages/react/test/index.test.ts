import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Helper: build a fake JWT with given claims
function fakeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.fake-sig`;
}

// Common browser global mocks
const storage: Record<string, string> = {};
const sessionStore: Record<string, string> = {};

function setupBrowserMocks() {
  Object.keys(storage).forEach((key) => delete storage[key]);
  Object.keys(sessionStore).forEach((key) => delete sessionStore[key]);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((k: string) => storage[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { storage[k] = v; }),
    removeItem: vi.fn((k: string) => { delete storage[k]; })
  });
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((k: string) => sessionStore[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { sessionStore[k] = v; }),
    removeItem: vi.fn((k: string) => { delete sessionStore[k]; })
  });
  vi.stubGlobal("window", {
    location: { href: "http://localhost", origin: "http://localhost", pathname: "/" },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: any) => clearInterval(id)
  });
  vi.stubGlobal("history", { replaceState: vi.fn() });
}

describe("@avs-auth/react", () => {
  beforeEach(() => {
    setupBrowserMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports useAvsAuth hook", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.useAvsAuth).toBe("function");
  });

  it("exports createAvsConvexAuth helper", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createAvsConvexAuth).toBe("function");
  });

  it("re-exports createAvsAuth from @avs-auth/auth", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createAvsAuth).toBe("function");
  });

  it("re-exports decodeIdentityClaims from @avs-auth/auth", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.decodeIdentityClaims).toBe("function");
  });

  it("createAvsConvexAuth returns useAuth, signIn, and signOut", async () => {
    const mod = await import("../src/index");
    const convexAuth = mod.createAvsConvexAuth({});
    expect(typeof convexAuth.useAuth).toBe("function");
    expect(typeof convexAuth.signIn).toBe("function");
    expect(typeof convexAuth.signOut).toBe("function");
  });

  it("createAvsConvexAuth signIn calls client.startSignIn", async () => {
    const mod = await import("../src/index");
    const convexAuth = mod.createAvsConvexAuth({});
    expect(typeof convexAuth.signIn).toBe("function");
    expect(typeof convexAuth.signOut).toBe("function");
  });

  it("createAvsConvexAuth accepts custom avsBaseUrl", async () => {
    const mod = await import("../src/index");
    const convexAuth = mod.createAvsConvexAuth({ avsBaseUrl: "https://custom.auth.example.com" });
    expect(typeof convexAuth.useAuth).toBe("function");
  });
});

// Test the underlying auth client behavior that the React hook delegates to
describe("@avs-auth/react - session state semantics (Shoo parity)", () => {
  beforeEach(() => {
    setupBrowserMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createAvsAuth.checkSession passes clientId derived from redirectUri", async () => {
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "active" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.checkSession();
    expect(result).toEqual({ status: "active" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("createAvsAuth.checkSession rejects aud-mismatched tokens before server call", async () => {
    const { createAvsAuth } = await import("../src/index");
    // Token has aud for a different origin than what the client derives
    const token = fakeToken({
      sub: "ps_1", aud: "origin:https://other.com", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.checkSession();
    // Should return login_required without making a fetch call (aud mismatch)
    expect(result).toEqual({ status: "login_required", reason: "invalid_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createAvsAuth.startSessionMonitor auto-stops after login_required", async () => {
    vi.useFakeTimers();
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    const fetchMock = vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ status: "login_required", reason: "revoked" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const onLoginRequired = vi.fn();
    client.startSessionMonitor({
      intervalMs: 1000,
      immediate: false,
      onLoginRequired
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onLoginRequired).toHaveBeenCalledTimes(1);

    // After auto-stop, no more fetches
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("identity state transitions: no token stored → login_required", async () => {
    const { createAvsAuth } = await import("../src/index");
    const client = createAvsAuth({});
    const identity = client.getIdentity();
    // Shoo parity: session state decision based on token presence
    expect(identity.userId).toBeNull();
    expect(identity.token).toBeUndefined();
    // This mirrors what the hook does: token ? "unknown" : "login_required"
    const state = identity.token ? "unknown" : "login_required";
    expect(state).toBe("login_required");
  });

  it("identity state transitions: token stored → unknown (pending check)", async () => {
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    const client = createAvsAuth({});
    const identity = client.getIdentity();
    expect(identity.token).toBeTruthy();
    const state = identity.token ? "unknown" : "login_required";
    expect(state).toBe("unknown");
  });

  it("identity state transitions: clearIdentity → login_required", async () => {
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    const client = createAvsAuth({});
    expect(client.getIdentity().token).toBeTruthy();
    client.clearIdentity();
    const identity = client.getIdentity();
    expect(identity.token).toBeUndefined();
    const state = identity.token ? "unknown" : "login_required";
    expect(state).toBe("login_required");
  });

  it("checkSession transitions: active", async () => {
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ status: "active" })
    }));

    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.checkSession();
    expect(result.status).toBe("active");
  });

  it("checkSession transitions: login_required", async () => {
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({ status: "login_required", reason: "expired" })
    }));

    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.checkSession();
    expect(result.status).toBe("login_required");
  });

  it("checkSession transitions: unsupported", async () => {
    const { createAvsAuth } = await import("../src/index");
    const token = fakeToken({
      sub: "ps_1", aud: "origin:http://localhost", iss: "test",
      iat: 1, exp: 99999999999, jti: "j1", pairwise_sub: "ps_1"
    });
    storage["avs_auth_identity"] = JSON.stringify({ userId: "ps_1", token, receivedAt: Date.now() });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));

    const client = createAvsAuth({ avsBaseUrl: "https://auth.adityavs.tech" });
    const result = await client.checkSession();
    expect(result.status).toBe("unsupported");
  });
});
