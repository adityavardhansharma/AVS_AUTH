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

Clears the broker session and cookie. Returns: `{ status: "ok" }`

## @avs-auth/auth

- `createAvsAuth(options?)` - Creates an auth client instance
- `createPkceBundle()` - Generates PKCE material
- `createSignInUrl(params)` - Builds an authorize URL
- `parseCallback(url?)` - Extracts code and state from URL
- `clearCallbackParams(url?)` - Removes auth params from URL
- `getIdentity(storageKey?)` - Reads identity from localStorage
- `persistIdentity(userId, token, storageKey?, extras?)` - Saves identity
- `clearIdentity(storageKey?)` - Removes identity
- `decodeIdentityClaims(idToken?)` - Decodes JWT payload
- `exchangeCode(params)` - Exchanges code for token
- `checkSession(params?)` - Checks session status
- `startSessionMonitor(options?)` - Starts periodic session checks
- `startSignIn(params?)` - Initiates sign-in flow
- `finishSignIn(params?)` - Completes callback flow
- `handleCallback(params?)` - Full callback handler
- `isCallbackRoute(callbackPath, pathname?)` - Route matcher
- `defaults` - Default configuration values

## @avs-auth/react

- `useAvsAuth(options?)` - React hook returning identity, claims, session state, and auth actions
- `createAvsConvexAuth(options?)` - Convex-compatible auth adapter returning useAuth, signIn, signOut

## @avs-auth/types

All TypeScript types exported: `AuthorizeRequest`, `TokenRequest`, `TokenResponse`, `IdentityClaims`, `AvsIdentity`, `PkceBundle`, `SessionCheckResponse`, `SessionCheckResult`, `AvsAuthOptions`, `StartSignInOptions`, `FinishSignInOptions`, `HandleCallbackOptions`, `CheckSessionOptions`, `ExchangeCodeParams`, `SessionMonitorOptions`, `SessionMonitorHandle`, `UseAvsAuthOptions`, `UseAvsAuthResult`, `AvsAuthClientShape`, `LogoutResponse`, `ConsentGrant`, `AuthorizedSite`, `BrokerSessionSummary`, `BrokerUserProfile`, `OperatorAuditEvent`, `Jwk`, `OpenIdConfiguration`.

## window.AvsAuth (hosted script)

The hosted script at `/avs-auth.js` exposes all browser SDK functions on `window.AvsAuth`: `defaults`, `createPkceBundle`, `createSignInUrl`, `parseCallback`, `clearCallbackParams`, `startSignIn`, `finishSignIn`, `handleCallback`, `exchangeCode`, `checkSession`, `startSessionMonitor`, `getIdentity`, `persistIdentity`, `clearIdentity`, `decodeIdentityClaims`.
