# AVS AUTH Implementation Plan

This plan defines the shipped AVS AUTH baseline.

## Target Architecture

- `services/edge-gateway`
  - Cloudflare Worker implementing all OIDC endpoints (`/authorize`, `/token`, `/session/check`, `/logout`), OIDC discovery, JWKS, Google OAuth, consent flows, hosted script (`/avs-auth.js`), broker UI pages (inline HTML), admin routes, security headers, CORS, and rate limiting (Convex mode).
- `services/convex`
  - Durable backend with complete schema and `ctx.db.*` implementations for sessions, transactions, consents, clients, codes, keys, pairwise subjects, audits, and rate-limit metrics.
- `apps/broker-web`
  - Reserved scaffold. The Worker inline HTML serves all production broker pages. This scaffold exists as a future option for a framework-based UI.
- `apps/docs`
  - Static documentation site with 7 content files (introduction, getting started React/vanilla, how it works, server verification, Convex guide, API reference) and a build pipeline.
- `packages/types`
  - Shared protocol, SDK, and React type contracts. Types-only package with export contract test.
- `packages/oidc-core`
  - Client derivation, request validation, PKCE verification, pairwise subject derivation (HMAC-SHA256), token issuance (ES256 via JOSE), key generation, OIDC configuration builder, session check response builder.
- `packages/auth`
  - Browser SDK with PKCE S256 sign-in, callback handling, identity persistence, session monitoring (auto-stop on `login_required`), strict `checkSession` response parsing, aud pre-validation, and hosted-script runtime.
- `packages/react`
  - React hook (`useAvsAuth`) with token-based session state transitions for AVS AUTH, and Convex integration helper (`createAvsConvexAuth`).

## Phase Gate Sequence

1. Parity inventory lock — keep [parity-checklist.md](parity-checklist.md) current; no scope reductions allowed
2. Protocol core — OIDC metadata, JWKS, authorize, token, session-check, logout, code storage (**done**)
3. Google and broker session — upstream Google login, callback resolution, broker cookie lifecycle, repeat sign-in fast-path (**done**)
4. Consent and account UX — consent grant or deny, profile page, authorized sites, revoke flows, error and no-session states (**done**)
5. SDK parity — package APIs, hosted script bootstrap, callback automation, session monitoring, strict `checkSession`, aud validation (**done**)
6. Docs parity — React, vanilla, hosted script, server verification, Convex guide, API reference (**done**)
7. Hardening — key rotation, audits, abuse blocks, operator tooling, CSP tightening, operational runbooks (**in progress**)

## Durable Data Model

| Collection | Purpose | Required Fields |
| --- | --- | --- |
| `users` | broker users mapped to Google accounts | google subject, profile snapshot, status, timestamps |
| `broker_sessions` | central broker sessions | user id, session id, expiry, revocation status, last seen |
| `clients` | auto-derived relying-party origins | client id, origin, first seen, status, blocked state |
| `consents` | persistent consent per user and client | user id, client id, pii granted, granted at, revoked at |
| `auth_transactions` | in-flight authorize requests | state, nonce, redirect uri, client id, code challenge, session linkage |
| `authorization_codes` | one-time exchange artifacts | code, transaction id, redeemed at, expires at |
| `pairwise_subjects` | observability and revocation mapping | user id, client id, pairwise sub |
| `signing_keys` | active and historical ES256 keys | kid, jwk, private material reference, status, created at |
| `audit_events` | security-sensitive event stream | actor, action, target, correlation id, metadata, timestamp |
| `origin_metrics` | abuse control and usage tracking | client id, counters, last seen, rate-limit state |

## Non-Negotiable Runtime Rules

- `client_id` must equal `origin:${new URL(redirect_uri).origin}`
- production redirect URIs must use `https`, with local exceptions only for development
- browser clients use PKCE S256 only
- raw Google `sub` never leaves broker boundaries
- `sub` in issued tokens equals `pairwise_sub`
- every auth code is one-time and short-lived
- broker cookie must be `HttpOnly`, `Secure`, and `SameSite=Lax` or stricter where compatible
- no token or code values in logs

## Remaining Work (Hardening Phase)

- Rate limiting completeness: in-memory dev-mode limiter, threshold tests, `Retry-After` assertions, audit event logging for limit hits.
- Key rotation/JWKS rollover safety: serve both current and previous keys during TTL window, test old token verification during rollover.
- Operator effectiveness: enforce blocked-client state in auth path (not just admin surface), audit writes for all admin operations.
- Convex module test coverage: `transactions`, `clients`, `operator`, `auditEvents`, `originMetrics`.
