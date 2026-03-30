# @avs-auth/react

React hooks wrapper for `@avs-auth/auth`, aligned to the public Shoo React package surface.

## Install

```bash
npm install @avs-auth/react @avs-auth/auth
```

## Usage

```tsx
import { useAvsAuth } from "@avs-auth/react";

export function App() {
  const auth = useAvsAuth({
    avsBaseUrl: "https://auth.adityavs.tech",
    callbackPath: "/auth/callback",
    autoSessionMonitor: true,
    sessionMonitorIntervalMs: 60_000
  });

  return (
    <div>
      <button onClick={() => void auth.signIn()}>Sign In</button>
      <button onClick={() => void auth.checkSession()}>Check Session</button>
      <p>{auth.identity.userId ?? "Signed out"}</p>
      <p>Session state: {auth.sessionState}</p>
    </div>
  );
}
```

## Public API

- `useAvsAuth`
- `createAvsConvexAuth`
- `createAvsAuth`
- `decodeIdentityClaims`
