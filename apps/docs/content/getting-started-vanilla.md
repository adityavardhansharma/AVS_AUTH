# Getting Started (Vanilla JS)

Add authentication to any web app with a single script tag or the `@avs-auth/auth` npm package.

## Option 1: Script tag (zero npm)

Add this to your HTML:

```html
<script src="https://auth.adityavs.tech/avs-auth.js"></script>
<a data-avs-auth href="#">Sign In</a>
```

That's it. The script will:

- Auto-handle the callback when the user returns to `/avs-auth/callback`
- Upgrade any `<a data-avs-auth>` or `<button data-avs-auth>` to sign-in triggers
- Start a session monitor that dispatches `avs-auth:login-required` when the session expires

### Script tag options

Configure via `data-*` attributes:

```html
<script
  src="https://auth.adityavs.tech/avs-auth.js"
  data-callback-path="/auth/callback"
  data-request-pii="true"
  data-auto-handle-callback="true"
  data-monitor-session="true"
  data-session-monitor-interval-ms="60000"
  data-storage-key="avs_auth_identity"
></script>
```

### Using the global API

```javascript
await window.AvsAuth.startSignIn({ requestPii: true });

const identity = window.AvsAuth.getIdentity();
const claims = window.AvsAuth.decodeIdentityClaims(identity.token);

const result = await window.AvsAuth.checkSession();
if (result.status === "login_required") {
  window.AvsAuth.clearIdentity();
}
```

## Option 2: npm package

```bash
npm install @avs-auth/auth
```

```javascript
import { createAvsAuth } from "@avs-auth/auth";

const auth = createAvsAuth({ callbackPath: "/auth/callback" });

document.getElementById("sign-in-btn").addEventListener("click", () => {
  auth.startSignIn();
});

if (window.location.pathname === "/auth/callback") {
  const token = await auth.handleCallback();
  if (token) {
    console.log("Signed in:", token.pairwise_sub);
  }
}
```

## Listening for session events

```javascript
window.addEventListener("avs-auth:login-required", (event) => {
  console.log("Session expired:", event.detail.reason);
  window.AvsAuth.clearIdentity();
});
```
