# What Are We Doing

## The Short Version

We are building **AVS AUTH** — a full clone of **[Shoo](https://shoo.dev)**, a privacy-first authentication broker. Same features, same SDK behavior, same protocol. Our version runs on `auth.adityavs.tech` instead of `shoo.dev`.

---

## What Is Shoo?

Shoo is a minimal authentication broker that gives every app a unique, privacy-preserving identity for each user. It works like this:

1. A user signs in once at `shoo.dev` (via Google).
2. Any app that integrates Shoo can authenticate that user instantly — no second sign-in, no password, no dashboard setup.
3. Each app gets a **pairwise subject ID** — a unique identifier scoped to that app's origin. Apps cannot correlate users across different origins.
4. The developer experience is dead simple: add a `<script>` tag or install an npm package.

### Shoo Links

| Resource | Link |
| --- | --- |
| **Shoo Website** | [https://shoo.dev](https://shoo.dev) |
| **`@shoojs/auth`** (npm) | [https://www.npmjs.com/package/@shoojs/auth](https://www.npmjs.com/package/@shoojs/auth) |
| **`@shoojs/react`** (npm) | [https://www.npmjs.com/package/@shoojs/react](https://www.npmjs.com/package/@shoojs/react) |
| **`@shoojs/types`** (npm) | [https://www.npmjs.com/package/@shoojs/types](https://www.npmjs.com/package/@shoojs/types) |

### Shoo NPM Packages (v0.2.2)

```bash
# Browser SDK (vanilla JS)
npm install @shoojs/auth

# React hook wrapper
npm install @shoojs/react

# Shared type definitions
npm install @shoojs/types
```

### Shoo SDK Usage (What Developers See)

**Vanilla JS — hosted script (2 lines):**
```html
<script src="https://shoo.dev/avs-auth.js"></script>
<a data-avs-auth>Sign In</a>
```

**Vanilla JS — npm package:**
```ts
import { createShooAuth } from "@shoojs/auth";

const auth = createShooAuth({
  shooBaseUrl: "https://shoo.dev",
  callbackPath: "/auth/callback"
});

await auth.startSignIn();
await auth.handleCallback();

const identity = auth.getIdentity();
console.log(identity.userId); // pairwise subject ID
```

**React:**
```tsx
import { useShooAuth } from "@shoojs/react";

function App() {
  const auth = useShooAuth({
    shooBaseUrl: "https://shoo.dev",
    callbackPath: "/auth/callback"
  });

  return (
    <div>
      <button onClick={() => void auth.signIn()}>Sign In</button>
      <p>{auth.identity.userId ?? "Signed out"}</p>
      <p>Session: {auth.sessionState}</p>
    </div>
  );
}
```

### Shoo Protocol (What Happens Under the Hood)

| Endpoint | Purpose |
| --- | --- |
| `GET /authorize` | Start OIDC authorization with PKCE S256 |
| `POST /token` | Exchange authorization code for `id_token` |
| `POST /session/check` | Validate session (returns `active` or `login_required`) |
| `POST /logout` | Revoke broker session |
| `/.well-known/openid-configuration` | OIDC discovery document |
| `/.well-known/jwks.json` | Public signing keys (ES256) |
| `GET /avs-auth.js` | Hosted browser script |

### Shoo Type Contracts

```ts
// Token issued to apps
type IdentityClaims = {
  iss: string;           // "https://shoo.dev"
  aud: string;           // "origin:https://yourapp.com"
  sub: string;           // pairwise subject (unique per app)
  pairwise_sub: string;  // same as sub
  iat: number;
  exp: number;
  jti: string;
  email?: string;        // only if PII consent granted
  name?: string;
  picture?: string;
};

// Session check responses
type SessionCheckResponse =
  | { status: "active" }
  | { status: "login_required"; reason: "revoked" | "expired" | "invalid_token" };
```

---

## What Is AVS AUTH?

AVS AUTH is our implementation of the exact same product. It is a **full Shoo clone** running on our own infrastructure.

| Shoo | AVS AUTH |
| --- | --- |
| `https://shoo.dev` | `https://auth.adityavs.tech` |
| `@shoojs/auth` | `@avs-auth/auth` |
| `@shoojs/react` | `@avs-auth/react` |
| `@shoojs/types` | `@avs-auth/types` |
| `createShooAuth()` | `createAvsAuth()` |
| `useShooAuth()` | `useAvsAuth()` |
| `shooBaseUrl` option | `avsBaseUrl` option |
| `shoo_identity` storage key | `avs_auth_identity` storage key |

Everything else — the protocol, the SDK behavior, the session semantics, the token format, the hosted script, the broker UX — is identical.

### Our Packages

```bash
# Browser SDK (vanilla JS)  — mirrors @shoojs/auth
npm install @avs-auth/auth

# React hook wrapper  — mirrors @shoojs/react
npm install @avs-auth/react

# Shared types  — mirrors @shoojs/types
npm install @avs-auth/types

# OIDC protocol core (not in Shoo's public surface)
npm install @avs-auth/oidc-core
```

### Our Architecture

```
packages/
  types/         — shared TypeScript contracts
  oidc-core/     — PKCE, token issuance, validation, pairwise subjects
  auth/          — browser SDK (vanilla JS)
  react/         — React hook wrapper

services/
  edge-gateway/  — Cloudflare Worker (all OIDC endpoints + broker UI + hosted script)
  convex/        — durable backend (users, sessions, consents, codes, keys, audits)

apps/
  docs/          — documentation site
  broker-web/    — reserved scaffold (Worker currently serves broker UI)
```

---

## How Are We Achieving Parity?

### The Rule

> The product requirement is locked to full Shoo parity as a minimum bar. AVS AUTH may add security and operator features, but it may not ship with fewer public features than Shoo.

### The Method

1. **We downloaded the actual Shoo npm packages** (`@shoojs/auth@0.2.2`, `@shoojs/react@0.2.2`, `@shoojs/types@0.2.2`) and stored them in `tmp_shoo_*` directories for reference.

2. **We read every line of Shoo's compiled source code** to understand the exact runtime behavior — not just the API surface, but the internal logic: how `checkSession` parses responses, when `startSessionMonitor` stops, how session state transitions work in the React hook.

3. **We matched behavior, not just API shape.** Examples of specific behavioral parity we implemented:
   - `startSessionMonitor` auto-stops after first `login_required` (Shoo does this; a naive implementation would keep polling)
   - `checkSession` pre-validates token `aud` against expected `clientId` before making a server call
   - `checkSession` strictly parses 200/401 responses and throws on unexpected HTTP statuses
   - React hook bases session state on `token` presence (not `userId`)
   - When the session monitor starts with no token, session state is set to `login_required` immediately

4. **We track parity with a detailed checklist** in [docs/parity-checklist.md](docs/parity-checklist.md) — every capability has an automated test and manual acceptance criteria.

5. **We enforce it with tests.** The test suite explicitly verifies Shoo-specific edge cases:
   - Aud mismatch returns `login_required` without a server call
   - Malformed 401 payload falls back to `invalid_token`
   - Monitor stops after one `login_required` (not keeps polling)
   - Code replay is rejected on second attempt
   - PKCE mismatch returns explicit error

### What We Added Beyond Shoo

AVS AUTH includes some features Shoo doesn't publicly expose:

- **Admin routes** (`/admin/rotate-keys`, `/admin/block-client`, `/admin/unblock-client`, `/admin/revoke-user-sessions`, `/admin/audit`)
- **Rate limiting** (per-origin, via Convex)
- **Audit event logging**
- **Dual-mode storage** (in-memory for development, Convex for production)
- **`@avs-auth/oidc-core`** as a separate package (Shoo bundles this internally)

These additions do not break parity — every public Shoo feature works identically.

---

## Current Status

**Phase 1 (Shoo Parity): COMPLETE**

All SDK behavior, protocol endpoints, broker UX pages, hosted script behavior, session semantics, and documentation match Shoo.

**Phase 2 (Hardening): IN PROGRESS**

- Rate limiting depth
- Key rotation rollover safety
- Operator enforcement
- Convex module test coverage

### Verification

```bash
pnpm turbo run test --force   # 171 tests, all passing, no --passWithNoTests
pnpm turbo run typecheck      # all packages type-safe
```

---

## Quick Reference

| What | Shoo | AVS AUTH |
| --- | --- | --- |
| Broker URL | `https://shoo.dev` | `https://auth.adityavs.tech` |
| Auth SDK | [`@shoojs/auth`](https://www.npmjs.com/package/@shoojs/auth) | `@avs-auth/auth` |
| React SDK | [`@shoojs/react`](https://www.npmjs.com/package/@shoojs/react) | `@avs-auth/react` |
| Types | [`@shoojs/types`](https://www.npmjs.com/package/@shoojs/types) | `@avs-auth/types` |
| OIDC Discovery | `https://shoo.dev/.well-known/openid-configuration` | `https://auth.adityavs.tech/.well-known/openid-configuration` |
| JWKS | `https://shoo.dev/.well-known/jwks.json` | `https://auth.adityavs.tech/.well-known/jwks.json` |
| Hosted Script | `https://shoo.dev/avs-auth.js` | `https://auth.adityavs.tech/avs-auth.js` |
| Token Signing | ES256 | ES256 |
| Subject Model | Pairwise (HMAC per origin) | Pairwise (HMAC per origin) |
| Client Registration | Zero-dashboard (origin-derived) | Zero-dashboard (origin-derived) |
| PKCE | S256 required | S256 required |
| Session Cookie | 14-day, HttpOnly, Secure, SameSite=Lax | 14-day, HttpOnly, Secure, SameSite=Lax |
