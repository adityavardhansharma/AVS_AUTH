# AVS AUTH

AVS AUTH is a Shoo-style authentication broker for `auth.adityavs.tech`.

This repository contains:

- `@avs-auth/types`
- `@avs-auth/oidc-core`
- `@avs-auth/auth`
- `@avs-auth/react`
- `edge-gateway` Cloudflare Worker
- broker and docs scaffolds

The product requirement is locked to full Shoo parity as a minimum bar. AVS AUTH may add security and operator features, but it may not ship with fewer public features than Shoo.

## Release Gate

- [Shoo parity checklist](/D:/AVS_AUTH/docs/parity-checklist.md)
- [Implementation plan](/D:/AVS_AUTH/docs/implementation-plan.md)
- [Test matrix](/D:/AVS_AUTH/docs/test-matrix.md)

## Current State

This repo is still in scaffold stage:

- `packages/auth`, `packages/react`, and `packages/oidc-core` contain partial parity implementations
- `services/edge-gateway` currently serves demo routes and placeholder token/session responses
- `apps/broker-web`, `apps/docs`, and `services/convex` still need production implementations

Do not treat the current worker or UI as release-ready.
