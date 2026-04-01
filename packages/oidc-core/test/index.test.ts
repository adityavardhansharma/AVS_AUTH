import { describe, expect, it } from "vitest";
import {
  buildAuthorizationCodeRecord,
  buildAuthorizeRequestRecord,
  buildSessionCheckResponse,
  createOpenIdConfiguration,
  deriveClientIdFromRedirectUri,
  derivePairwiseSub,
  exportPrivateKeyToJwk,
  generateSigningKeySet,
  importPrivateKeyFromJwk,
  isCodeRedeemable,
  issueIdToken,
  OidcError,
  shouldIncludePiiClaims,
  validateAuthorizeRequest,
  validateTokenRequest,
  verifyIdToken,
  verifyPkce
} from "../src/index";

describe("oidc-core", () => {
  // --- Client ID derivation ---
  it("derives client ids from redirect origin", () => {
    expect(deriveClientIdFromRedirectUri("https://app.example.com/auth/callback")).toBe("origin:https://app.example.com");
  });

  it("derives client id from localhost in development", () => {
    expect(deriveClientIdFromRedirectUri("http://localhost:3000/callback")).toBe("origin:http://localhost:3000");
  });

  // --- Authorize request validation ---
  it("validates authorize requests", () => {
    const result = validateAuthorizeRequest({
      redirectUri: "https://app.example.com/callback",
      state: "state",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      env: "production"
    });
    expect(result.clientId).toBe("origin:https://app.example.com");
  });

  it("rejects authorize with missing state", () => {
    expect(() =>
      validateAuthorizeRequest({
        redirectUri: "https://app.example.com/callback",
        state: "",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        env: "production"
      })
    ).toThrow(OidcError);
  });

  it("rejects authorize with missing code_challenge", () => {
    expect(() =>
      validateAuthorizeRequest({
        redirectUri: "https://app.example.com/callback",
        state: "state",
        codeChallenge: "",
        codeChallengeMethod: "S256",
        env: "production"
      })
    ).toThrow(OidcError);
  });

  it("rejects authorize with wrong code_challenge_method", () => {
    expect(() =>
      validateAuthorizeRequest({
        redirectUri: "https://app.example.com/callback",
        state: "state",
        codeChallenge: "challenge",
        codeChallengeMethod: "plain",
        env: "production"
      })
    ).toThrow(OidcError);
  });

  it("rejects authorize with mismatched client_id", () => {
    expect(() =>
      validateAuthorizeRequest({
        redirectUri: "https://app.example.com/callback",
        clientId: "origin:https://evil.com",
        state: "state",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        env: "production"
      })
    ).toThrow(OidcError);
  });

  it("rejects non-https redirect in production", () => {
    expect(() =>
      validateAuthorizeRequest({
        redirectUri: "http://app.example.com/callback",
        state: "state",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        env: "production"
      })
    ).toThrow(OidcError);
  });

  it("passes nonce through validation", () => {
    const result = validateAuthorizeRequest({
      redirectUri: "https://app.example.com/callback",
      state: "state",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      nonce: "nonce-123",
      env: "production"
    });
    expect(result.nonce).toBe("nonce-123");
  });

  // --- Token request validation ---
  it("validates token requests against redirect and client binding", () => {
    const result = validateTokenRequest({
      grant_type: "authorization_code",
      client_id: "origin:https://app.example.com",
      redirect_uri: "https://app.example.com/callback",
      code: "ac_123",
      code_verifier: "verifier",
      env: "production",
      expectedClientId: "origin:https://app.example.com",
      expectedRedirectUri: "https://app.example.com/callback"
    });
    expect(result.clientId).toBe("origin:https://app.example.com");
  });

  it("rejects token request with wrong client_id", () => {
    expect(() =>
      validateTokenRequest({
        grant_type: "authorization_code",
        client_id: "origin:https://evil.com",
        redirect_uri: "https://evil.com/callback",
        code: "ac_123",
        code_verifier: "verifier",
        env: "production",
        expectedClientId: "origin:https://app.example.com"
      })
    ).toThrow(OidcError);
  });

  it("rejects token request with wrong redirect_uri", () => {
    expect(() =>
      validateTokenRequest({
        grant_type: "authorization_code",
        client_id: "origin:https://app.example.com",
        redirect_uri: "https://app.example.com/wrong",
        code: "ac_123",
        code_verifier: "verifier",
        env: "production",
        expectedClientId: "origin:https://app.example.com",
        expectedRedirectUri: "https://app.example.com/callback"
      })
    ).toThrow(OidcError);
  });

  it("rejects token request with missing code", () => {
    expect(() =>
      validateTokenRequest({
        grant_type: "authorization_code",
        client_id: "origin:https://app.example.com",
        redirect_uri: "https://app.example.com/callback",
        code: "",
        code_verifier: "verifier",
        env: "production"
      })
    ).toThrow(OidcError);
  });

  // --- PKCE ---
  it("verifies a PKCE challenge", async () => {
    expect(
      await verifyPkce({
        verifier: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~",
        challenge: "5SSChZEuBRNr4SW163AsWSLl4fRLU51M5eCoRi65P-8",
        method: "S256"
      })
    ).toBe(true);
  });

  it("rejects wrong verifier", async () => {
    expect(
      await verifyPkce({
        verifier: "wrong-verifier",
        challenge: "5SSChZEuBRNr4SW163AsWSLl4fRLU51M5eCoRi65P-8",
        method: "S256"
      })
    ).toBe(false);
  });

  // --- Pairwise subjects ---
  it("generates stable pairwise subjects", async () => {
    const first = await derivePairwiseSub({ pairwiseSecret: "secret", googleSub: "google-user", clientId: "origin:https://app.example.com" });
    const second = await derivePairwiseSub({ pairwiseSecret: "secret", googleSub: "google-user", clientId: "origin:https://app.example.com" });
    expect(first).toBe(second);
    expect(first).toMatch(/^ps_/);
  });

  it("generates different subjects for different origins", async () => {
    const a = await derivePairwiseSub({ pairwiseSecret: "secret", googleSub: "user", clientId: "origin:https://a.com" });
    const b = await derivePairwiseSub({ pairwiseSecret: "secret", googleSub: "user", clientId: "origin:https://b.com" });
    expect(a).not.toBe(b);
  });

  it("generates different subjects for different users", async () => {
    const a = await derivePairwiseSub({ pairwiseSecret: "secret", googleSub: "user-a", clientId: "origin:https://app.com" });
    const b = await derivePairwiseSub({ pairwiseSecret: "secret", googleSub: "user-b", clientId: "origin:https://app.com" });
    expect(a).not.toBe(b);
  });

  // --- Session check ---
  it("builds session check active", () => {
    expect(buildSessionCheckResponse({ hasValidToken: true, hasActiveSession: true, hasActiveConsent: true })).toEqual({ status: "active" });
  });

  it("builds session check login_required for revoked consent", () => {
    expect(buildSessionCheckResponse({ hasValidToken: true, hasActiveSession: true, hasActiveConsent: false })).toEqual({ status: "login_required", reason: "revoked" });
  });

  it("builds session check login_required for expired session", () => {
    expect(buildSessionCheckResponse({ hasValidToken: true, hasActiveSession: false, hasActiveConsent: true })).toEqual({ status: "login_required", reason: "expired" });
  });

  it("builds session check login_required for invalid token", () => {
    expect(buildSessionCheckResponse({ hasValidToken: false, hasActiveSession: true, hasActiveConsent: true })).toEqual({ status: "login_required", reason: "invalid_token" });
  });

  // --- Authorization code records ---
  it("builds authorize request records with transaction id and expiry", () => {
    const rec = buildAuthorizeRequestRecord({
      clientId: "origin:https://app.com",
      redirectUri: "https://app.com/callback",
      state: "s",
      codeChallenge: "c",
      codeChallengeMethod: "S256",
      requestPii: false,
      now: 1000
    });
    expect(rec.transactionId).toBeTruthy();
    expect(rec.status).toBe("pending");
    expect(rec.createdAt).toBe(1000);
    expect(rec.expiresAt).toBeGreaterThan(1000);
  });

  it("builds authorization code records", () => {
    const rec = buildAuthorizationCodeRecord({
      transactionId: "tx-1",
      clientId: "origin:https://app.com",
      redirectUri: "https://app.com/callback",
      userId: "user-1",
      now: 2000
    });
    expect(rec.code).toMatch(/^ac_/);
    expect(rec.userId).toBe("user-1");
    expect(rec.expiresAt).toBeGreaterThan(2000);
  });

  // --- Code redeemability ---
  it("marks unexpired unredeemed codes as redeemable", () => {
    expect(isCodeRedeemable({ expiresAt: Date.now() + 60000 })).toBe(true);
  });

  it("marks expired codes as not redeemable", () => {
    expect(isCodeRedeemable({ expiresAt: Date.now() - 1000 })).toBe(false);
  });

  it("marks redeemed codes as not redeemable", () => {
    expect(isCodeRedeemable({ expiresAt: Date.now() + 60000, redeemedAt: Date.now() - 1000 })).toBe(false);
  });

  // --- PII claims ---
  it("includes PII when requested and granted", () => {
    expect(shouldIncludePiiClaims({ requestPii: true, piiGranted: true })).toBe(true);
  });

  it("excludes PII when not requested", () => {
    expect(shouldIncludePiiClaims({ requestPii: false, piiGranted: true })).toBe(false);
  });

  it("excludes PII when not granted", () => {
    expect(shouldIncludePiiClaims({ requestPii: true, piiGranted: false })).toBe(false);
  });

  // --- OIDC configuration ---
  it("creates oidc configuration", () => {
    const config = createOpenIdConfiguration();
    expect(config.issuer).toBe("https://auth.adityavs.tech");
    expect(config.code_challenge_methods_supported).toEqual(["S256"]);
    expect(config.subject_types_supported).toEqual(["pairwise"]);
    expect(config.token_endpoint_auth_methods_supported).toEqual(["none", "client_secret_post"]);
  });

  // --- Key generation ---
  it("generates ES256 signing keys with kid", async () => {
    const keys = await generateSigningKeySet();
    expect(keys.kid).toMatch(/^avs-es256-/);
    expect(keys.publicJwk.kty).toBe("EC");
    expect(keys.publicJwk.alg).toBe("ES256");
    expect(keys.publicJwk.kid).toBe(keys.kid);
  });

  // --- Token issuance ---
  it("issues a valid id_token with required claims", async () => {
    const keys = await generateSigningKeySet();
    const result = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_test",
      user: { googleSub: "g123" },
      privateKey: keys.privateKey,
      kid: keys.kid,
      nonce: "nonce-abc"
    });
    expect(result.token).toBeTruthy();
    expect(result.iss).toBe("https://auth.adityavs.tech");
    expect(result.aud).toBe("origin:https://app.com");
    expect(result.sub).toBe("ps_test");
    expect(result.pairwise_sub).toBe("ps_test");
    expect(result.nonce).toBe("nonce-abc");
    expect(result.jti).toBeTruthy();
  });

  it("includes PII claims when requested", async () => {
    const keys = await generateSigningKeySet();
    const result = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_test",
      user: { googleSub: "g123", email: "test@example.com", name: "Test", emailVerified: true },
      privateKey: keys.privateKey,
      kid: keys.kid,
      includePii: true
    });
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("Test");
  });

  it("excludes PII claims when not requested", async () => {
    const keys = await generateSigningKeySet();
    const result = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_test",
      user: { googleSub: "g123", email: "test@example.com" },
      privateKey: keys.privateKey,
      kid: keys.kid,
      includePii: false
    });
    expect(result.email).toBeUndefined();
  });

  // --- OidcError ---
  it("OidcError has correct status codes", () => {
    expect(new OidcError("invalid_request", "bad").status).toBe(400);
    expect(new OidcError("invalid_grant", "bad").status).toBe(401);
    expect(new OidcError("access_denied", "bad").status).toBe(403);
    expect(new OidcError("server_error", "bad").status).toBe(500);
  });

  // --- verifyIdToken ---
  it("verifyIdToken returns valid:true for a correctly signed token", async () => {
    const keys = await generateSigningKeySet();
    const issued = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_verify",
      user: { googleSub: "g1" },
      privateKey: keys.privateKey,
      kid: keys.kid,
      issuer: "https://auth.adityavs.tech"
    });
    const result = await verifyIdToken({
      token: issued.token,
      publicKeys: [keys.publicJwk],
      issuer: "https://auth.adityavs.tech"
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.sub).toBe("ps_verify");
      expect(result.claims.aud).toBe("origin:https://app.com");
    }
  });

  it("verifyIdToken returns valid:false for token with wrong issuer", async () => {
    const keys = await generateSigningKeySet();
    const issued = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_verify",
      user: { googleSub: "g1" },
      privateKey: keys.privateKey,
      kid: keys.kid,
      issuer: "https://wrong.issuer.com"
    });
    const result = await verifyIdToken({
      token: issued.token,
      publicKeys: [keys.publicJwk],
      issuer: "https://auth.adityavs.tech"
    });
    expect(result.valid).toBe(false);
    expect(result.claims).toBeNull();
  });

  it("verifyIdToken returns valid:false for tampered token", async () => {
    const keys = await generateSigningKeySet();
    const issued = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_verify",
      user: { googleSub: "g1" },
      privateKey: keys.privateKey,
      kid: keys.kid
    });
    // Tamper with the payload
    const parts = issued.token.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}x.${parts[2]}`;
    const result = await verifyIdToken({
      token: tamperedToken,
      publicKeys: [keys.publicJwk],
      issuer: "https://auth.adityavs.tech"
    });
    expect(result.valid).toBe(false);
  });

  it("verifyIdToken returns valid:false for token signed by a different key", async () => {
    const signingKeys = await generateSigningKeySet();
    const otherKeys = await generateSigningKeySet();
    const issued = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_verify",
      user: { googleSub: "g1" },
      privateKey: signingKeys.privateKey,
      kid: signingKeys.kid
    });
    const result = await verifyIdToken({
      token: issued.token,
      publicKeys: [otherKeys.publicJwk], // Different key
      issuer: "https://auth.adityavs.tech"
    });
    expect(result.valid).toBe(false);
  });

  // --- exportPrivateKeyToJwk / importPrivateKeyFromJwk ---
  it("round-trips private key through export/import", async () => {
    const keys = await generateSigningKeySet();
    const exported = await exportPrivateKeyToJwk(keys.privateKey);
    expect(typeof exported).toBe("string");
    const parsed = JSON.parse(exported);
    expect(parsed.kty).toBe("EC");
    expect(parsed.crv).toBe("P-256");
    expect(parsed.d).toBeTruthy(); // private key component

    // Import it back and sign a token
    const importedKey = await importPrivateKeyFromJwk(exported);
    const issued = await issueIdToken({
      audience: "origin:https://app.com",
      pairwiseSub: "ps_roundtrip",
      user: { googleSub: "g1" },
      privateKey: importedKey,
      kid: keys.kid
    });

    // Verify the token signed with the imported key
    const result = await verifyIdToken({
      token: issued.token,
      publicKeys: [keys.publicJwk],
      issuer: "https://auth.adityavs.tech"
    });
    expect(result.valid).toBe(true);
  });
});
