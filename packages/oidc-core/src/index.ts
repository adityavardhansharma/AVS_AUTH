import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from "jose";
import type {
  BrokerUserProfile,
  IdentityClaims,
  Jwk,
  OpenIdConfiguration,
  SessionCheckReason,
  SessionCheckResponse,
  TokenRequest
} from "@avs-auth/types";

export const DEFAULT_ISSUER = "https://auth.adityavs.tech";
export const DEFAULT_ID_TOKEN_TTL_SECONDS = 300;
export const DEFAULT_TRANSACTION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export type OidcErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "access_denied"
  | "login_required"
  | "server_error";

export class OidcError extends Error {
  code: OidcErrorCode;
  status: number;

  constructor(code: OidcErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OidcError";
    this.code = code;
    this.status = status ?? defaultStatusForErrorCode(code);
  }
}

export type AuthorizeRequestRecord = {
  transactionId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  requestPii: boolean;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "authenticated" | "completed" | "denied" | "expired";
};

export type AuthorizationCodeRecord = {
  code: string;
  transactionId: string;
  clientId: string;
  redirectUri: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  redeemedAt?: number;
};

export type TokenValidationResult = {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
};

export function deriveClientIdFromRedirectUri(redirectUri: string): string {
  return `origin:${new URL(redirectUri).origin}`;
}

export function validateAuthorizeRequest(input: {
  clientId?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  env: "development" | "production";
  nonce?: string;
}): {
  clientId: string;
  redirectUri: string;
  nonce?: string;
} {
  const parsed = parseRedirectUri(input.redirectUri, input.env);
  const derivedClientId = deriveClientIdFromRedirectUri(parsed.toString());
  if (input.clientId && input.clientId !== derivedClientId) {
    throw new OidcError("invalid_client", "client_id does not match redirect_uri origin");
  }
  if (!input.state) {
    throw new OidcError("invalid_request", "state is required");
  }
  if (!input.codeChallenge) {
    throw new OidcError("invalid_request", "code_challenge is required");
  }
  if (input.codeChallengeMethod !== "S256") {
    throw new OidcError("invalid_request", "code_challenge_method must be S256");
  }

  return {
    clientId: derivedClientId,
    redirectUri: parsed.toString(),
    nonce: input.nonce
  };
}

export function validateTokenRequest(
  input: TokenRequest & {
    env: "development" | "production";
    expectedClientId?: string;
    expectedRedirectUri?: string;
  }
): TokenValidationResult {
  if (input.grant_type !== "authorization_code") {
    throw new OidcError("invalid_request", "grant_type must be authorization_code");
  }
  const redirectUri = parseRedirectUri(input.redirect_uri, input.env).toString();
  const derivedClientId = deriveClientIdFromRedirectUri(redirectUri);
  if (input.client_id !== derivedClientId) {
    throw new OidcError("invalid_client", "client_id does not match redirect_uri origin");
  }
  if (input.expectedClientId && input.expectedClientId !== input.client_id) {
    throw new OidcError("invalid_grant", "client_id does not match authorization code");
  }
  if (input.expectedRedirectUri && input.expectedRedirectUri !== redirectUri) {
    throw new OidcError("invalid_grant", "redirect_uri does not match authorization code");
  }
  if (!input.code) {
    throw new OidcError("invalid_request", "code is required");
  }
  if (!input.code_verifier) {
    throw new OidcError("invalid_request", "code_verifier is required");
  }

  return {
    clientId: input.client_id,
    redirectUri,
    code: input.code,
    codeVerifier: input.code_verifier
  };
}

export async function verifyPkce(input: {
  verifier: string;
  challenge: string;
  method: "S256";
}): Promise<boolean> {
  if (input.method !== "S256") {
    return false;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.verifier));
  return toBase64Url(new Uint8Array(digest)) === input.challenge;
}

export function buildAuthorizeRequestRecord(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  requestPii: boolean;
  now?: number;
  ttlMs?: number;
}): AuthorizeRequestRecord {
  const createdAt = input.now ?? Date.now();
  return {
    transactionId: crypto.randomUUID(),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    state: input.state,
    nonce: input.nonce,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    requestPii: input.requestPii,
    createdAt,
    expiresAt: createdAt + (input.ttlMs ?? DEFAULT_TRANSACTION_TTL_MS),
    status: "pending"
  };
}

export function buildAuthorizationCodeRecord(input: {
  transactionId: string;
  clientId: string;
  redirectUri: string;
  userId: string;
  now?: number;
  ttlMs?: number;
}): AuthorizationCodeRecord {
  const createdAt = input.now ?? Date.now();
  return {
    code: `ac_${crypto.randomUUID()}`,
    transactionId: input.transactionId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    userId: input.userId,
    createdAt,
    expiresAt: createdAt + (input.ttlMs ?? DEFAULT_AUTH_CODE_TTL_MS)
  };
}

export function shouldIncludePiiClaims(input: {
  requestPii: boolean;
  piiGranted?: boolean;
}): boolean {
  return input.requestPii && input.piiGranted === true;
}

export function isCodeRedeemable(input: {
  expiresAt: number;
  redeemedAt?: number;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  return !input.redeemedAt && input.expiresAt > now;
}

export function buildSessionCheckResponse(input: {
  hasValidToken: boolean;
  hasActiveSession: boolean;
  hasActiveConsent: boolean;
}): SessionCheckResponse {
  if (!input.hasValidToken) {
    return { status: "login_required", reason: "invalid_token" };
  }
  if (!input.hasActiveSession) {
    return { status: "login_required", reason: "expired" };
  }
  if (!input.hasActiveConsent) {
    return { status: "login_required", reason: "revoked" };
  }
  return { status: "active" };
}

export async function derivePairwiseSub(input: {
  pairwiseSecret: string;
  googleSub: string;
  clientId: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.pairwiseSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${input.googleSub}|${input.clientId}`)
  );
  return `ps_${toBase64Url(new Uint8Array(signature))}`;
}

export async function issueIdToken(input: {
  issuer?: string;
  audience: string;
  pairwiseSub: string;
  user: BrokerUserProfile;
  privateKey: CryptoKey;
  kid: string;
  ttlSeconds?: number;
  nonce?: string;
  includePii?: boolean;
}): Promise<IdentityClaims & { token: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? DEFAULT_ID_TOKEN_TTL_SECONDS);
  const jti = crypto.randomUUID();
  const claims: IdentityClaims = {
    iss: input.issuer ?? DEFAULT_ISSUER,
    aud: input.audience,
    sub: input.pairwiseSub,
    pairwise_sub: input.pairwiseSub,
    iat: now,
    exp,
    jti
  };

  if (input.nonce) {
    claims.nonce = input.nonce;
  }
  if (input.includePii) {
    claims.email = input.user.email;
    claims.email_verified = input.user.emailVerified;
    claims.name = input.user.name;
    claims.picture = input.user.picture;
  }

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: input.kid, typ: "JWT" })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .setJti(claims.jti)
    .sign(input.privateKey);

  return { ...claims, token };
}

export async function generateSigningKeySet(): Promise<{
  publicJwk: Jwk;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  kid: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = `avs-es256-${Date.now()}`;
  const publicJwk = (await exportJWK(publicKey)) as Jwk;
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = "ES256";
  return { publicJwk, publicKey, privateKey, kid };
}

export function parseJwks(value: string | undefined): { keys: Jwk[] } {
  if (!value) {
    return { keys: [] };
  }
  const parsed = JSON.parse(value) as { keys?: Jwk[] };
  return { keys: Array.isArray(parsed.keys) ? parsed.keys : [] };
}

export function createOpenIdConfiguration(issuer = DEFAULT_ISSUER): OpenIdConfiguration {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["ES256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [
      "iss",
      "aud",
      "sub",
      "exp",
      "iat",
      "jti",
      "pairwise_sub",
      "email",
      "email_verified",
      "name",
      "picture",
      "nonce"
    ]
  };
}

export function defaultStatusForErrorCode(code: OidcErrorCode): number {
  switch (code) {
    case "invalid_request":
    case "invalid_client":
      return 400;
    case "invalid_grant":
      return 401;
    case "access_denied":
      return 403;
    case "login_required":
      return 401;
    case "server_error":
      return 500;
  }
}

export function asSessionCheckReason(reason: string): SessionCheckReason {
  if (reason === "revoked" || reason === "expired" || reason === "invalid_token") {
    return reason;
  }
  return "invalid_token";
}

export async function verifyIdToken(input: {
  token: string;
  publicKeys: Jwk[];
  issuer: string;
}): Promise<{ valid: true; claims: IdentityClaims } | { valid: false; claims: null }> {
  try {
    const headerPart = input.token.split(".")[0];
    if (!headerPart) return { valid: false, claims: null };
    // Restore standard base64 padding before decoding (base64url strips it).
    const base64 = headerPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const headerJson = atob(padded);
    const header = JSON.parse(headerJson) as { kid?: string };
    const kid = header.kid;
    let jwk: Jwk | undefined;
    if (kid) {
      jwk = input.publicKeys.find((k) => k.kid === kid);
      if (!jwk) {
        // A kid was present but matched no known key — reject explicitly rather
        // than silently falling back, which could allow key-confusion attacks.
        console.warn(`[verifyIdToken] No public key found for kid="${kid}"`);
        return { valid: false, claims: null };
      }
    } else {
      jwk = input.publicKeys[0];
    }
    if (!jwk) return { valid: false, claims: null };
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(input.token, key as CryptoKey, {
      issuer: input.issuer
    });
    return { valid: true, claims: payload as unknown as IdentityClaims };
  } catch {
    return { valid: false, claims: null };
  }
}

export async function importPrivateKeyFromJwk(jwkJson: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkJson);
  const key = await importJWK(jwk, "ES256");
  return key as CryptoKey;
}

export async function exportPrivateKeyToJwk(privateKey: CryptoKey): Promise<string> {
  const jwk = await exportJWK(privateKey);
  return JSON.stringify(jwk);
}

function parseRedirectUri(redirectUri: string, env: "development" | "production"): URL {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new OidcError("invalid_request", "redirect_uri must be a valid URL");
  }

  const isLocalhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";

  if (env === "production" && parsed.protocol !== "https:") {
    throw new OidcError("invalid_request", "redirect_uri must use https in production");
  }
  if (env !== "development" && isLocalhost) {
    throw new OidcError("invalid_request", "localhost redirect_uri is only allowed in development");
  }
  return parsed;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
