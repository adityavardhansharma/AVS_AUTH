# AVS AUTH Implementation Plan

This plan is locked to full Shoo parity as a floor, not an aspirational target.

## Target Architecture

- `services/edge-gateway`
  - Cloudflare Worker for OIDC endpoints, hosted script, headers, rate limits, request ids, and Google OAuth entry points.
- `services/convex`
  - durable sessions, transactions, consents, clients, codes, keys, pairwise subjects, audits, and operator mutations.
- `apps/broker-web`
  - public broker site at `auth.adityavs.tech` for landing, sign-in, consent, profile, authorized sites, and legal pages.
- `apps/docs`
  - public docs at `docs.auth.adityavs.tech` for quickstarts, architecture, verification, and API reference.
- `packages/types`
  - shared request, response, claims, and SDK contracts.
- `packages/oidc-core`
  - client derivation, request validation, pairwise subject derivation, token issuance, key handling.
- `packages/auth`
  - browser SDK and hosted-script runtime surface.
- `packages/react`
  - React hook and Convex integration helper.

## Phase Gate Sequence

1. Parity inventory lock
   - keep [parity-checklist.md](/D:/AVS_AUTH/docs/parity-checklist.md) current
   - no scope reductions allowed
2. Protocol core
   - complete OIDC metadata, JWKS, authorize, token, session-check, logout, and code storage
3. Google and broker session
   - upstream Google login, callback resolution, broker cookie lifecycle, repeat sign-in fast-path
4. Consent and account UX
   - consent grant or deny, profile page, authorized sites, revoke flows, error and no-session states
5. SDK parity
   - package APIs, hosted script bootstrap, callback automation, session monitoring
6. Docs parity
   - React, vanilla, hosted script, server verification, Convex guide, API reference
7. Hardening
   - key rotation, audits, abuse blocks, operator tooling, CSP tightening, operational runbooks

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

## Remaining Repository Gaps

- `apps/broker-web` is still a placeholder and needs a real app
- `apps/docs` needs actual docs pages rather than a README stub
- `services/convex` has no schema or functions yet
- `services/edge-gateway` is still demo-mode for sign-in, token issue, and hosted script
- integration and browser tests are still missing outside `packages/oidc-core`
