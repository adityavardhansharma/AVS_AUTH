import {
  buildAuthorizationCodeRecord,
  buildAuthorizeRequestRecord,
  buildSessionCheckResponse,
  createOpenIdConfiguration,
  derivePairwiseSub,
  generateSigningKeySet,
  isCodeRedeemable,
  issueIdToken,
  OidcError,
  parseJwks,
  shouldIncludePiiClaims,
  validateAuthorizeRequest,
  validateTokenRequest,
  verifyPkce
} from "@avs-auth/oidc-core";
import { callConvexMutation, callConvexQuery, hasConvexConfig } from "./convex";
import type {
  AuthorizedSite,
  BrokerSessionSummary,
  BrokerUserProfile,
  Jwk,
  LogoutResponse,
  TokenRequest,
  TokenResponse
} from "@avs-auth/types";

type Env = {
  ISSUER: string;
  ENVIRONMENT: "development" | "production";
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  PAIRWISE_SECRET?: string;
  JWKS_JSON?: string;
  DOCS_BASE_URL?: string;
  CONVEX_URL?: string;
  CONVEX_ADMIN_KEY?: string;
};

type UserRecord = { userId: string; profile: BrokerUserProfile };
type SessionRecord = BrokerSessionSummary & { googleSub?: string };
type ConsentRecord = {
  userId: string;
  clientId: string;
  origin: string;
  piiGranted: boolean;
  grantedAt: number;
  revokedAt?: number;
  lastUsedAt?: number;
};
type TransactionRecord = ReturnType<typeof buildAuthorizeRequestRecord> & {
  userId?: string;
  sessionId?: string;
};
type CodeRecord = ReturnType<typeof buildAuthorizationCodeRecord>;
type PairwiseRecord = { userId: string; clientId: string; pairwiseSub: string };

// In-memory fallback for development without Convex
const db = {
  users: new Map<string, UserRecord>(),
  sessions: new Map<string, SessionRecord>(),
  consents: new Map<string, ConsentRecord>(),
  transactions: new Map<string, TransactionRecord>(),
  codes: new Map<string, CodeRecord>(),
  pairwiseByUserClient: new Map<string, PairwiseRecord>(),
  pairwiseBySub: new Map<string, PairwiseRecord>()
};

const signingKeyPromise = generateSigningKeySet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convex(env: Env) {
  return hasConvexConfig({ convexUrl: env.CONVEX_URL, convexAdminKey: env.CONVEX_ADMIN_KEY });
}

function cvxQ<T>(env: Env, fn: string, args: Record<string, unknown>) {
  return callConvexQuery<T>({ convexUrl: env.CONVEX_URL, convexAdminKey: env.CONVEX_ADMIN_KEY }, fn, args);
}

function cvxM<T>(env: Env, fn: string, args: Record<string, unknown>) {
  return callConvexMutation<T>({ convexUrl: env.CONVEX_URL, convexAdminKey: env.CONVEX_ADMIN_KEY }, fn, args);
}

function correlationId(): string {
  return `req_${crypto.randomUUID()}`;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init?.headers
    }
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400"
  };
}

const CSS = `
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f0e5;color:#1a1714;margin:0;line-height:1.6}
main{max-width:720px;margin:0 auto;padding:48px 24px}
.card{padding:32px;border:1px solid rgba(23,20,17,0.12);border-radius:20px;background:#fffdf8;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
h1{font-size:1.6rem;margin:0 0 12px;font-weight:700}
h2{font-size:1.2rem;margin:24px 0 8px;font-weight:600}
p{margin:8px 0}
a{color:#0e6b59}
.btn{display:inline-flex;align-items:center;padding:10px 20px;border-radius:999px;background:#0e6b59;color:#fff;text-decoration:none;border:0;cursor:pointer;font-size:0.95rem;font-weight:500;transition:background 0.15s;margin:4px 8px 4px 0}
.btn:hover{background:#0a5447}
.btn.secondary{background:transparent;color:#0e6b59;border:1.5px solid #0e6b59}
.btn.secondary:hover{background:#0e6b5910}
.btn.danger{background:#b91c1c;color:#fff;border:0}
.btn.danger:hover{background:#991b1b}
code{background:rgba(23,20,17,0.06);padding:2px 8px;border-radius:6px;font-size:0.9em}
.profile-header{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.profile-header img{width:56px;height:56px;border-radius:50%;border:2px solid rgba(23,20,17,0.1)}
.site-list{list-style:none;padding:0;margin:16px 0}
.site-list li{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:1px solid rgba(23,20,17,0.08);border-radius:12px;margin-bottom:8px;background:#fff}
.site-info{display:flex;flex-direction:column;gap:2px}
.site-origin{font-weight:600}
.site-meta{font-size:0.85em;color:#666}
.consent-box{text-align:center;padding:24px 0}
.consent-origin{font-size:1.1rem;font-weight:600;margin:12px 0}
.consent-detail{color:#555;margin:8px 0 24px}
.actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
footer{margin-top:32px;padding-top:16px;border-top:1px solid rgba(23,20,17,0.08);font-size:0.85em;color:#666;text-align:center}
footer a{color:#0e6b59;margin:0 8px}
.nav{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
.alert{padding:12px 16px;border-radius:12px;margin-bottom:16px}
.alert.info{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}
.alert.warning{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}
.empty{text-align:center;padding:32px 16px;color:#888}
.mono{font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace}
`;

function html(title: string, body: string, init?: ResponseInit): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(title)} - AVS AUTH</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`,
    {
      ...init,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "x-xss-protection": "1; mode=block",
        "strict-transport-security": "max-age=31536000; includeSubDomains",
        ...init?.headers
      }
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseFormBody(request: Request): Promise<URLSearchParams> {
  return request.text().then((body) => new URLSearchParams(body));
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    })
  );
}

function parseBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function parseClaims(token: string | null): { sub?: string; aud?: string; exp?: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function footerHtml(env: Env): string {
  const docsUrl = escapeHtml(env.DOCS_BASE_URL ?? "https://docs.auth.adityavs.tech");
  return `<footer><a href="/">Home</a><a href="${docsUrl}">Docs</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>`;
}

// ---------------------------------------------------------------------------
// Data access (dual-mode: Convex or in-memory)
// ---------------------------------------------------------------------------

async function getSessionFromRequest(request: Request, env: Env): Promise<SessionRecord | null> {
  const sessionId = parseCookies(request).avs_session;
  if (!sessionId) return null;
  if (convex(env)) {
    return await cvxQ<SessionRecord | null>(env, "sessions:getBrokerSession", { sessionId });
  }
  const session = db.sessions.get(sessionId) ?? null;
  if (!session || session.revokedAt || session.expiresAt <= Date.now()) return null;
  session.lastSeenAt = Date.now();
  return session;
}

function setSessionCookie(sessionId: string, env: Env): string {
  const secure = env.ENVIRONMENT === "production" ? "; Secure" : "";
  return `avs_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600${secure}`;
}

function clearSessionCookie(env: Env): string {
  const secure = env.ENVIRONMENT === "production" ? "; Secure" : "";
  return `avs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function getConsentKey(userId: string, clientId: string): string {
  return `${userId}|${clientId}`;
}

async function getConsent(userId: string, clientId: string, env: Env): Promise<ConsentRecord | null> {
  if (convex(env)) {
    return await cvxQ<ConsentRecord | null>(env, "consents:getConsent", { userId, clientId });
  }
  const consent = db.consents.get(getConsentKey(userId, clientId)) ?? null;
  return consent && !consent.revokedAt ? consent : null;
}

async function listAuthorizedSites(userId: string, env: Env): Promise<AuthorizedSite[]> {
  if (convex(env)) {
    return await cvxQ<AuthorizedSite[]>(env, "consents:listAuthorizedSites", { userId });
  }
  return Array.from(db.consents.values())
    .filter((c) => c.userId === userId && !c.revokedAt)
    .map((c) => ({ clientId: c.clientId, origin: c.origin, piiGranted: c.piiGranted, grantedAt: c.grantedAt, lastUsedAt: c.lastUsedAt }));
}

async function upsertUser(profile: BrokerUserProfile, env: Env): Promise<UserRecord> {
  if (convex(env)) {
    return await cvxM<UserRecord>(env, "users:upsertUserFromGoogleProfile", { profile });
  }
  const existing = Array.from(db.users.values()).find((u) => u.profile.googleSub === profile.googleSub);
  if (existing) {
    existing.profile = profile;
    return existing;
  }
  const user = { userId: `usr_${crypto.randomUUID()}`, profile };
  db.users.set(user.userId, user);
  return user;
}

async function createSession(user: UserRecord, env: Env): Promise<SessionRecord> {
  const now = Date.now();
  const sessionId = `sess_${crypto.randomUUID()}`;
  const expiresAt = now + 14 * 24 * 60 * 60 * 1000;
  if (convex(env)) {
    return await cvxM<SessionRecord>(env, "sessions:createBrokerSession", {
      sessionId, userId: user.userId, expiresAt, lastSeenAt: now
    });
  }
  const session: SessionRecord = { sessionId, userId: user.userId, expiresAt, lastSeenAt: now };
  db.sessions.set(sessionId, session);
  return session;
}

async function getUserById(userId: string, env: Env): Promise<UserRecord | null> {
  if (convex(env)) {
    return await cvxQ<UserRecord | null>(env, "users:getUserById", { userId });
  }
  return db.users.get(userId) ?? null;
}

async function getTransaction(transactionId: string | null, env: Env): Promise<TransactionRecord | null> {
  if (!transactionId) return null;
  if (convex(env)) {
    return await cvxQ<TransactionRecord | null>(env, "transactions:getAuthTransaction", { transactionId });
  }
  const tx = db.transactions.get(transactionId) ?? null;
  if (!tx || tx.expiresAt <= Date.now() || tx.status === "expired") return null;
  return tx;
}

async function getPairwise(user: UserRecord, clientId: string, env: Env): Promise<PairwiseRecord> {
  if (convex(env)) {
    return await cvxM<PairwiseRecord>(env, "pairwiseSubjects:getOrCreatePairwiseSubject", {
      userId: user.userId, clientId, pairwiseSub: null
    });
  }
  const key = `${user.userId}|${clientId}`;
  const existing = db.pairwiseByUserClient.get(key);
  if (existing) return existing;
  const pairwiseSub = await derivePairwiseSub({
    pairwiseSecret: env.PAIRWISE_SECRET ?? "dev_pairwise_secret",
    googleSub: user.profile.googleSub,
    clientId
  });
  const record = { userId: user.userId, clientId, pairwiseSub };
  db.pairwiseByUserClient.set(key, record);
  db.pairwiseBySub.set(pairwiseSub, record);
  return record;
}

async function getGoogleProfile(env: Env, code: string): Promise<BrokerUserProfile> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI || code.startsWith("mock-")) {
    if (env.ENVIRONMENT === "production") {
      throw new OidcError("server_error", "Google OAuth not configured", 500);
    }
    return { googleSub: "google-demo-user", email: "demo@adityavs.tech", emailVerified: true, name: "Demo User", picture: "https://www.gravatar.com/avatar?d=mp" };
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code"
    })
  });
  if (!tokenResponse.ok) throw new OidcError("server_error", "Failed Google token exchange", 502);
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new OidcError("server_error", "Google access token missing", 502);
  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  if (!userInfoResponse.ok) throw new OidcError("server_error", "Failed Google userinfo", 502);
  const profile = (await userInfoResponse.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  return { googleSub: profile.sub, email: profile.email, emailVerified: profile.email_verified, name: profile.name, picture: profile.picture };
}

// ---------------------------------------------------------------------------
// Hosted script source
// ---------------------------------------------------------------------------

function scriptSource(): string {
  return `(function(){var base=new URL(document.currentScript&&document.currentScript.src?document.currentScript.src:window.location.origin).origin;function p(u){var x=new URL(u||window.location.href,window.location.origin);var c=x.searchParams.get("code"),s=x.searchParams.get("state");return c&&s?{code:c,state:s}:null}function cc(u){var x=new URL(u||window.location.href,window.location.origin);x.searchParams.delete("code");x.searchParams.delete("state");x.searchParams.delete("error");history.replaceState({}, "",x.pathname+x.search+x.hash);return x.toString()}function gi(k){var r=localStorage.getItem(k||"avs_auth_identity");return r?JSON.parse(r):{userId:null}}function pi(u,t,k,e){localStorage.setItem(k||"avs_auth_identity",JSON.stringify({userId:u,token:t,expiresIn:e&&e.expiresIn,receivedAt:Date.now()}))}function ci(k){localStorage.removeItem(k||"avs_auth_identity")}function di(t){if(!t)return null;var p=t.split(".");if(p.length<2)return null;return JSON.parse(atob(p[1].replace(/-/g,"+").replace(/_/g,"/")))}async function pk(){var ch='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';function r(l){var b=crypto.getRandomValues(new Uint8Array(l)),o='';for(var i=0;i<b.length;i++)o+=ch[b[i]%ch.length];return o}var v=r(64),s=r(32),d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));var a=Array.from(new Uint8Array(d));var c=btoa(String.fromCharCode.apply(null,a)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');return{verifier:v,state:s,challenge:c}}function su(p){var u=new URL("/authorize",p.avsBaseUrl||base);u.searchParams.set("client_id",p.clientId||("origin:"+new URL(p.redirectUri).origin));u.searchParams.set("redirect_uri",p.redirectUri);u.searchParams.set("state",p.state);u.searchParams.set("code_challenge",p.codeChallenge);u.searchParams.set("code_challenge_method","S256");if(p.requestPii)u.searchParams.set("pii","true");return u.toString()}async function ex(p){var r=await fetch(new URL("/token",p.avsBaseUrl||base),{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:p.clientId,redirect_uri:p.redirectUri,code:p.code,code_verifier:p.codeVerifier})});if(!r.ok)throw new Error("Token exchange failed ("+r.status+")");return r.json()}async function ss(o){var i=gi(o&&o.storageKey),t=o&&o.token?o.token:i.token;if(!t)return{status:"login_required",reason:"invalid_token"};var r=await fetch(new URL("/session/check",(o&&o.avsBaseUrl)||base),{method:"POST",headers:{Authorization:"Bearer "+t}});return r.status===404||r.status===501?{status:"unsupported"}:r.json()}async function si(o){var cb=(o&&o.callbackPath)||"/avs-auth/callback";var ru=(o&&o.redirectUri)||new URL(cb,window.location.origin).toString();var b=await pk();sessionStorage.setItem("avs_auth_pkce",JSON.stringify({state:b.state,verifier:b.verifier,createdAt:Date.now()}));window.location.assign(su({avsBaseUrl:(o&&o.avsBaseUrl)||base,redirectUri:ru,clientId:(o&&o.clientId)||("origin:"+new URL(ru).origin),state:b.state,codeChallenge:b.challenge,requestPii:o&&o.requestPii}));return b}async function fs(o){var c=p((o&&o.url)||window.location.href);if(!c)return null;var pk=JSON.parse(sessionStorage.getItem("avs_auth_pkce")||"null");if(!pk||pk.state!==c.state)throw new Error("State mismatch in callback");var cb=(o&&o.callbackPath)||"/avs-auth/callback";var ru=(o&&o.redirectUri)||new URL(cb,window.location.origin).toString();var token=await ex({avsBaseUrl:(o&&o.avsBaseUrl)||base,clientId:(o&&o.clientId)||("origin:"+new URL(ru).origin),redirectUri:ru,code:c.code,codeVerifier:pk.verifier});pi(token.pairwise_sub,token.id_token,(o&&o.storageKey)||"avs_auth_identity",{expiresIn:token.expires_in});sessionStorage.removeItem("avs_auth_pkce");cc();return token}function sm(o){var timer=setInterval(async function(){try{var r=await ss(o||{});if(r.status==="login_required"){clearInterval(timer);if(o&&o.onLoginRequired)o.onLoginRequired(r);window.dispatchEvent(new CustomEvent("avs-auth:login-required",{detail:r}))}}catch(e){if(o&&o.onError)o.onError(e)}},(o&&o.intervalMs)||60000);return{stop:function(){clearInterval(timer)}}}var ds=document.currentScript;var opts={callbackPath:(ds&&ds.dataset.callbackPath)||"/avs-auth/callback",requestPii:ds&&ds.dataset.requestPii==="true",autoHandleCallback:!(ds&&ds.dataset.autoHandleCallback==="false"),monitorSession:!(ds&&ds.dataset.monitorSession==="false"),sessionMonitorIntervalMs:parseInt((ds&&ds.dataset.sessionMonitorIntervalMs)||"60000",10),linkSelector:(ds&&ds.dataset.linkSelector)||"a[data-avs-auth],button[data-avs-auth]",storageKey:(ds&&ds.dataset.storageKey)||"avs_auth_identity",debug:ds&&ds.dataset.debug==="true"};window.AvsAuth={defaults:{avsBaseUrl:base,callbackPath:opts.callbackPath,storageKey:opts.storageKey},createPkceBundle:pk,createSignInUrl:su,parseCallback:p,clearCallbackParams:cc,startSignIn:si,finishSignIn:fs,handleCallback:fs,exchangeCode:ex,checkSession:ss,startSessionMonitor:sm,getIdentity:gi,persistIdentity:pi,clearIdentity:ci,decodeIdentityClaims:di};if(opts.autoHandleCallback&&window.location.pathname===opts.callbackPath){void window.AvsAuth.handleCallback()}document.querySelectorAll(opts.linkSelector).forEach(function(n){n.addEventListener('click',function(e){e.preventDefault();void window.AvsAuth.startSignIn({requestPii:n.getAttribute('data-avs-auth-pii')==='true'})})});if(opts.monitorSession&&gi(opts.storageKey).userId){sm({intervalMs:opts.sessionMonitorIntervalMs,storageKey:opts.storageKey})}})();`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const reqId = correlationId();

    // Handle CORS preflight for API endpoints
    if (request.method === "OPTIONS" && (url.pathname === "/token" || url.pathname === "/session/check" || url.pathname === "/logout")) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      // ---- Landing page ----
      if (url.pathname === "/") {
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        if (user) {
          const name = escapeHtml(user.profile.name ?? "User");
          const email = escapeHtml(user.profile.email ?? user.profile.googleSub);
          const pic = user.profile.picture ? `<img src="${escapeHtml(user.profile.picture)}" alt="" width="56" height="56"/>` : "";
          return html("Home", `
            <div class="card">
              <div class="profile-header">${pic}<div><h1>Welcome back, ${name}</h1><p>${email}</p></div></div>
              <div class="nav">
                <a class="btn" href="/me">Profile</a>
                <a class="btn secondary" href="/authorized-sites">Authorized Sites</a>
              </div>
            </div>
            ${footerHtml(env)}`);
        }
        return html("Home", `
          <div class="card">
            <h1>AVS AUTH</h1>
            <p>A minimal, privacy-first authentication broker with pairwise OIDC identity.</p>
            <p>Sign in once, then reuse your broker session across any app that integrates with AVS AUTH. Each app receives a unique, origin-scoped subject identifier.</p>
            <h2>For developers</h2>
            <p>Add authentication to your app with a single script tag:</p>
            <p><code>&lt;script src="${escapeHtml(env.ISSUER)}/avs-auth.js"&gt;&lt;/script&gt;</code></p>
            <p>Or install the SDK:</p>
            <p><code>npm install @avs-auth/auth</code> or <code>npm install @avs-auth/react</code></p>
            <div class="nav" style="margin-top:24px">
              <a class="btn" href="/sign-in">Sign In</a>
              <a class="btn secondary" href="${escapeHtml(env.DOCS_BASE_URL ?? "https://docs.auth.adityavs.tech")}">Documentation</a>
            </div>
          </div>
          ${footerHtml(env)}`);
      }

      // ---- OIDC Discovery ----
      if (url.pathname === "/.well-known/openid-configuration") {
        return json(createOpenIdConfiguration(env.ISSUER));
      }

      // ---- JWKS ----
      if (url.pathname === "/.well-known/jwks.json") {
        return json(env.JWKS_JSON ? parseJwks(env.JWKS_JSON) : { keys: [(await signingKeyPromise).publicJwk] as Jwk[] });
      }

      // ---- Authorize ----
      if (url.pathname === "/authorize" && request.method === "GET") {
        const validated = validateAuthorizeRequest({
          redirectUri: url.searchParams.get("redirect_uri") ?? "",
          clientId: url.searchParams.get("client_id") ?? undefined,
          state: url.searchParams.get("state") ?? "",
          codeChallenge: url.searchParams.get("code_challenge") ?? "",
          codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? "",
          nonce: url.searchParams.get("nonce") ?? undefined,
          env: env.ENVIRONMENT
        });
        const tx: TransactionRecord = {
          ...buildAuthorizeRequestRecord({
            clientId: validated.clientId,
            redirectUri: validated.redirectUri,
            state: url.searchParams.get("state") ?? "",
            nonce: validated.nonce,
            codeChallenge: url.searchParams.get("code_challenge") ?? "",
            codeChallengeMethod: "S256",
            requestPii: url.searchParams.get("pii") === "true"
          })
        };
        if (convex(env)) {
          await cvxM(env, "transactions:createAuthTransaction", tx);
        } else {
          db.transactions.set(tx.transactionId, tx);
        }
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        if (session && user) {
          tx.userId = user.userId;
          tx.sessionId = session.sessionId;
          tx.status = "authenticated";
          if (convex(env)) {
            await cvxM(env, "transactions:attachUserToTransaction", {
              transactionId: tx.transactionId, userId: user.userId, sessionId: session.sessionId, status: "authenticated"
            });
          }
          const consent = await getConsent(user.userId, tx.clientId, env);
          if (!tx.requestPii || consent?.piiGranted) {
            const codeRecord = buildAuthorizationCodeRecord({ transactionId: tx.transactionId, clientId: tx.clientId, redirectUri: tx.redirectUri, userId: user.userId });
            if (convex(env)) {
              await cvxM(env, "codes:createAuthorizationCode", codeRecord);
            } else {
              db.codes.set(codeRecord.code, codeRecord);
            }
            // Auto-grant basic consent if not yet granted
            if (!consent) {
              if (convex(env)) {
                await cvxM(env, "consents:grantConsent", { userId: user.userId, clientId: tx.clientId, piiGranted: false, grantedAt: Date.now(), lastUsedAt: Date.now() });
              } else {
                db.consents.set(getConsentKey(user.userId, tx.clientId), { userId: user.userId, clientId: tx.clientId, origin: new URL(tx.redirectUri).origin, piiGranted: false, grantedAt: Date.now(), lastUsedAt: Date.now() });
              }
            }
            const redirect = new URL(tx.redirectUri);
            redirect.searchParams.set("code", codeRecord.code);
            redirect.searchParams.set("state", tx.state);
            return Response.redirect(redirect.toString(), 302);
          }
          return Response.redirect(new URL(`/consent?tx=${encodeURIComponent(tx.transactionId)}`, env.ISSUER).toString(), 302);
        }
        return Response.redirect(new URL(`/sign-in?tx=${encodeURIComponent(tx.transactionId)}`, env.ISSUER).toString(), 302);
      }

      // ---- Sign-in page ----
      if (url.pathname === "/sign-in" && request.method === "GET") {
        const tx = await getTransaction(url.searchParams.get("tx"), env);
        const originDisplay = tx ? escapeHtml(tx.clientId.replace(/^origin:/, "")) : "";
        return html("Sign In", `
          <div class="card">
            <h1>Sign in to continue</h1>
            ${tx ? `<p>The application at <code>${originDisplay}</code> is requesting authentication.</p>` : "<p>Sign in to manage your AVS AUTH account.</p>"}
            <p>AVS AUTH uses a central broker session. After signing in with Google, you can authenticate with any integrated app without signing in again.</p>
            <div class="nav" style="margin-top:24px">
              <a class="btn" href="/auth/google/start${tx ? `?tx=${encodeURIComponent(tx.transactionId)}` : ""}">
                Continue with Google
              </a>
              <a class="btn secondary" href="/">Cancel</a>
            </div>
          </div>
          ${footerHtml(env)}`);
      }

      // ---- Google OAuth start ----
      if (url.pathname === "/auth/google/start" && request.method === "GET") {
        const tx = await getTransaction(url.searchParams.get("tx"), env);
        if (!tx) throw new OidcError("invalid_request", "Unknown or expired auth transaction");
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
          if (env.ENVIRONMENT === "production") {
            throw new OidcError("server_error", "Google OAuth not configured", 500);
          }
          return Response.redirect(new URL(`/auth/google/callback?code=mock-google-code&state=${encodeURIComponent(tx.transactionId)}`, env.ISSUER).toString(), 302);
        }
        const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        googleUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
        googleUrl.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
        googleUrl.searchParams.set("response_type", "code");
        googleUrl.searchParams.set("scope", "openid email profile");
        googleUrl.searchParams.set("state", tx.transactionId);
        return Response.redirect(googleUrl.toString(), 302);
      }

      // ---- Google OAuth callback ----
      if (url.pathname === "/auth/google/callback" && request.method === "GET") {
        const tx = await getTransaction(url.searchParams.get("state"), env);
        const code = url.searchParams.get("code") ?? "";
        if (!tx || !code) throw new OidcError("invalid_request", "Missing Google callback state");
        const profile = await getGoogleProfile(env, code);
        const user = await upsertUser(profile, env);
        const session = await createSession(user, env);
        tx.userId = user.userId;
        tx.sessionId = session.sessionId;
        tx.status = "authenticated";
        if (convex(env)) {
          await cvxM(env, "transactions:attachUserToTransaction", {
            transactionId: tx.transactionId, userId: user.userId, sessionId: session.sessionId, status: "authenticated"
          });
        }
        const headers = new Headers({ "set-cookie": setSessionCookie(session.sessionId, env) });
        if (tx.requestPii) {
          headers.set("location", new URL(`/consent?tx=${encodeURIComponent(tx.transactionId)}`, env.ISSUER).toString());
          return new Response(null, { status: 302, headers });
        }
        // Auto-grant basic consent
        if (convex(env)) {
          await cvxM(env, "consents:grantConsent", { userId: user.userId, clientId: tx.clientId, piiGranted: false, grantedAt: Date.now(), lastUsedAt: Date.now() });
        } else {
          db.consents.set(getConsentKey(user.userId, tx.clientId), { userId: user.userId, clientId: tx.clientId, origin: new URL(tx.redirectUri).origin, piiGranted: false, grantedAt: Date.now(), lastUsedAt: Date.now() });
        }
        const codeRecord = buildAuthorizationCodeRecord({ transactionId: tx.transactionId, clientId: tx.clientId, redirectUri: tx.redirectUri, userId: user.userId });
        if (convex(env)) {
          await cvxM(env, "codes:createAuthorizationCode", codeRecord);
        } else {
          db.codes.set(codeRecord.code, codeRecord);
        }
        const redirect = new URL(tx.redirectUri);
        redirect.searchParams.set("code", codeRecord.code);
        redirect.searchParams.set("state", tx.state);
        headers.set("location", redirect.toString());
        return new Response(null, { status: 302, headers });
      }

      // ---- Consent page (GET) ----
      if (url.pathname === "/consent" && request.method === "GET") {
        const tx = await getTransaction(url.searchParams.get("tx"), env);
        const user = tx?.userId ? await getUserById(tx.userId, env) : null;
        if (!tx || !user) {
          return html("No Session", `<div class="card"><h1>Session required</h1><p>Please sign in to continue this authorization request.</p><a class="btn" href="/sign-in">Sign In</a></div>${footerHtml(env)}`, { status: 401 });
        }
        const originDisplay = escapeHtml(tx.clientId.replace(/^origin:/, ""));
        return html("Consent", `
          <div class="card">
            <div class="consent-box">
              <h1>Grant access</h1>
              <p class="consent-origin">${originDisplay}</p>
              <p class="consent-detail">
                ${tx.requestPii
                  ? "This application is requesting access to your <strong>email address</strong>, <strong>name</strong>, and <strong>profile picture</strong>."
                  : "This application will receive a unique identifier but will <strong>not</strong> have access to your email, name, or picture."}
              </p>
              <div class="actions">
                <form method="post" action="/consent">
                  <input type="hidden" name="tx" value="${escapeHtml(tx.transactionId)}"/>
                  <input type="hidden" name="decision" value="grant"/>
                  <button class="btn" type="submit">${tx.requestPii ? "Allow access" : "Continue"}</button>
                </form>
                <form method="post" action="/consent">
                  <input type="hidden" name="tx" value="${escapeHtml(tx.transactionId)}"/>
                  <input type="hidden" name="decision" value="deny"/>
                  <button class="btn secondary" type="submit">Deny</button>
                </form>
              </div>
            </div>
          </div>
          ${footerHtml(env)}`);
      }

      // ---- Consent page (POST) ----
      if (url.pathname === "/consent" && request.method === "POST") {
        const body = await parseFormBody(request);
        const tx = await getTransaction(body.get("tx"), env);
        if (!tx || !tx.userId) throw new OidcError("invalid_request", "Unknown or expired auth transaction");
        if (body.get("decision") === "deny") {
          const redirect = new URL(tx.redirectUri);
          redirect.searchParams.set("error", "access_denied");
          redirect.searchParams.set("state", tx.state);
          return Response.redirect(redirect.toString(), 302);
        }
        if (convex(env)) {
          await cvxM(env, "consents:grantConsent", { userId: tx.userId, clientId: tx.clientId, piiGranted: tx.requestPii, grantedAt: Date.now(), lastUsedAt: Date.now() });
        } else {
          db.consents.set(getConsentKey(tx.userId, tx.clientId), { userId: tx.userId, clientId: tx.clientId, origin: new URL(tx.redirectUri).origin, piiGranted: tx.requestPii, grantedAt: Date.now(), lastUsedAt: Date.now() });
        }
        const codeRecord = buildAuthorizationCodeRecord({ transactionId: tx.transactionId, clientId: tx.clientId, redirectUri: tx.redirectUri, userId: tx.userId });
        if (convex(env)) {
          await cvxM(env, "codes:createAuthorizationCode", codeRecord);
        } else {
          db.codes.set(codeRecord.code, codeRecord);
        }
        const redirect = new URL(tx.redirectUri);
        redirect.searchParams.set("code", codeRecord.code);
        redirect.searchParams.set("state", tx.state);
        return Response.redirect(redirect.toString(), 302);
      }

      // ---- Token exchange ----
      if (url.pathname === "/token" && request.method === "POST") {
        const body = await parseFormBody(request);
        const code = body.get("code") ?? "";
        const codeRecord = convex(env)
          ? await cvxM<CodeRecord | null>(env, "codes:redeemAuthorizationCode", { code })
          : db.codes.get(code) ?? null;
        if (!codeRecord) throw new OidcError("invalid_grant", "Authorization code not found");
        const validated = validateTokenRequest({
          grant_type: (body.get("grant_type") ?? "") as TokenRequest["grant_type"],
          client_id: body.get("client_id") ?? "",
          redirect_uri: body.get("redirect_uri") ?? "",
          code,
          code_verifier: body.get("code_verifier") ?? "",
          env: env.ENVIRONMENT,
          expectedClientId: codeRecord.clientId,
          expectedRedirectUri: codeRecord.redirectUri
        });
        if (!isCodeRedeemable(codeRecord)) throw new OidcError("invalid_grant", "Authorization code expired or already redeemed");
        const tx = await getTransaction(codeRecord.transactionId, env);
        const user = await getUserById(codeRecord.userId, env);
        if (!tx || !user) throw new OidcError("invalid_grant", "Authorization code no longer valid");
        const pkceValid = await verifyPkce({ verifier: validated.codeVerifier, challenge: tx.codeChallenge, method: tx.codeChallengeMethod });
        if (!pkceValid) throw new OidcError("invalid_grant", "PKCE verification failed");
        if (!convex(env)) {
          codeRecord.redeemedAt = Date.now();
        }
        const consent = await getConsent(user.userId, tx.clientId, env);
        const pairwise = await getPairwise(user, tx.clientId, env);
        const signingKey = await signingKeyPromise;
        const issued = await issueIdToken({
          issuer: env.ISSUER,
          audience: tx.clientId,
          pairwiseSub: pairwise.pairwiseSub,
          user: user.profile,
          privateKey: signingKey.privateKey,
          kid: signingKey.kid,
          nonce: tx.nonce,
          includePii: shouldIncludePiiClaims({ requestPii: tx.requestPii, piiGranted: consent?.piiGranted })
        });
        const response: TokenResponse = { id_token: issued.token, pairwise_sub: pairwise.pairwiseSub, token_type: "Bearer", expires_in: 300 };
        return json(response, { headers: corsHeaders(request, env) });
      }

      // ---- Session check ----
      if (url.pathname === "/session/check" && request.method === "POST") {
        const token = parseBearer(request);
        const claims = parseClaims(token);
        let hasActiveSession = false;
        let hasActiveConsent = false;

        if (claims?.sub) {
          // Look up pairwise record to find userId and clientId
          if (convex(env)) {
            // For Convex mode, we use the session cookie + token claims
            const session = await getSessionFromRequest(request, env);
            hasActiveSession = Boolean(session);
            if (session && claims.aud) {
              const consent = await getConsent(session.userId, claims.aud as string, env);
              hasActiveConsent = Boolean(consent);
            }
          } else {
            const pairwise = db.pairwiseBySub.get(claims.sub) ?? null;
            const consent = pairwise ? await getConsent(pairwise.userId, pairwise.clientId, env) : null;
            const session = await getSessionFromRequest(request, env);
            hasActiveSession = Boolean(session);
            hasActiveConsent = Boolean(consent);
          }
        }

        const result = buildSessionCheckResponse({
          hasValidToken: Boolean(claims?.sub && claims?.aud && claims?.exp && claims.exp * 1000 > Date.now()),
          hasActiveSession,
          hasActiveConsent
        });
        return json(result, { status: result.status === "active" ? 200 : 401, headers: corsHeaders(request, env) });
      }

      // ---- Logout ----
      if (url.pathname === "/logout" && request.method === "POST") {
        const session = await getSessionFromRequest(request, env);
        if (session) {
          if (convex(env)) {
            await cvxM(env, "sessions:revokeBrokerSession", { sessionId: session.sessionId });
          } else {
            session.revokedAt = Date.now();
          }
        }
        const response: LogoutResponse = { status: "ok" };
        return json(response, { headers: { "set-cookie": clearSessionCookie(env), ...corsHeaders(request, env) } });
      }

      // ---- Profile page ----
      if (url.pathname === "/me") {
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        if (!session || !user) {
          return html("No Session", `<div class="card"><h1>Not signed in</h1><p>Sign in to view your profile.</p><a class="btn" href="/sign-in">Sign In</a></div>${footerHtml(env)}`, { status: 401 });
        }
        const name = escapeHtml(user.profile.name ?? "User");
        const email = escapeHtml(user.profile.email ?? user.profile.googleSub);
        const pic = user.profile.picture ? `<img src="${escapeHtml(user.profile.picture)}" alt="" width="56" height="56"/>` : "";
        return html("Profile", `
          <div class="card">
            <div class="profile-header">${pic}<div><h1>${name}</h1><p>${email}</p></div></div>
            <h2>Session</h2>
            <p>Expires: <code>${new Date(session.expiresAt).toLocaleString()}</code></p>
            <h2>Actions</h2>
            <div class="nav">
              <a class="btn secondary" href="/authorized-sites">Manage Authorized Sites</a>
              <form method="post" action="/logout" style="display:inline"><button class="btn danger" type="submit">Sign Out</button></form>
            </div>
          </div>
          ${footerHtml(env)}`);
      }

      // ---- Authorized sites (GET) ----
      if (url.pathname === "/authorized-sites" && request.method === "GET") {
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        if (!session || !user) {
          return html("No Session", `<div class="card"><h1>Not signed in</h1><p>Sign in to manage authorized sites.</p><a class="btn" href="/sign-in">Sign In</a></div>${footerHtml(env)}`, { status: 401 });
        }
        const sites = await listAuthorizedSites(user.userId, env);
        const siteList = sites.length
          ? `<ul class="site-list">${sites
              .map(
                (site) => `<li>
                  <div class="site-info">
                    <span class="site-origin">${escapeHtml(site.origin)}</span>
                    <span class="site-meta">PII: ${site.piiGranted ? "granted" : "not granted"}${site.grantedAt ? ` · Authorized ${new Date(site.grantedAt).toLocaleDateString()}` : ""}</span>
                  </div>
                  <form method="post" action="/authorized-sites/revoke">
                    <input type="hidden" name="client_id" value="${escapeHtml(site.clientId)}"/>
                    <button class="btn danger" type="submit" style="font-size:0.85em;padding:6px 14px">Revoke</button>
                  </form>
                </li>`
              )
              .join("")}</ul>`
          : `<div class="empty"><p>No authorized sites yet.</p><p>When you sign in to an app using AVS AUTH, it will appear here.</p></div>`;
        return html("Authorized Sites", `
          <div class="card">
            <h1>Authorized Sites</h1>
            <p>These applications have been granted access through your AVS AUTH account.</p>
            ${siteList}
          </div>
          ${footerHtml(env)}`);
      }

      // ---- Revoke authorized site ----
      if (url.pathname === "/authorized-sites/revoke" && request.method === "POST") {
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        const body = await parseFormBody(request);
        if (!session || !user) {
          return html("No Session", `<div class="card"><h1>Not signed in</h1><p>Sign in to manage authorized sites.</p><a class="btn" href="/sign-in">Sign In</a></div>${footerHtml(env)}`, { status: 401 });
        }
        const clientId = body.get("client_id") ?? "";
        if (clientId) {
          if (convex(env)) {
            await cvxM(env, "consents:revokeConsent", { userId: user.userId, clientId });
          } else {
            const consent = db.consents.get(getConsentKey(user.userId, clientId));
            if (consent) consent.revokedAt = Date.now();
          }
        }
        return Response.redirect(new URL("/authorized-sites", env.ISSUER).toString(), 302);
      }

      // ---- Privacy ----
      if (url.pathname === "/privacy") {
        return html("Privacy Policy", `
          <div class="card">
            <h1>Privacy Policy</h1>
            <p><strong>Last updated:</strong> March 2026</p>
            <h2>What we collect</h2>
            <p>AVS AUTH stores the minimum data needed to operate as an authentication broker:</p>
            <ul>
              <li><strong>Google account identifier</strong> (subject ID) to link your broker account.</li>
              <li><strong>Email, name, and profile picture</strong> from Google, displayed on your profile and shared with apps only when you explicitly grant consent.</li>
              <li><strong>Broker sessions</strong> including session ID, creation time, and expiry.</li>
              <li><strong>Consent records</strong> tracking which apps you have authorized and whether you granted PII access.</li>
              <li><strong>Short-lived authorization codes and transactions</strong> that expire within minutes.</li>
            </ul>
            <h2>What we share</h2>
            <p>Each app receives a <strong>pairwise subject identifier</strong> unique to that app. Apps cannot correlate your identity across different origins. Email, name, and picture are only shared when you grant explicit consent.</p>
            <h2>Data retention</h2>
            <p>Broker sessions expire after 14 days. Authorization codes expire after 5 minutes. You can revoke app access at any time from <a href="/authorized-sites">Authorized Sites</a>.</p>
            <h2>Your rights</h2>
            <p>You can view, manage, and revoke all authorized applications. To delete your account, revoke all sites and sign out.</p>
          </div>
          ${footerHtml(env)}`);
      }

      // ---- Terms ----
      if (url.pathname === "/terms") {
        return html("Terms of Service", `
          <div class="card">
            <h1>Terms of Service</h1>
            <p><strong>Last updated:</strong> March 2026</p>
            <h2>Service description</h2>
            <p>AVS AUTH is an authentication broker that issues pairwise OIDC identity tokens to relying-party applications on your behalf.</p>
            <h2>Your responsibilities</h2>
            <ul>
              <li>Keep your Google account secure. AVS AUTH relies on Google for primary authentication.</li>
              <li>Review and manage your authorized applications regularly.</li>
              <li>Use server-side JWT verification against the published JWKS endpoint before trusting relying-party sessions.</li>
            </ul>
            <h2>Limitations</h2>
            <p>AVS AUTH is provided as-is. We do not guarantee uptime or availability. Tokens are short-lived (5 minutes) and must be verified server-side.</p>
            <h2>Changes</h2>
            <p>These terms may be updated. Continued use constitutes acceptance of updated terms.</p>
          </div>
          ${footerHtml(env)}`);
      }

      // ---- No session ----
      if (url.pathname === "/no-session") {
        return html("No Session", `
          <div class="card">
            <h1>Session required</h1>
            <p>You need an active broker session to access this page.</p>
            <div class="nav">
              <a class="btn" href="/sign-in">Sign In</a>
              <a class="btn secondary" href="/">Home</a>
            </div>
          </div>
          ${footerHtml(env)}`, { status: 401 });
      }

      // ---- Error ----
      if (url.pathname === "/error") {
        return html("Error", `
          <div class="card">
            <h1>Something went wrong</h1>
            <p>An error occurred while processing your request. Please try again or contact support if the issue persists.</p>
            <p>Correlation ID: <code class="mono">${escapeHtml(reqId)}</code></p>
            <div class="nav">
              <a class="btn" href="/">Return Home</a>
            </div>
          </div>
          ${footerHtml(env)}`, { status: 400 });
      }

      // ---- Hosted script ----
      if (url.pathname === "/avs-auth.js") {
        return new Response(scriptSource(), {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=300",
            "x-content-type-options": "nosniff"
          }
        });
      }

      // ---- 404 ----
      return html("Not Found", `
        <div class="card">
          <h1>Page not found</h1>
          <p>The page you are looking for does not exist.</p>
          <a class="btn" href="/">Return Home</a>
        </div>
        ${footerHtml(env)}`, { status: 404 });

    } catch (error) {
      if (error instanceof OidcError) {
        return json(
          { error: error.code, error_description: error.message, correlation_id: reqId },
          { status: error.status, headers: corsHeaders(request, env) }
        );
      }
      return html("Error", `
        <div class="card">
          <h1>Unexpected error</h1>
          <p>An internal error occurred. Please try again.</p>
          <p>Correlation ID: <code class="mono">${escapeHtml(reqId)}</code></p>
          <a class="btn" href="/">Return Home</a>
        </div>
        ${footerHtml(env)}`, { status: 500 });
    }
  }
};
