# Getting Started (React)

Add authentication to your React app in minutes with `@avs-auth/react`.

## Install

```bash
npm install @avs-auth/react
```

## Basic usage

```tsx
import { useAvsAuth } from "@avs-auth/react";

function App() {
  const { identity, claims, sessionState, loading, error, signIn, clearIdentity } = useAvsAuth({
    callbackPath: "/auth/callback"
  });

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Auth error: {error}</p>;

  if (!identity.userId) {
    return <button onClick={() => signIn()}>Sign In</button>;
  }

  return (
    <div>
      <p>Signed in as {claims?.email ?? identity.userId}</p>
      <p>Session: {sessionState}</p>
      <button onClick={() => clearIdentity()}>Sign Out</button>
    </div>
  );
}
```

## How it works

1. `useAvsAuth` initializes with the stored identity from `localStorage`.
2. When the user clicks "Sign In", they are redirected to `auth.adityavs.tech`.
3. After authenticating with Google, they are redirected back to your callback path.
4. The hook automatically exchanges the authorization code for an `id_token`.
5. The identity is persisted in `localStorage` for subsequent page loads.

## Configuration options

```tsx
useAvsAuth({
  avsBaseUrl: "https://auth.adityavs.tech",
  callbackPath: "/auth/callback",
  requestPii: false,
  autoHandleCallback: true,
  autoSessionMonitor: true,
  sessionMonitorIntervalMs: 60000,
  storageKey: "avs_auth_identity"
});
```

## Returned values

- **identity**: `{ userId, token, expiresIn, receivedAt }` or `{ userId: null }` when signed out
- **claims**: Decoded JWT claims including `sub`, `pairwise_sub`, `iss`, `aud`, `iat`, `exp`
- **sessionState**: `"unknown"`, `"active"`, or `"login_required"`
- **loading**: `true` during initial load or callback processing
- **error**: Error message string or `null`
- **signIn(options?)**: Start the sign-in flow
- **handleCallback(options?)**: Manually handle the callback
- **checkSession(options?)**: Check session status
- **refreshIdentity()**: Re-read identity from storage
- **clearIdentity()**: Clear stored identity (sign out locally)

## Convex integration

```tsx
import { createAvsConvexAuth } from "@avs-auth/react";

const { useAuth, signIn, signOut } = createAvsConvexAuth({
  callbackPath: "/auth/callback"
});
```

## Callback route

Make sure your callback path renders the same React app. The hook will detect the callback URL and handle the code exchange automatically.

For Next.js App Router, ensure your callback route is a valid page that renders the component using `useAvsAuth`.
