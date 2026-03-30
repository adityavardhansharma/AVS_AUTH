# Convex Service

This folder is reserved for the AVS AUTH Convex deployment and is the durable state backend for the broker.

Planned collections/functions:

- users
- broker_sessions
- clients
- consents
- auth_transactions
- authorization_codes
- pairwise_subjects
- signing_keys
- audit_events
- origin_metrics

Required responsibilities:

- broker session persistence
- auth transaction and authorization code storage
- consent grant and revoke state
- pairwise subject materialization
- signing key lifecycle
- audit logging
- operator actions such as revocation, client blocking, and key rotation

Implementation scope is defined in:

- [parity-checklist.md](/D:/AVS_AUTH/docs/parity-checklist.md)
- [implementation-plan.md](/D:/AVS_AUTH/docs/implementation-plan.md)
