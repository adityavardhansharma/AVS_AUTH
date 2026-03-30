# Convex Integration

AVS AUTH integrates with Convex for both the backend storage layer and as a client-side auth adapter.

## Client-side: React + Convex

Use `createAvsConvexAuth` from `@avs-auth/react` to create a Convex-compatible auth adapter:

```tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { createAvsConvexAuth } from "@avs-auth/react";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const { useAuth, signIn, signOut } = createAvsConvexAuth({
  callbackPath: "/auth/callback"
});

function App() {
  return (
    <ConvexProvider client={convex} useAuth={useAuth}>
      <Content />
    </ConvexProvider>
  );
}
```

## How useAuth works

The `useAuth()` hook returned by `createAvsConvexAuth` implements the Convex auth contract:

- **isLoading**: `true` during initial identity resolution
- **isAuthenticated**: `true` when a valid identity exists in localStorage
- **fetchAccessToken()**: Returns the stored `id_token` for Convex to use as a bearer token

## Backend: AVS AUTH on Convex

AVS AUTH uses Convex as its durable storage backend. The schema includes:

- **users**: Broker user accounts linked to Google
- **broker_sessions**: Central session management
- **consents**: Per-user, per-app consent records
- **auth_transactions**: In-flight authorization requests
- **authorization_codes**: One-time exchange artifacts
- **pairwise_subjects**: User-to-origin subject mapping
- **signing_keys**: ES256 key rotation tracking
- **audit_events**: Security event stream

## Deployment model

The edge gateway (Cloudflare Worker) handles all protocol logic. Convex provides persistence. The two communicate over Convex's HTTP admin API.
