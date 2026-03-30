# Server Verification

Always verify `id_token` values server-side before trusting them. The token is a standard ES256-signed JWT.

## JWKS endpoint

Public keys are available at:

```text
https://auth.adityavs.tech/.well-known/jwks.json
```

## Node.js with jose

```javascript
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://auth.adityavs.tech/.well-known/jwks.json")
);

async function verifyToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: "https://auth.adityavs.tech",
    audience: "origin:https://yourapp.com"
  });
  return {
    userId: payload.sub,
    pairwiseSub: payload.pairwise_sub,
    email: payload.email,
    name: payload.name
  };
}
```

## Cloudflare Worker

```javascript
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://auth.adityavs.tech/.well-known/jwks.json")
);

export default {
  async fetch(request) {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: "https://auth.adityavs.tech"
      });
      return new Response(JSON.stringify({ user: payload.sub }));
    } catch {
      return new Response("Invalid token", { status: 401 });
    }
  }
};
```

## Token claims

- `iss` - Always `https://auth.adityavs.tech`
- `aud` - Your app's `client_id` (e.g., `origin:https://yourapp.com`)
- `sub` - Pairwise subject ID (same as `pairwise_sub`)
- `pairwise_sub` - Unique per user per origin
- `iat` - Issued at (Unix timestamp)
- `exp` - Expires at (Unix timestamp, 5 minutes after issuance)
- `jti` - Unique token identifier
- `nonce` - Echo of nonce from authorize request (if provided)
- `email` - User's email (only if PII consent was granted)
- `email_verified` - Email verification status (only if PII consent was granted)
- `name` - User's display name (only if PII consent was granted)
- `picture` - Profile picture URL (only if PII consent was granted)

## Important notes

- Tokens expire after 5 minutes. Use `POST /session/check` for ongoing session validation.
- Always verify the `aud` claim matches your expected `client_id`.
- PII claims are only present when the user explicitly grants consent.
