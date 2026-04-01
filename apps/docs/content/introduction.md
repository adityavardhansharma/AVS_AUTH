# AVS AUTH

AVS AUTH is a minimal, privacy-first authentication broker for web applications. It provides pairwise OIDC identity with zero-dashboard client registration.

## How it works

- Users sign in once at `auth.adityavs.tech` using Google.
- Each app receives a **pairwise subject identifier** unique to that origin. Apps cannot correlate users across different sites.
- Apps get an `id_token` (ES256 JWT) that can be verified server-side against the published JWKS.
- No client registration required. Your `client_id` is automatically derived from your app's origin.

## Key features

- **Privacy-first**: Pairwise subjects prevent cross-site tracking. Email and profile data are only shared with explicit user consent.
- **Zero configuration**: No dashboard signup. Just add a script tag or install the SDK.
- **Broker session reuse**: After signing in once, users can authenticate with any integrated app without re-authenticating with Google.
- **PKCE S256**: All browser flows use Proof Key for Code Exchange for security.
- **ES256 JWT**: Tokens are signed with elliptic curve keys and verifiable against the published JWKS endpoint.

## Integration options

- **Script tag**: Add `<script src="https://auth.adityavs.tech/avs-auth.js"></script>` for zero-npm auth.
- **npm package**: `npm install @avs-auth/auth` for full SDK control.
- **React hook**: `npm install @avs-auth/react` for React integration with `useAvsAuth`.
- **Convex integration**: Use `createAvsConvexAuth` for seamless Convex backend auth.
