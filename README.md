# AVS AUTH

AVS AUTH is a privacy-first authentication broker for `auth.adityavs.tech`.

This repository contains:

- `@avs-auth/types` — shared protocol, SDK, and React contracts
- `@avs-auth/oidc-core` — client derivation, PKCE, token issuance, pairwise subjects, request validation
- `@avs-auth/auth` — browser SDK with PKCE sign-in, callback handling, session monitoring, identity persistence
- `@avs-auth/react` — React hook (`useAvsAuth`) and Convex integration helper
- `services/edge-gateway` — Cloudflare Worker implementing the full OIDC broker (authorize, token, session/check, logout, consent, Google OAuth, admin routes, hosted script)
- `services/convex` — durable backend (users, sessions, consents, transactions, codes, pairwise subjects, signing keys, audits, rate limits)
- `apps/docs` — static documentation site
- `apps/broker-web` — reserved scaffold (the Worker currently serves the broker UI as inline HTML)

The product requirement is locked to a complete broker, hosted-script, SDK, and React integration baseline.

## Current State

All Phase 1 functionality is implemented:

- Full OIDC protocol: `/authorize`, `/token`, `/session/check`, `/logout`, OIDC discovery, JWKS
- Browser SDK with PKCE S256, session monitoring (auto-stop on `login_required`), strict `checkSession` parsing, aud pre-validation
- React hook with token-based session state transitions for broker-backed auth
- Hosted script (`/avs-auth.js`) with AVS-native globals and events
- Broker UX: landing, sign-in, consent, profile, authorized-sites, legal, error, no-session pages
- Pairwise subject derivation, domain-derived `client_id`, optional PII consent gating
- Admin routes: key rotation, client block/unblock, session revocation, audit listing

Phase 2 (hardening) is in progress: rate-limit depth, key rollover rigor, operator enforcement, full Convex module test coverage.

## Release Gate

- [Parity checklist](docs/parity-checklist.md)
- [Implementation plan](docs/implementation-plan.md)
- [Test matrix](docs/test-matrix.md)

## Verification

```bash
pnpm turbo run test --force      # all suites, no --passWithNoTests
pnpm turbo run typecheck          # type safety
```
