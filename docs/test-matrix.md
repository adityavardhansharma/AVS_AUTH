# AVS AUTH Test Matrix

Every release item needs one automated test and one manual acceptance step before release.

## Protocol

- Authorize succeeds with valid PKCE and derived `client_id`
- Authorize rejects missing state, missing challenge, invalid method, mismatched `client_id`, and unsafe redirect URI
- Token exchange succeeds for a valid one-time code
- Token exchange rejects reused code, wrong verifier, wrong redirect URI, and wrong client
- `id_token` verifies against published JWKS
- OIDC discovery document exposes required endpoints and claim metadata
- `/session/check` returns `active` for valid session and `login_required` for revoked, expired, or invalid state
- `/logout` clears cookie and invalidates session

## SDK

- `createPkceBundle` returns unique state and verifier with an S256 challenge
- `createSignInUrl` encodes request fields correctly
- callback parsing and cleanup behave correctly with and without auth parameters
- identity persistence helpers read, write, and clear local state
- `finishSignIn` validates state and PKCE storage age
- `handleCallback` exchanges code, stores identity, and redirects to safe return path
- session monitor stops on `login_required` and calls the handler once
- hosted script exposes `window.AvsAuth` and auto-handles callback

## React

- `useAvsAuth` initializes identity correctly on page load
- automatic callback handling can be disabled
- `checkSession` updates local state for `active`, `login_required`, and `unsupported`
- session monitor clears identity when broker session is revoked
- `createAvsConvexAuth` exposes a compatible `useAuth`, `signIn`, and `signOut`

## Broker UX

- landing page renders signed-out and signed-in variants
- sign-in page shows Google CTA and fast-path behavior
- consent page reflects requesting origin and PII request state
- profile page shows identity and linked navigation
- authorized-sites page lists grants and supports revoke
- privacy, terms, error, and no-session routes render and link correctly

## Security and Ops

- CSP, frame protections, and no-sniff headers are present on HTML responses
- broker session cookie attributes are correct
- audit events omit raw tokens, codes, and Google access tokens
- key rotation preserves verification for older valid tokens during rollover
- origin blocking and rate limiting produce controlled errors with correlation ids
