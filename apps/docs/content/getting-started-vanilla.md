# Getting Started (Vanilla JS)

Add authentication to any web app with a single script tag or the `@avs-auth/auth` npm package.

## Option 1: Script tag (zero npm)

Add this to your HTML:

```html
<script src="https://auth.adityavs.tech/avs-auth.js"></script>
<a href="https://auth.adityavs.tech/authorize?redirect_uri=https://yourapp.com/avs-auth/callback">Sign In</a>
```

That's it. The script will:

- Auto-handle the callback when the user returns to `/avs-auth/callback`
- Upgrade qualifying `/authorize?...` links into PKCE sign-in starts
- Start a session monitor that dispatches `avs-auth:login-required` when the session expires

### Script tag options

Configure via `data-*` attributes:

```html
<script
  src="https://auth.adityavs.tech/avs-auth.js"
  data-avs-callback-path="/auth/callback"
  data-avs-pii="true"
  data-avs-auto-callback="true"
  data-avs-auto-session-monitor="true"
  data-avs-session-monitor-interval-ms="60000"
  data-avs-storage-key="avs_auth_identity"
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
import { createAvsAuth, isCallbackRoute } from "@avs-auth/auth";

const auth = createAvsAuth({ callbackPath: "/auth/callback" });

document.getElementById("sign-in-btn").addEventListener("click", () => {
  auth.startSignIn();
});

// On the callback route, exchange the code and redirect back automatically
if (isCallbackRoute("/auth/callback")) {
  // handleCallback exchanges the code, stores the identity, and redirects
  // to the page the user was on before sign-in (or "/" by default)
  await auth.handleCallback();
}

// Read the stored identity on any page
const identity = auth.getIdentity();
if (identity.userId) {
  console.log("Signed in as:", identity.userId);
}
```

## Listening for session events

```javascript
window.addEventListener("avs-auth:login-required", (event) => {
  console.log("Session expired:", event.detail.reason);
  window.AvsAuth.clearIdentity();
});
```
