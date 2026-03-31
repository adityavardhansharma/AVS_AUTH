# Broker Web

This scaffold is reserved for a future standalone broker UI application.

The production broker UI is currently served by the `services/edge-gateway` Cloudflare Worker as inline HTML. All required UX flows are implemented there:

- `/` — landing page (signed-in and signed-out variants)
- `/sign-in` — Google sign-in with transaction context and fast-path
- `/consent` — origin display, PII request, grant/deny
- `/me` — profile page with session info and sign-out
- `/authorized-sites` — consent list with per-site revoke
- `/no-session` — prompt to sign in
- `/error` — safe user-facing error with correlation ID
- `/privacy` and `/terms` — legal pages

If a framework-based UI is needed in the future, this scaffold can be activated. Until then, the Worker inline HTML is the production surface and satisfies all parity requirements.

See:
- [parity-checklist.md](../../docs/parity-checklist.md)
- [implementation-plan.md](../../docs/implementation-plan.md)
