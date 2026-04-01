# How It Works

AVS AUTH implements a standard OIDC Authorization Code + PKCE flow with a central broker session.

## Step-by-step flow

### 1. Authorization request 

Your app generates a PKCE bundle (verifier + S256 challenge) and redirects the user to the broker's `/authorize` endpoint with the `redirect_uri`, `state`, and `code_challenge`.

The `client_id` is automatically derived as `origin:${redirect_uri_origin}`.

### 2. Broker sign-in

If the user has no active broker session, they are redirected to Google OAuth. After authenticating, the broker creates a session cookie (`avs_session`) on `auth.adityavs.tech`.

If the user already has a broker session (from another app), the Google step is skipped entirely.

### 3. Consent

If the app requests PII (`pii=true`), the user sees a consent page showing what data will be shared. Otherwise, basic consent is auto-granted.

### 4. Authorization code

The broker generates a one-time authorization code and redirects back to your app's `redirect_uri` with `code` and `state` parameters.

### 5. Token exchange

Your app sends the code and PKCE verifier to `POST /token`. The broker verifies the PKCE challenge, validates the code, and issues an ES256-signed `id_token`.

### 6. ID token

The response includes the JWT token, pairwise subject, and expiry. Your app stores the identity locally and can verify the token server-side against the published JWKS.

## Pairwise subjects

Each user gets a different `sub` for each origin. The same user on `app-a.com` and `app-b.com` will have different subject IDs. This prevents cross-site user correlation.

The pairwise subject is derived via HMAC-SHA256.

## Origin-derived client_id

No client registration is needed. The `client_id` is always `origin:${origin_of_redirect_uri}`. The broker validates that the `redirect_uri` origin matches the `client_id`.

## Broker session reuse

After the first sign-in, the broker sets a session cookie. When a second app initiates authorization, the broker detects the existing session and issues a code without requiring Google re-authentication.

## Session check and revocation

Apps can call `POST /session/check` with the `id_token` to verify the session is still active. If the user revokes consent from the broker's Authorized Sites page, the session check returns `login_required` with reason `revoked`.
