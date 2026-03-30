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
  defaults
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
});
