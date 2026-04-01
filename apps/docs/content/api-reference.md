# API Reference

## Broker endpoints

### GET /.well-known/openid-configuration

Returns the OIDC discovery document.

### GET /.well-known/jwks.json

Returns the public signing keys in JWKS format.

### GET /authorize

Starts an authorization flow. Query parameters: `redirect_uri` (required), `state` (required), `code_challenge` (required), `code_challenge_method` (required, must be `S256`), `client_id` (optional), `nonce` (optional), `pii` (optional).

### POST /token

Exchanges an authorization code for an `id_token`. Form-encoded body: `grant_type` (must be `authorization_code`), `client_id`, `redirect_uri`, `code`, `code_verifier`.

Returns: `{ id_token, pairwise_sub, token_type, expires_in }`

### POST /session/check

Checks if the broker session is still active. Send the `id_token` as a Bearer token.

Returns: `{ status: "active" }` or `{ status: "login_required", reason }`

### POST /logout

Clears the broker session and cookie, then redirects (302) to `/`.

## @avs-auth/auth

### Standalone exports

- `createAvsAuth(options?)` - Creates an auth client instance with all methods bound to the resolved config
- `createPkceBundle()` - Generates a PKCE bundle `{ state, verifier, challenge }`
- `createSignInUrl(params)` - Builds an `/authorize` URL from explicit params
- `parseCallback(url?)` - Extracts `{ code, state }` from the current URL or a given URL
- `clearCallbackParams(url?)` - Removes `code`, `state`, and `error` params from the URL and calls `history.replaceState`
- `getIdentity(storageKey?)` - Reads `AvsIdentity` from `localStorage`
- `persistIdentity(userId, token, storageKey?, extras?)` - Saves identity to `localStorage`
- `clearIdentity(storageKey?)` - Removes identity from `localStorage`
- `decodeIdentityClaims(idToken?)` - Decodes JWT payload without verification
- `exchangeCode(params)` - Calls `POST /token` with PKCE verifier and returns `TokenResponse`
- `checkSession(params?)` - Calls `POST /session/check` with the stored `id_token`
- `startSessionMonitor(options?)` - Starts a polling session check; returns `{ stop() }`
- `isCallbackRoute(callbackPath, pathname?)` - Returns `true` when `pathname` matches `callbackPath`
- `createHostedRuntime(options?)` - Creates a runtime for the hosted script with `bindLinkUpgrade`, `autoHandleCallback`, and `dispatchLoginRequired`
- `bootstrapHostedScript(script?)` - Reads `data-*` attributes from the current `<script>` tag and initialises a `HostedRuntime`
- `defaults` - Default configuration values (`AvsAuthOptions` with all fields populated)

### AvsAuthClient methods (returned by `createAvsAuth`)

The client object exposes the same functions bound to the resolved options, plus:

- `client.startSignIn(params?)` - Generates PKCE, stores verifier, and redirects to the broker
- `client.finishSignIn(params?)` - Exchanges the code, persists identity, and optionally redirects
- `client.handleCallback(params?)` - `finishSignIn` + redirect to stored return-to path; returns `TokenResponse | null`
- All standalone functions listed above, bound to `client.options`

## @avs-auth/react

- `useAvsAuth(options?)` - React hook returning `identity`, `claims`, `sessionState`, `loading`, `error`, `signIn`, `handleCallback`, `checkSession`, `refreshIdentity`, `clearIdentity`, `authClient`
- `createAvsConvexAuth(options)` - Convex-compatible auth adapter; returns `{ useAuth, signIn, signOut }`
- `createAvsAuth` - Re-exported from `@avs-auth/auth`
- `decodeIdentityClaims` - Re-exported from `@avs-auth/auth`

## @avs-auth/types

All TypeScript types exported: `CodeChallengeMethod`, `AuthorizeRequest`, `TokenRequest`, `TokenResponse`, `IdentityClaims`, `AvsIdentity`, `PkceBundle`, `SessionCheckResponse`, `SessionCheckResult`, `SessionCheckReason`, `SessionState`, `AvsAuthOptions`, `StartSignInOptions`, `FinishSignInOptions`, `HandleCallbackOptions`, `CheckSessionOptions`, `ExchangeCodeParams`, `SessionMonitorOptions`, `SessionMonitorHandle`, `UseAvsAuthOptions`, `UseAvsAuthResult`, `AvsAuthClientShape`, `LogoutResponse`, `ConsentGrant`, `AuthorizedSite`, `BrokerSessionSummary`, `BrokerUserProfile`, `OperatorAuditEvent`, `Jwk`, `OpenIdConfiguration`.

## window.AvsAuth (hosted script)

The hosted script is served at `/avs-auth.js` and exposes the SDK on `window.AvsAuth`. The object provides the browser auth methods: `startSignIn`, `finishSignIn`, `handleCallback`, `checkSession`, `startSessionMonitor`, `getIdentity`, `persistIdentity`, `clearIdentity`, `decodeIdentityClaims`, `createPkceBundle`, `createSignInUrl`, `parseCallback`, `clearCallbackParams`, plus `defaults`.
