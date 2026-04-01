import {
  buildAuthorizationCodeRecord,
  buildAuthorizeRequestRecord,
  buildSessionCheckResponse,
  createOpenIdConfiguration,
  derivePairwiseSub,
  exportPrivateKeyToJwk,
  generateSigningKeySet,
  importPrivateKeyFromJwk,
  isCodeRedeemable,
  issueIdToken,
  OidcError,
  parseJwks,
  shouldIncludePiiClaims,
  validateAuthorizeRequest,
  validateTokenRequest,
  verifyIdToken,
  verifyPkce
} from "@avs-auth/oidc-core";
import { callConvexMutation, callConvexQuery, hasConvexConfig } from "./convex";
import { AVS_AUTH_SCRIPT_SOURCE } from "./avs-auth-script";
import type {
  AuthorizedSite,
  BrokerSessionSummary,
  BrokerUserProfile,
  Jwk,
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
  ADMIN_SECRET?: string;
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

function brokerClientId(env: Env): string {
  return `origin:${new URL(env.ISSUER).origin}`;
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

// ---------------------------------------------------------------------------
// Convex-mode signing key (fetches from Convex instead of in-memory)
// ---------------------------------------------------------------------------
async function getConvexSigningKey(env: Env): Promise<{ privateKey: CryptoKey; kid: string }> {
  const activeKey = await cvxQ<{ kid: string; encryptedPrivateJwk: string } | null>(
    env, "signingKeys:getActiveSigningKey", {}
  );
  if (!activeKey) {
    throw new OidcError("server_error", "No active signing key in Convex", 500);
  }
  const privateKey = await importPrivateKeyFromJwk(activeKey.encryptedPrivateJwk);
  return { privateKey, kid: activeKey.kid };
}

// ---------------------------------------------------------------------------
// Client registration + blocked check (Convex mode only)
// ---------------------------------------------------------------------------
async function registerAndCheckClient(clientId: string, env: Env, reqId: string): Promise<void> {
  if (!convex(env)) return;
  const now = Date.now();
  const origin = clientId.replace(/^origin:/, "");
  const client = await cvxM<{ status: string }>(env, "clients:upsertClient", {
    clientId,
    origin,
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active"
  });
  if (client && client.status === "blocked") {
    void audit(env, {
      actorType: "system",
      action: "client_blocked_attempt",
      targetType: "client",
      targetId: clientId,
      clientId,
      correlationId: reqId
    });
    throw new OidcError("access_denied", "This client has been blocked by the operator");
  }
}

// ---------------------------------------------------------------------------
// Audit event helper (Convex mode only, fire-and-forget safe)
// ---------------------------------------------------------------------------
async function audit(env: Env, params: {
  actorType: "user" | "operator" | "system";
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  clientId?: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!convex(env)) return;
  try {
    await cvxM(env, "auditEvents:recordAuditEvent", {
      eventId: `evt_${crypto.randomUUID()}`,
      ...params,
      createdAt: Date.now()
    });
  } catch {
    // Audit failures should not break the request
  }
}

const CSS = `
:root{--bg:#090909;--panel:#101010;--panel-soft:rgba(255,255,255,.03);--border:rgba(255,255,255,.1);--text:#f2f2ed;--muted:#a4a4a0;--accent:#ecff00;--danger:#ff7272}
*{box-sizing:border-box}
html{background:#090909}
body{margin:0;color:var(--text);line-height:1.6;font-family:"IBM Plex Mono","SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;background-color:var(--bg);background-image:linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);background-size:72px 72px}
main{max-width:1360px;margin:0 auto;padding:42px 28px 84px}
.card{padding:32px;border:1px solid var(--border);background:rgba(12,12,12,.92);box-shadow:0 0 0 1px rgba(255,255,255,.015) inset}
h1,h2,h3,p{margin:0}
h1{font-family:"Arial Black","Helvetica Neue",sans-serif;font-size:1.65rem;line-height:.95;letter-spacing:-.04em}
h2{font-family:"Arial Black","Helvetica Neue",sans-serif;font-size:1.3rem;letter-spacing:-.03em}
h3{font-family:"Arial Black","Helvetica Neue",sans-serif;font-size:1rem;letter-spacing:-.02em}
p{margin-top:10px;color:var(--muted)}
a{color:var(--text)}
code{background:rgba(255,255,255,.05);padding:2px 7px;border-radius:4px;font-size:.92em}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;border:1px solid var(--border);background:transparent;color:var(--text);text-decoration:none;cursor:pointer;font:inherit;font-size:.95rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;transition:border-color .15s ease,color .15s ease,background .15s ease;margin:4px 10px 4px 0}
.btn:hover{border-color:rgba(255,255,255,.24)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#080808}
.btn.secondary{background:transparent;color:var(--text)}
.btn.danger{background:transparent;color:var(--danger);border-color:rgba(255,114,114,.4)}
.btn.danger:hover{border-color:rgba(255,114,114,.7)}
.hero-shell{padding-top:8px}
.brand-mark{display:inline-flex;align-items:center;font-family:"Arial Black","Helvetica Neue",sans-serif;font-size:1.6rem;font-weight:900;letter-spacing:-.04em;color:var(--text);text-decoration:none;margin-bottom:46px}
.hero-kicker{display:inline-block;color:var(--muted);text-transform:uppercase;letter-spacing:.16em;font-size:.78rem;margin-bottom:16px}
.hero-title{font-family:"Arial Black","Helvetica Neue",sans-serif;font-size:clamp(3.8rem,8vw,6.8rem);line-height:.86;letter-spacing:-.07em;max-width:760px}
.hero-title .accent{color:var(--accent)}
.hero-copy{max-width:660px;font-size:1.05rem;color:var(--muted);margin-top:28px}
.nav{display:flex;gap:12px;margin-top:26px;margin-bottom:0;flex-wrap:wrap}
.grid{display:grid;gap:20px}
.dashboard-grid{grid-template-columns:minmax(0,1.35fr) minmax(320px,.9fr);align-items:start}
.panel{border:1px solid var(--border);background:rgba(15,15,15,.88);padding:24px}
.profile-panel{display:grid;grid-template-columns:96px minmax(0,1fr);gap:22px;align-items:start}
.profile-avatar{width:96px;height:96px;border:1px solid rgba(255,255,255,.12);object-fit:cover;background:linear-gradient(180deg, rgba(236,255,0,.14), rgba(255,255,255,.02))}
.profile-fallback{display:flex;align-items:center;justify-content:center;font-family:"Arial Black","Helvetica Neue",sans-serif;font-size:2rem;color:var(--accent)}
.kv-grid{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 14px}
.kv-grid dt{color:#7e7e7a;text-transform:uppercase;letter-spacing:.1em;font-size:.78rem}
.kv-grid dd{margin:0;color:var(--text);word-break:break-word}
.session-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:22px}
.meta-box{border:1px solid var(--border);background:var(--panel-soft);padding:16px}
.meta-label{display:block;color:#7e7e7a;text-transform:uppercase;letter-spacing:.12em;font-size:.74rem;margin-bottom:6px}
.meta-value{font-size:.98rem;color:var(--text)}
.site-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px}
.site-list li,.site-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;border:1px solid var(--border);background:rgba(255,255,255,.02)}
.site-info{display:flex;flex-direction:column;gap:4px}
.site-origin{font-weight:700;color:var(--text)}
.site-meta{font-size:.85rem;color:var(--muted)}
.session-shell{display:flex;flex-direction:column;gap:24px}
.session-copy{max-width:720px;font-size:1.02rem}
.actions{display:flex;gap:12px;justify-content:flex-start;flex-wrap:wrap}
.consent-box{text-align:left;padding:8px 0}
.consent-origin{font-size:1.15rem;font-weight:700;margin-top:14px;color:var(--text)}
.consent-detail{margin:12px 0 24px;color:var(--muted)}
.empty{padding:20px;border:1px dashed rgba(255,255,255,.14);color:var(--muted);background:rgba(255,255,255,.02)}
.muted{color:var(--muted)}
.stack{display:flex;flex-direction:column;gap:18px}
.mono{font-family:"IBM Plex Mono","SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace}
footer{margin-top:56px;padding-top:26px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;color:#7e7e7a;font-size:.92rem}
.footer-links{display:flex;gap:20px;flex-wrap:wrap}
footer a{color:#9f9f98;text-decoration:none}
footer a:hover{color:var(--text)}
.alert{padding:14px 16px;border:1px solid var(--border);margin-bottom:16px}
.alert.info{background:rgba(96,165,250,.08);color:#bfdbfe}
.alert.warning{background:rgba(250,204,21,.08);color:#fde68a}
form{margin:0}
@media (max-width: 960px){.dashboard-grid{grid-template-columns:1fr}.hero-title{max-width:560px}.session-meta{grid-template-columns:1fr}}
@media (max-width: 720px){main{padding:28px 18px 54px}.card,.panel{padding:22px}.profile-panel{grid-template-columns:1fr}.profile-avatar,.profile-fallback{width:88px;height:88px}.kv-grid{grid-template-columns:1fr}.site-list li,.site-row{flex-direction:column;align-items:flex-start}.btn{width:100%}footer{flex-direction:column}}
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

/** SHA-256 first-8-hex of `input` — used as an opaque rate-limit key suffix. */
async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf).slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
  return `<footer><span>Free & OSS</span><div class="footer-links"><a href="/">Home</a><a href="${docsUrl}">Docs</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></footer>`;
}

function normalizeReturnTo(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, "https://auth.adityavs.tech");
    if (parsed.origin !== "https://auth.adityavs.tech") return null;
    const route = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!route.startsWith("/") || route.startsWith("//")) return null;
    return route;
  } catch {
    return null;
  }
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

async function deleteUserAccount(userId: string, env: Env): Promise<void> {
  if (convex(env)) {
    await cvxM(env, "users:deleteUserAccount", { userId });
    return;
  }

  db.users.delete(userId);

  for (const [sessionId, session] of db.sessions.entries()) {
    if (session.userId === userId) {
      db.sessions.delete(sessionId);
    }
  }

  for (const [consentKey, consent] of db.consents.entries()) {
    if (consent.userId === userId) {
      db.consents.delete(consentKey);
    }
  }

  for (const [pairwiseKey, pairwise] of db.pairwiseByUserClient.entries()) {
    if (pairwise.userId === userId) {
      db.pairwiseByUserClient.delete(pairwiseKey);
      db.pairwiseBySub.delete(pairwise.pairwiseSub);
    }
  }

  for (const [transactionId, transaction] of db.transactions.entries()) {
    if (transaction.userId === userId) {
      db.transactions.delete(transactionId);
    }
  }

  for (const [code, codeRecord] of db.codes.entries()) {
    if (codeRecord.userId === userId) {
      db.codes.delete(code);
    }
  }
}

function renderAvatar(profile: BrokerUserProfile): string {
  if (profile.picture) {
    return `<img class="profile-avatar" src="${escapeHtml(profile.picture)}" alt="" />`;
  }
  const fallback = escapeHtml((profile.name ?? profile.email ?? "A").trim().charAt(0).toUpperCase() || "A");
  return `<div class="profile-avatar profile-fallback">${fallback}</div>`;
}

function renderAuthorizedSitesList(sites: AuthorizedSite[], revoke = false, returnTo = "/authorized-sites"): string {
  if (sites.length === 0) {
    return `<div class="empty"><p>No authorized sites yet.</p><p>When you sign in to an app using AVS AUTH, it will appear here.</p></div>`;
  }

  return `<ul class="site-list">${sites.map((site) => {
    const revokeAction = revoke
      ? `<form method="post" action="/authorized-sites/revoke">
            <input type="hidden" name="client_id" value="${escapeHtml(site.clientId)}"/>
            <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"/>
            <button class="btn danger" type="submit" style="min-height:44px;padding:0 18px">Revoke</button>
          </form>`
      : "";

    return `<li>
      <div class="site-info">
        <span class="site-origin">${escapeHtml(site.origin)}</span>
        <span class="site-meta">PII: ${site.piiGranted ? "granted" : "not granted"}${site.grantedAt ? ` · Authorized ${new Date(site.grantedAt).toLocaleDateString()}` : ""}${site.lastUsedAt ? ` · Last used ${new Date(site.lastUsedAt).toLocaleDateString()}` : ""}</span>
      </div>
      ${revokeAction}
    </li>`;
  }).join("")}</ul>`;
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
  // Always pre-compute HMAC-derived pairwise sub (consistent across in-memory and Convex)
  const pairwiseSub = await derivePairwiseSub({
    pairwiseSecret: env.PAIRWISE_SECRET ?? "dev_pairwise_secret",
    googleSub: user.profile.googleSub,
    clientId
  });
  if (convex(env)) {
    return await cvxM<PairwiseRecord>(env, "pairwiseSubjects:getOrCreatePairwiseSubject", {
      userId: user.userId, clientId, pairwiseSub
    });
  }
  const key = `${user.userId}|${clientId}`;
  const existing = db.pairwiseByUserClient.get(key);
  if (existing) return existing;
  const record = { userId: user.userId, clientId, pairwiseSub };
  db.pairwiseByUserClient.set(key, record);
  db.pairwiseBySub.set(pairwiseSub, record);
  return record;
}

function isBrokerSignInTransaction(tx: TransactionRecord, env: Env): boolean {
  return tx.clientId === brokerClientId(env);
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
  return AVS_AUTH_SCRIPT_SOURCE;
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
          const pic = renderAvatar(user.profile);
          return html("Home", `
            <div class="card hero-shell stack">
              <a class="brand-mark" href="/">avs</a>
              <div>
                <span class="hero-kicker">Broker Session</span>
                <h1 class="hero-title">WELCOME <span class="accent">BACK.</span></h1>
                <p class="hero-copy">You are already signed in to AVS AUTH. Open your session dashboard to manage your profile, inspect authorized sites, and use your broker session for fast auth across every connected app.</p>
              </div>
              <div class="panel profile-panel">
                ${pic}
                <div class="stack">
                  <div>
                    <h2>${name}</h2>
                    <p>${email}</p>
                  </div>
                  <div class="nav">
                    <a class="btn primary" href="/me">Open Session Dashboard</a>
                    <a class="btn secondary" href="/authorized-sites">Authorized Sites</a>
                  </div>
                </div>
              </div>
            </div>
            ${footerHtml(env)}`);
        }
        return html("Home", `
          <div class="card hero-shell stack">
            <a class="brand-mark" href="/">avs</a>
            <div>
              <span class="hero-kicker">AVS AUTH</span>
              <h1 class="hero-title">SIGN IN <span class="accent">ONCE.</span></h1>
              <p class="hero-copy">Create one broker session on AVS AUTH, then reuse it for fast authorization handshakes across every website that integrates with your broker. No dashboard registration required for client apps.</p>
            </div>
            <div class="nav">
              <a class="btn primary" href="/sign-in">Sign In With Google</a>
              <a class="btn secondary" href="${escapeHtml(env.DOCS_BASE_URL ?? "https://docs.auth.adityavs.tech")}">Read Docs</a>
            </div>
            <div class="panel stack">
              <p class="muted">Add authentication in two lines:</p>
              <p><code>&lt;script src="${escapeHtml(env.ISSUER)}/avs-auth.js"&gt;&lt;/script&gt;</code></p>
              <p><code>&lt;a href="${escapeHtml(env.ISSUER)}/authorize?redirect_uri=https%3A%2F%2Fyour-app.com%2Favs-auth%2Fcallback"&gt;Sign In&lt;/a&gt;</code></p>
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
        if (convex(env)) {
          // Include both active AND retired keys so tokens signed by a
          // just-retired key can still be verified during the TTL overlap window.
          const allKeys = await cvxQ<Array<{ kid: string; publicJwk: Jwk; status: string }>>(env, "signingKeys:listPublicSigningKeys", {});
          return json({ keys: (allKeys ?? []).map((k) => k.publicJwk) });
        }
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
        // Register client + check blocked (Convex mode only)
        await registerAndCheckClient(validated.clientId, env, reqId);
        // Rate limiting (Convex mode only)
        if (convex(env)) {
          const rl = await cvxM<{ allowed: boolean; retryAfter: number }>(
            env, "originMetrics:recordAndCheckRateLimit",
            { clientId: validated.clientId, endpoint: "authorize" }
          );
          if (!rl.allowed) {
            return new Response(
              JSON.stringify({ error: "rate_limited", error_description: "Too many requests. Please try again later." }),
              {
                status: 429,
                headers: {
                  "content-type": "application/json",
                  "retry-after": String(rl.retryAfter),
                  "cache-control": "no-store"
                }
              }
            );
          }
        }
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
          <div class="card hero-shell stack">
            <a class="brand-mark" href="/">avs</a>
            <div>
              <span class="hero-kicker">Central Broker Sign-In</span>
              <h1 class="hero-title">YOUR <span class="accent">SESSION.</span></h1>
              ${tx ? `<p class="hero-copy">The application at <code>${originDisplay}</code> is requesting authentication. Sign in once with AVS AUTH and the broker can complete fast handshakes for this and any other connected app.</p>` : `<p class="hero-copy">Sign in to AVS AUTH once. After that, every website connected to your broker can reuse this central session for near-instant authentication.</p>`}
            </div>
            <div class="nav">
              <a class="btn primary" href="/auth/google${tx ? `?tx=${encodeURIComponent(tx.transactionId)}` : ""}">
                Continue with Google
              </a>
              <a class="btn secondary" href="/">Cancel</a>
            </div>
          </div>
          ${footerHtml(env)}`);
      }

      if (url.pathname === "/auth/google" && request.method === "GET") {
        return Response.redirect(new URL(`/auth/google/start${url.search}`, env.ISSUER).toString(), 302);
      }

      // ---- Google OAuth start ----
      if (url.pathname === "/auth/google/start" && request.method === "GET") {
        let tx = await getTransaction(url.searchParams.get("tx"), env);
        if (!tx) {
          tx = {
            ...buildAuthorizeRequestRecord({
              clientId: brokerClientId(env),
              redirectUri: new URL("/me", env.ISSUER).toString(),
              state: `broker-sign-in-${crypto.randomUUID()}`,
              codeChallenge: `broker-sign-in-${crypto.randomUUID()}`,
              codeChallengeMethod: "S256",
              requestPii: false
            })
          };
          if (convex(env)) {
            await cvxM(env, "transactions:createAuthTransaction", tx);
          } else {
            db.transactions.set(tx.transactionId, tx);
          }
        }
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
        if (isBrokerSignInTransaction(tx, env)) {
          headers.set("location", new URL("/me", env.ISSUER).toString());
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
        if (!tx) {
          return html(
            "Error",
            `<div class="card"><h1>Something went wrong</h1><p>Consent request is missing its ticket.</p><a class="btn" href="/">Return Home</a></div>${footerHtml(env)}`,
            { status: 400 }
          );
        }
        const user = tx?.userId ? await getUserById(tx.userId, env) : null;
        if (!user) {
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
          void audit(env, {
            actorType: "user",
            actorId: tx.userId,
            action: "consent_denied",
            targetType: "consent",
            clientId: tx.clientId,
            correlationId: reqId
          });
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
        void audit(env, {
          actorType: "user",
          actorId: tx.userId,
          action: "consent_granted",
          targetType: "consent",
          clientId: tx.clientId,
          correlationId: reqId,
          metadata: { piiGranted: tx.requestPii }
        });
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
        // Register client + check blocked (Convex mode only)
        await registerAndCheckClient(codeRecord.clientId, env, reqId);
        // Rate limiting (Convex mode only)
        if (convex(env)) {
          const rl = await cvxM<{ allowed: boolean; retryAfter: number }>(
            env, "originMetrics:recordAndCheckRateLimit",
            { clientId: codeRecord.clientId, endpoint: "token" }
          );
          if (!rl.allowed) {
            return new Response(
              JSON.stringify({ error: "rate_limited", error_description: "Too many requests. Please try again later." }),
              {
                status: 429,
                headers: {
                  "content-type": "application/json",
                  "retry-after": String(rl.retryAfter),
                  "cache-control": "no-store",
                  ...corsHeaders(request, env)
                }
              }
            );
          }
        }
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
        const signingKey = convex(env) ? await getConvexSigningKey(env) : await signingKeyPromise;
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
        void audit(env, {
          actorType: "system",
          action: "token_issued",
          targetType: "token",
          targetId: pairwise.pairwiseSub,
          clientId: tx.clientId,
          correlationId: reqId,
          metadata: { userId: user.userId }
        });
        return json(response, { headers: corsHeaders(request, env) });
      }

      // ---- Session check ----
      if (url.pathname === "/session/check" && request.method === "POST") {
        const token = parseBearer(request);
        if (!token) {
          const result = buildSessionCheckResponse({ hasValidToken: false, hasActiveSession: false, hasActiveConsent: false });
          return json(result, { status: 401, headers: corsHeaders(request, env) });
        }

        // Extract clientId from token claims for rate limiting (decode only, before verify).
        // SECURITY NOTE: `aud` comes from the unverified JWT payload, so a caller
        // could craft a token with a victim's aud to burn their rate-limit quota
        // (nuisance / light DoS against another origin). This does NOT let the
        // caller bypass rate limits on a *valid* token — the verified aud is checked
        // later.  We mitigate cross-origin counter skew by also keying on an IP hash
        // when the CF-Connecting-IP header is available (Cloudflare Workers).
        const rawClaims = parseClaims(token);

        // Rate limiting (Convex mode only) — Gap 6
        if (convex(env) && rawClaims?.aud) {
          // Composite key: "aud|ip-hash" to prevent a spoofed aud from burning
          // another origin's budget without also burning the attacker's IP budget.
          const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
          const ipSuffix = ip ? `|${await shortHash(ip)}` : "";
          const rateLimitKey = `${rawClaims.aud as string}${ipSuffix}`;
          const rl = await cvxM<{ allowed: boolean; retryAfter: number }>(
            env, "originMetrics:recordAndCheckRateLimit",
            { clientId: rateLimitKey, endpoint: "session_check" }
          );
          if (!rl.allowed) {
            return new Response(
              JSON.stringify({ error: "rate_limited", error_description: "Too many requests." }),
              {
                status: 429,
                headers: {
                  "content-type": "application/json",
                  "retry-after": String(rl.retryAfter),
                  "cache-control": "no-store",
                  ...corsHeaders(request, env)
                }
              }
            );
          }
        }

        // Verify JWT signature against JWKS and check iss — Gap 4 (session check hardening)
        // In Convex mode, fetch public keys from Convex (matches JWKS endpoint).
        // In non-Convex mode, use the in-memory signing key (always the actual signer).
        // Include both active AND retired public keys so tokens signed by a
        // just-retired key remain verifiable during the TTL overlap window.
        // This matches the JWKS endpoint behavior (/.well-known/jwks.json).
        let publicKeys: Jwk[];
        if (convex(env)) {
          const allKeys = await cvxQ<Array<{ kid: string; publicJwk: Jwk; status: string }>>(
            env, "signingKeys:listPublicSigningKeys", {}
          );
          publicKeys = (allKeys ?? []).map((k) => k.publicJwk);
        } else {
          publicKeys = [(await signingKeyPromise).publicJwk];
        }

        const verification = await verifyIdToken({ token, publicKeys, issuer: env.ISSUER });
        if (!verification.valid) {
          const result = buildSessionCheckResponse({ hasValidToken: false, hasActiveSession: false, hasActiveConsent: false });
          return json(result, { status: 401, headers: corsHeaders(request, env) });
        }

        const claims = verification.claims;
        let hasActiveSession = false;
        let hasActiveConsent = false;

        const session = await getSessionFromRequest(request, env);
        hasActiveSession = Boolean(session);

        if (session && claims.aud) {
          if (convex(env)) {
            // Sub-to-session binding: verify pairwise sub matches session user
            const pairwise = await cvxQ<PairwiseRecord | null>(
              env, "pairwiseSubjects:getPairwiseByUserAndClient",
              { userId: session.userId, clientId: claims.aud }
            );
            if (pairwise && pairwise.pairwiseSub === claims.sub) {
              const consent = await getConsent(session.userId, claims.aud, env);
              hasActiveConsent = Boolean(consent);
            } else {
              // Sub does not match session user — treat as no active session
              hasActiveSession = false;
            }
          } else {
            const pairwise = db.pairwiseBySub.get(claims.sub) ?? null;
            if (pairwise && pairwise.userId === session.userId) {
              const consent = await getConsent(pairwise.userId, pairwise.clientId, env);
              hasActiveConsent = Boolean(consent);
            } else {
              hasActiveSession = false;
            }
          }
        }

        const result = buildSessionCheckResponse({
          hasValidToken: true, // Already verified by verifyIdToken
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
          void audit(env, {
            actorType: "user",
            actorId: session.userId,
            action: "session_revoked",
            targetType: "session",
            targetId: session.sessionId,
            correlationId: reqId
          });
        }
        const headers = new Headers(corsHeaders(request, env));
        headers.set("set-cookie", clearSessionCookie(env));
        headers.set("location", new URL("/", env.ISSUER).toString());
        return new Response(null, { status: 302, headers });
      }

      // ---- Profile page ----
      if (url.pathname === "/me") {
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        if (!session || !user) {
          return html("No Session", `<div class="card"><h1>Not signed in</h1><p>Sign in to view your profile.</p><a class="btn" href="/sign-in">Sign In</a></div>${footerHtml(env)}`);
        }
        const sites = await listAuthorizedSites(user.userId, env);
        const name = escapeHtml(user.profile.name ?? "User");
        const email = escapeHtml(user.profile.email ?? user.profile.googleSub);
        const statusLabel = user.profile.emailVerified ? "Verified" : "Active";
        return html("Profile", `
          <div class="card session-shell">
            <a class="brand-mark" href="/">avs</a>
            <div>
              <span class="hero-kicker">Broker Session Dashboard</span>
              <h1 class="hero-title">YOUR <span class="accent">SESSION.</span></h1>
              <p class="session-copy">You are signed in to AVS AUTH. Connected apps can reuse this broker session for fast sign-in handshakes without sending you back through a full Google auth prompt every time.</p>
            </div>

            <div class="grid dashboard-grid">
              <section class="panel stack">
                <div class="profile-panel">
                  ${renderAvatar(user.profile)}
                  <div class="stack">
                    <dl class="kv-grid">
                      <dt>Name</dt>
                      <dd>${name}</dd>
                      <dt>Email</dt>
                      <dd>${email}</dd>
                      <dt>Status</dt>
                      <dd>${statusLabel}</dd>
                      <dt>Google Sub</dt>
                      <dd><code class="mono">${escapeHtml(user.profile.googleSub)}</code></dd>
                    </dl>
                    <div class="session-meta">
                      <div class="meta-box">
                        <span class="meta-label">Session Expires</span>
                        <span class="meta-value">${escapeHtml(new Date(session.expiresAt).toLocaleString())}</span>
                      </div>
                      <div class="meta-box">
                        <span class="meta-label">Authorized Sites</span>
                        <span class="meta-value">${sites.length} connected app${sites.length === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <aside class="panel stack">
                <h2>Account Actions</h2>
                <p class="muted">Refresh your Google-backed profile, end this broker session, or permanently remove your AVS-side data.</p>
                <div class="actions">
                  <a class="btn secondary" href="/auth/google">Refresh Profile</a>
                  <form method="post" action="/logout"><button class="btn danger" type="submit">Sign Out</button></form>
                  <form method="post" action="/account/delete"><button class="btn danger" type="submit">Delete My Data</button></form>
                </div>
              </aside>
            </div>

            <section class="panel stack">
              <div class="stack">
                <h2>Authorized Sites</h2>
                <p class="muted">Applications you have authorized through AVS AUTH. Revoking a site forces that app to request authorization again.</p>
              </div>
              ${renderAuthorizedSitesList(sites, true, "/me")}
            </section>
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
        return html("Authorized Sites", `
          <div class="card session-shell">
            <a class="brand-mark" href="/">avs</a>
            <div class="stack">
              <span class="hero-kicker">Account Access</span>
              <h1>Authorized Sites</h1>
              <p>These applications have been granted access through your AVS AUTH account.</p>
            </div>
            ${renderAuthorizedSitesList(sites, true, "/authorized-sites")}
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
        const returnTo = normalizeReturnTo(body.get("return_to")) ?? "/authorized-sites";
        if (clientId) {
          if (convex(env)) {
            await cvxM(env, "consents:revokeConsent", { userId: user.userId, clientId });
          } else {
            const consent = db.consents.get(getConsentKey(user.userId, clientId));
            if (consent) consent.revokedAt = Date.now();
          }
          void audit(env, {
            actorType: "user",
            actorId: user.userId,
            action: "consent_revoked",
            targetType: "consent",
            clientId,
            correlationId: reqId
          });
        }
        return Response.redirect(new URL(returnTo, env.ISSUER).toString(), 302);
      }

      // ---- Delete account ----
      if (url.pathname === "/account/delete" && request.method === "POST") {
        const session = await getSessionFromRequest(request, env);
        const user = session ? await getUserById(session.userId, env) : null;
        if (!session || !user) {
          return html("No Session", `<div class="card"><h1>Not signed in</h1><p>Sign in to manage your account.</p><a class="btn" href="/sign-in">Sign In</a></div>${footerHtml(env)}`, { status: 401 });
        }

        void audit(env, {
          actorType: "user",
          actorId: user.userId,
          action: "account_deleted",
          targetType: "user",
          targetId: user.userId,
          correlationId: reqId
        });

        await deleteUserAccount(user.userId, env);

        const headers = new Headers();
        headers.set("set-cookie", clearSessionCookie(env));
        headers.set("location", new URL("/", env.ISSUER).toString());
        return new Response(null, { status: 302, headers });
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
            <p>You can view, manage, and revoke authorized applications. You can also delete your AVS AUTH account directly from your session dashboard.</p>
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

      // ---- Admin: requires ADMIN_SECRET ----
      if (url.pathname.startsWith("/admin/")) {
        const adminSecret = (env as any).ADMIN_SECRET as string | undefined;
        const authHeader = request.headers.get("authorization");
        const providedSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!adminSecret || providedSecret !== adminSecret) {
          return json({ error: "unauthorized", error_description: "Valid ADMIN_SECRET required" }, { status: 401 });
        }

        // POST /admin/rotate-keys
        if (url.pathname === "/admin/rotate-keys" && request.method === "POST") {
          if (!convex(env)) {
            return json({ error: "unavailable", error_description: "Convex not configured" }, { status: 503 });
          }
          const newKey = await generateSigningKeySet();
          const exportedPrivateJwk = await exportPrivateKeyToJwk(newKey.privateKey);
          const result = await cvxM(env, "signingKeys:rotateSigningKey", {
            kid: newKey.kid,
            publicJwk: newKey.publicJwk,
            encryptedPrivateJwk: exportedPrivateJwk,
            status: "active",
            createdAt: Date.now()
          });
          void audit(env, {
            actorType: "operator",
            action: "key_rotated",
            targetType: "signing_key",
            targetId: newKey.kid,
            correlationId: reqId
          });
          return json({ status: "rotated", kid: newKey.kid, result });
        }

        // POST /admin/block-client
        if (url.pathname === "/admin/block-client" && request.method === "POST") {
          if (!convex(env)) {
            return json({ error: "unavailable", error_description: "Convex not configured" }, { status: 503 });
          }
          const body = await parseFormBody(request);
          const clientId = body.get("clientId") ?? body.get("client_id") ?? "";
          if (!clientId) {
            return json({ error: "invalid_request", error_description: "clientId required" }, { status: 400 });
          }
          await cvxM(env, "operator:blockClient", { clientId, reason: body.get("reason") ?? "admin action" });
          void audit(env, {
            actorType: "operator",
            action: "client_blocked",
            targetType: "client",
            targetId: clientId,
            clientId,
            correlationId: reqId,
            metadata: { reason: body.get("reason") ?? "admin action" }
          });
          return json({ status: "blocked", clientId });
        }

        // POST /admin/unblock-client
        if (url.pathname === "/admin/unblock-client" && request.method === "POST") {
          if (!convex(env)) {
            return json({ error: "unavailable", error_description: "Convex not configured" }, { status: 503 });
          }
          const body = await parseFormBody(request);
          const clientId = body.get("clientId") ?? body.get("client_id") ?? "";
          if (!clientId) {
            return json({ error: "invalid_request", error_description: "clientId required" }, { status: 400 });
          }
          await cvxM(env, "operator:unblockClient", { clientId });
          void audit(env, {
            actorType: "operator",
            action: "client_unblocked",
            targetType: "client",
            targetId: clientId,
            clientId,
            correlationId: reqId
          });
          return json({ status: "unblocked", clientId });
        }

        // POST /admin/revoke-user-sessions
        if (url.pathname === "/admin/revoke-user-sessions" && request.method === "POST") {
          if (!convex(env)) {
            return json({ error: "unavailable", error_description: "Convex not configured" }, { status: 503 });
          }
          const body = await parseFormBody(request);
          const userId = body.get("userId") ?? body.get("user_id") ?? "";
          if (!userId) {
            return json({ error: "invalid_request", error_description: "userId required" }, { status: 400 });
          }
          await cvxM(env, "operator:revokeAllSessionsForUser", { userId });
          void audit(env, {
            actorType: "operator",
            action: "all_sessions_revoked",
            targetType: "user",
            targetId: userId,
            correlationId: reqId
          });
          return json({ status: "revoked", userId });
        }

        // GET /admin/audit
        if (url.pathname === "/admin/audit" && request.method === "GET") {
          if (!convex(env)) {
            return json({ error: "unavailable", error_description: "Convex not configured" }, { status: 503 });
          }
          const events = await cvxQ(env, "auditEvents:listAuditEvents", {});
          return json({ events });
        }

        return json({ error: "not_found", error_description: "Unknown admin route" }, { status: 404 });
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
