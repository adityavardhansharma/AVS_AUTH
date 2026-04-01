# @avs-auth/auth

Framework-agnostic AVS AUTH client for browser apps.

## Install

```bash
npm install @avs-auth/auth
```

## Usage

```ts
import { createAvsAuth } from "@avs-auth/auth";

const auth = createAvsAuth({
  avsBaseUrl: "https://auth.adityavs.tech",
  callbackPath: "/auth/callback"
});

await auth.startSignIn();
await auth.handleCallback();

const identity = auth.getIdentity();
console.log(identity.userId);

const session = await auth.checkSession();
if (session.status === "login_required") {
  auth.clearIdentity();
}
```

## Public API

- `createAvsAuth`
- `deriveClientIdFromRedirectUri`
- `createPkceBundle`
- `createSignInUrl`
- `parseCallback`
- `clearCallbackParams`
- `getIdentity`
- `persistIdentity`
- `clearIdentity`
- `decodeIdentityClaims`
- `exchangeCode`
- `checkSession`
- `startSessionMonitor`
- `startSignIn`
- `finishSignIn`
- `handleCallback`

## Notes

- Browser-only package.
- Browser token exchange supports public clients only.
- `checkSession()` returns `active`, `login_required`, or `unsupported`.
