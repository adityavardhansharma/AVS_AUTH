export type CodeChallengeMethod = "S256";

export type AuthorizeRequest = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: CodeChallengeMethod;
  pii?: boolean;
  nonce?: string;
};

export type TokenRequest = {
  grant_type: "authorization_code";
  client_id: string;
  redirect_uri: string;
  code: string;
  code_verifier: string;
};

export type IdentityClaims = {
  iss: string;
  aud: string;
  sub: string;
  pairwise_sub: string;
  iat: number;
  exp: number;
  jti: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export type TokenResponse = {
  id_token: string;
  pairwise_sub: string;
  token_type: "Bearer";
  expires_in: number;
};

export type LogoutResponse = {
  status: "ok";
};

export type SessionCheckReason = "revoked" | "expired" | "invalid_token";

export type SessionCheckResponse =
  | { status: "active" }
  | {
      status: "login_required";
      reason: SessionCheckReason;
    };

export type PkceBundle = {
  state: string;
  verifier: string;
  challenge: string;
};

export type AvsIdentity = {
  userId: string | null;
  token?: string;
  expiresIn?: number;
  receivedAt?: number;
};

export type AvsAuthOptions = {
  avsBaseUrl?: string;
  callbackPath?: string;
  redirectUri?: string;
  clientId?: string;
  requestPii?: boolean;
  storageKey?: string;
  pkceStorageKey?: string;
  returnToStorageKey?: string;
  fallbackPath?: string;
  autoSessionMonitor?: boolean;
  sessionMonitorIntervalMs?: number;
};

export type StartSignInOptions = {
  requestPii?: boolean;
  returnTo?: string;
  redirectUri?: string;
  clientId?: string;
  avsBaseUrl?: string;
};

export type ExchangeCodeParams = {
  avsBaseUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
};

export type FinishSignInOptions = {
  url?: string;
  clearCallbackParams?: boolean;
  redirectAfter?: boolean;
  consumeReturnTo?: boolean;
  redirectTo?: string;
  returnTo?: string;
  fallbackPath?: string;
  redirectUri?: string;
  clientId?: string;
  avsBaseUrl?: string;
};

export type HandleCallbackOptions = {
  url?: string;
  redirectTo?: string;
  returnTo?: string;
  fallbackPath?: string;
};

export type CheckSessionOptions = {
  avsBaseUrl?: string;
  token?: string;
  storageKey?: string;
  redirectUri?: string;
  clientId?: string;
};

export type SessionCheckResult =
  | SessionCheckResponse
  | { status: "unsupported" }
  | { status: "rate_limited"; retryAfter: number };

export type SessionMonitorOptions = CheckSessionOptions & {
  intervalMs?: number;
  immediate?: boolean;
  onLoginRequired?: (
    result: Extract<SessionCheckResponse, { status: "login_required" }>
  ) => void;
  onError?: (error: Error) => void;
};

export type SessionMonitorHandle = {
  stop: () => void;
};

export type AvsAuthClientShape = {
  readonly options: Required<AvsAuthOptions>;
  createPkceBundle: () => Promise<PkceBundle>;
  createSignInUrl: (params: {
    state: string;
    codeChallenge: string;
    requestPii?: boolean;
    redirectUri?: string;
    clientId?: string;
    avsBaseUrl?: string;
  }) => string;
  parseCallback: (url?: string) => { code: string; state: string } | null;
  clearCallbackParams: () => void;
  getIdentity: (storageKey?: string) => AvsIdentity;
  persistIdentity: (
    userId: string,
    token: string,
    storageKey?: string,
    extras?: { expiresIn?: number }
  ) => void;
  clearIdentity: (storageKey?: string) => void;
  decodeIdentityClaims: (idToken?: string) => IdentityClaims | null;
  exchangeCode: (params: ExchangeCodeParams) => Promise<TokenResponse>;
  checkSession: (params?: CheckSessionOptions) => Promise<SessionCheckResult>;
  startSessionMonitor: (options?: SessionMonitorOptions) => SessionMonitorHandle;
  startSignIn: (params?: StartSignInOptions) => Promise<{ url: string; bundle: PkceBundle }>;
  finishSignIn: (params?: FinishSignInOptions) => Promise<TokenResponse | null>;
  handleCallback: (params?: HandleCallbackOptions) => Promise<TokenResponse | null>;
};

export type UseAvsAuthOptions = AvsAuthOptions & {
  autoHandleCallback?: boolean;
};

export type SessionState = "unknown" | "active" | "login_required";

export type UseAvsAuthResult = {
  identity: AvsIdentity;
  claims: IdentityClaims | null;
  sessionState: SessionState;
  loading: boolean;
  error: string | null;
  signIn: (params?: StartSignInOptions) => Promise<void>;
  handleCallback: (params?: HandleCallbackOptions) => Promise<TokenResponse | null>;
  checkSession: (params?: CheckSessionOptions) => Promise<SessionCheckResult>;
  refreshIdentity: () => void;
  clearIdentity: () => void;
  authClient: AvsAuthClientShape | null;
};

export type ConsentGrant = {
  clientId: string;
  origin: string;
  piiGranted: boolean;
  grantedAt: number;
  revokedAt?: number;
  lastUsedAt?: number;
};

export type AuthorizedSite = ConsentGrant & {
  displayName?: string;
};

export type BrokerSessionSummary = {
  sessionId: string;
  userId: string;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt?: number;
};

export type OperatorAuditEvent = {
  eventId: string;
  actorType: "user" | "operator" | "system";
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  clientId?: string;
  correlationId: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: number;
};

export type BrokerUserProfile = {
  googleSub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
};

export type Jwk = {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  kid: string;
  use?: string;
  alg?: string;
};

export type OpenIdConfiguration = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
  claims_supported: string[];
};
