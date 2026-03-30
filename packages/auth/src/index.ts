import { deriveClientIdFromRedirectUri } from "@avs-auth/oidc-core";
import type {
  AvsAuthClientShape,
  AvsAuthOptions,
  AvsIdentity,
  CheckSessionOptions,
  ExchangeCodeParams,
  FinishSignInOptions,
  HandleCallbackOptions,
  IdentityClaims,
  PkceBundle,
  SessionCheckResponse,
  SessionCheckResult,
  SessionMonitorHandle,
  SessionMonitorOptions,
  StartSignInOptions,
  TokenResponse
} from "@avs-auth/types";

const encoder = new TextEncoder();
const PKCE_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_BASE_URL = "https://auth.adityavs.tech";
const DEFAULT_SESSION_MONITOR_INTERVAL_MS = 60_000;

export type AvsAuthClient = AvsAuthClientShape;

export const defaults: Required<AvsAuthOptions> = {
  avsBaseUrl: DEFAULT_BASE_URL,
  callbackPath: "/avs-auth/callback",
  redirectUri: "http://localhost/avs-auth/callback",
  clientId: "origin:http://localhost",
  requestPii: false,
  storageKey: "avs_auth_identity",
  pkceStorageKey: "avs_auth_pkce",
  returnToStorageKey: "avs_auth_return_to",
  fallbackPath: "/",
  autoSessionMonitor: true,
  sessionMonitorIntervalMs: DEFAULT_SESSION_MONITOR_INTERVAL_MS
};

export type HostedScriptOptions = Pick<
  AvsAuthOptions,
  | "avsBaseUrl"
  | "callbackPath"
  | "requestPii"
  | "storageKey"
  | "autoSessionMonitor"
  | "sessionMonitorIntervalMs"
> & {
  autoHandleCallback?: boolean;
  linkSelector?: string;
  buttonSelector?: string;
  debug?: boolean;
};

export type HostedRuntime = {
  client: AvsAuthClient;
  bindLinkUpgrade: (selectors?: { linkSelector?: string; buttonSelector?: string }) => void;
  autoHandleCallback: () => Promise<TokenResponse | null>;
  dispatchLoginRequired: (detail: Extract<SessionCheckResponse, { status: "login_required" }>) => void;
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function requireBrowser(api: string): void {
  if (!isBrowser()) {
    throw new Error(`${api} must be called in a browser environment`);
  }
}

function randomString(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const random = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const value of random) {
    out += chars[value % chars.length];
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseBooleanDataValue(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "";
}

function normalizeReturnTo(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  if (!isBrowser()) {
    return value.startsWith("/") && !value.startsWith("//") ? value : null;
  }
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return null;
    }
    const route = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!route.startsWith("/") || route.startsWith("//")) {
      return null;
    }
    return route;
  } catch {
    return null;
  }
}

function currentRoute(): string {
  requireBrowser("currentRoute");
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function isCallbackRoute(
  callbackPath: string,
  pathname = isBrowser() ? window.location.pathname : ""
): boolean {
  return pathname === callbackPath;
}

export function parseCallback(
  url = isBrowser() ? window.location.href : ""
): { code: string; state: string } | null {
  if (!url) {
    return null;
  }
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (!code || !state) {
    return null;
  }
  return { code, state };
}

export function clearCallbackParams(url = isBrowser() ? window.location.href : ""): string {
  if (!url) {
    return "";
  }
  const next = new URL(url);
  next.searchParams.delete("code");
  next.searchParams.delete("state");
  next.searchParams.delete("error");
  if (isBrowser()) {
    history.replaceState({}, "", `${next.pathname}${next.search}${next.hash}`);
  }
  return next.toString();
}

function resolveOptions(options: AvsAuthOptions): Required<AvsAuthOptions> {
  const callbackPath = normalizeReturnTo(options.callbackPath) ?? defaults.callbackPath;
  const fallbackPath = normalizeReturnTo(options.fallbackPath) ?? defaults.fallbackPath;
  const redirectUri =
    options.redirectUri ??
    (isBrowser() ? new URL(callbackPath, window.location.origin).toString() : defaults.redirectUri);
  const clientId = options.clientId ?? deriveClientIdFromRedirectUri(redirectUri);

  return {
    avsBaseUrl: options.avsBaseUrl ?? defaults.avsBaseUrl,
    callbackPath,
    redirectUri,
    clientId,
    requestPii: options.requestPii ?? defaults.requestPii,
    storageKey: options.storageKey ?? defaults.storageKey,
    pkceStorageKey: options.pkceStorageKey ?? defaults.pkceStorageKey,
    returnToStorageKey: options.returnToStorageKey ?? defaults.returnToStorageKey,
    fallbackPath,
    autoSessionMonitor: options.autoSessionMonitor ?? defaults.autoSessionMonitor,
    sessionMonitorIntervalMs:
      options.sessionMonitorIntervalMs ?? defaults.sessionMonitorIntervalMs
  };
}

export async function createPkceBundle(): Promise<PkceBundle> {
  const verifier = randomString(64);
  const state = randomString(32);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return {
    state,
    verifier,
    challenge: bytesToBase64Url(new Uint8Array(digest))
  };
}

export function createSignInUrl(params: {
  avsBaseUrl: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  requestPii?: boolean;
  clientId?: string;
  nonce?: string;
}): string {
  const clientId = params.clientId ?? deriveClientIdFromRedirectUri(params.redirectUri);
  const url = new URL("/authorize", params.avsBaseUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.requestPii) {
    url.searchParams.set("pii", "true");
  }
  if (params.nonce) {
    url.searchParams.set("nonce", params.nonce);
  }
  return url.toString();
}

export function getIdentity(storageKey = defaults.storageKey): AvsIdentity {
  requireBrowser("getIdentity");
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return { userId: null };
  }
  return parseJson<AvsIdentity>(raw) ?? { userId: null };
}

export function persistIdentity(
  userId: string,
  token: string,
  storageKey = defaults.storageKey,
  extras?: { expiresIn?: number }
): void {
  requireBrowser("persistIdentity");
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      userId,
      token,
      expiresIn: extras?.expiresIn,
      receivedAt: Date.now()
    } satisfies AvsIdentity)
  );
}

export function clearIdentity(storageKey = defaults.storageKey): void {
  requireBrowser("clearIdentity");
  localStorage.removeItem(storageKey);
}

export function decodeIdentityClaims(idToken?: string): IdentityClaims | null {
  if (!idToken) {
    return null;
  }
  const parts = idToken.split(".");
  if (parts.length < 2) {
    return null;
  }
  return parseJson<IdentityClaims>(decodeBase64Url(parts[1]));
}

export async function exchangeCode(params: ExchangeCodeParams): Promise<TokenResponse> {
  const endpoint = new URL("/token", params.avsBaseUrl).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code: params.code,
      code_verifier: params.codeVerifier
    })
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status})`);
  }
  return (await response.json()) as TokenResponse;
}

export async function checkSession(
  params: CheckSessionOptions = {}
): Promise<SessionCheckResult> {
  requireBrowser("checkSession");
  const token = params.token ?? getIdentity(params.storageKey ?? defaults.storageKey).token;
  if (!token) {
    return { status: "login_required", reason: "invalid_token" };
  }
  const response = await fetch(new URL("/session/check", params.avsBaseUrl ?? DEFAULT_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 404 || response.status === 501) {
    return { status: "unsupported" };
  }
  return (await response.json()) as SessionCheckResult;
}

export function startSessionMonitor(options: SessionMonitorOptions = {}): SessionMonitorHandle {
  requireBrowser("startSessionMonitor");
  const intervalMs = Math.max(
    1000,
    Math.floor(options.intervalMs ?? DEFAULT_SESSION_MONITOR_INTERVAL_MS)
  );
  let stopped = false;
  let inFlight = false;

  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };

  const runCheck = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    try {
      const result = await checkSession(options);
      if (result.status === "login_required") {
        options.onLoginRequired?.(result);
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error("Session monitor failed"));
    } finally {
      inFlight = false;
    }
  };

  const timer = window.setInterval(() => {
    void runCheck();
  }, intervalMs);
  if (options.immediate !== false) {
    void runCheck();
  }

  return { stop };
}

export function createAvsAuth(options: AvsAuthOptions = {}): AvsAuthClient {
  const resolved = resolveOptions(options);

  function readReturnTo(key: string): string | null {
    requireBrowser("readReturnTo");
    return normalizeReturnTo(sessionStorage.getItem(key));
  }

  function popReturnTo(key: string): string | null {
    const value = readReturnTo(key);
    sessionStorage.removeItem(key);
    return value;
  }

  function storeReturnTo(
    key: string,
    value: string | undefined,
    callbackPath: string,
    fallbackPath: string
  ): void {
    requireBrowser("storeReturnTo");
    let normalized = normalizeReturnTo(value) ?? fallbackPath;
    if (normalized === callbackPath) {
      normalized = fallbackPath;
    }
    sessionStorage.setItem(key, normalized);
  }

  function resolveReturnTarget(
    input: {
      redirectTo?: string;
      returnTo?: string;
      fallbackPath?: string;
    },
    storedReturnTo: string | null
  ): string {
    return (
      normalizeReturnTo(input.redirectTo) ??
      normalizeReturnTo(input.returnTo) ??
      storedReturnTo ??
      normalizeReturnTo(input.fallbackPath) ??
      resolved.fallbackPath
    );
  }

  const finishSignInInternal = async (
    params?: FinishSignInOptions
  ): Promise<{ token: TokenResponse | null; storedReturnTo: string | null }> => {
    requireBrowser("finishSignIn");
    const callback = parseCallback(params?.url ?? window.location.href);
    if (!callback) {
      return { token: null, storedReturnTo: null };
    }

    const rawPkce = sessionStorage.getItem(resolved.pkceStorageKey);
    if (!rawPkce) {
      throw new Error("Missing PKCE verifier in sessionStorage");
    }
    const parsedPkce = parseJson<{ state: string; verifier: string; createdAt?: number }>(rawPkce);
    if (!parsedPkce?.state || !parsedPkce?.verifier) {
      throw new Error("Invalid PKCE verifier payload");
    }
    if (
      typeof parsedPkce.createdAt === "number" &&
      Date.now() - parsedPkce.createdAt > PKCE_MAX_AGE_MS
    ) {
      sessionStorage.removeItem(resolved.pkceStorageKey);
      throw new Error("PKCE verifier expired. Start sign-in again.");
    }
    if (parsedPkce.state !== callback.state) {
      throw new Error("State mismatch in callback");
    }

    const storedReturnTo =
      params?.consumeReturnTo === false
        ? readReturnTo(resolved.returnToStorageKey)
        : popReturnTo(resolved.returnToStorageKey);
    const redirectUri = params?.redirectUri ?? resolved.redirectUri;
    const clientId = params?.clientId ?? deriveClientIdFromRedirectUri(redirectUri);
    const token = await exchangeCode({
      avsBaseUrl: params?.avsBaseUrl ?? resolved.avsBaseUrl,
      clientId,
      redirectUri,
      code: callback.code,
      codeVerifier: parsedPkce.verifier
    });
    persistIdentity(token.pairwise_sub, token.id_token, resolved.storageKey, {
      expiresIn: token.expires_in
    });
    sessionStorage.removeItem(resolved.pkceStorageKey);

    if (params?.redirectAfter) {
      window.location.replace(
        resolveReturnTarget(
          {
            redirectTo: params.redirectTo,
            returnTo: params.returnTo,
            fallbackPath: params.fallbackPath
          },
          storedReturnTo
        )
      );
    } else if (params?.clearCallbackParams !== false) {
      clearCallbackParams();
    }

    return { token, storedReturnTo };
  };

  return {
    options: resolved,
    createPkceBundle,
    createSignInUrl: (params) =>
      createSignInUrl({
        avsBaseUrl: params.avsBaseUrl ?? resolved.avsBaseUrl,
        redirectUri: params.redirectUri ?? resolved.redirectUri,
        clientId: params.clientId ?? resolved.clientId,
        state: params.state,
        codeChallenge: params.codeChallenge,
        requestPii: params.requestPii ?? resolved.requestPii
      }),
    parseCallback,
    clearCallbackParams: () => {
      clearCallbackParams();
    },
    getIdentity: (storageKey) => getIdentity(storageKey ?? resolved.storageKey),
    persistIdentity: (userId, token, storageKey, extras) =>
      persistIdentity(userId, token, storageKey ?? resolved.storageKey, extras),
    clearIdentity: (storageKey) => clearIdentity(storageKey ?? resolved.storageKey),
    decodeIdentityClaims,
    exchangeCode,
    checkSession: (params) =>
      checkSession({
        ...params,
        avsBaseUrl: params?.avsBaseUrl ?? resolved.avsBaseUrl,
        storageKey: params?.storageKey ?? resolved.storageKey
      }),
    startSessionMonitor,
    startSignIn: async (params) => {
      requireBrowser("startSignIn");
      const redirectUri = params?.redirectUri ?? resolved.redirectUri;
      const clientId = params?.clientId ?? deriveClientIdFromRedirectUri(redirectUri);
      const bundle = await createPkceBundle();
      sessionStorage.setItem(
        resolved.pkceStorageKey,
        JSON.stringify({
          state: bundle.state,
          verifier: bundle.verifier,
          createdAt: Date.now()
        })
      );
      storeReturnTo(
        resolved.returnToStorageKey,
        params?.returnTo ?? currentRoute(),
        resolved.callbackPath,
        resolved.fallbackPath
      );
      const url = createSignInUrl({
        avsBaseUrl: params?.avsBaseUrl ?? resolved.avsBaseUrl,
        redirectUri,
        clientId,
        state: bundle.state,
        codeChallenge: bundle.challenge,
        requestPii: params?.requestPii ?? resolved.requestPii
      });
      window.location.assign(url);
      return { url, bundle };
    },
    finishSignIn: async (params) => (await finishSignInInternal(params)).token,
    handleCallback: async (params) => {
      requireBrowser("handleCallback");
      const { token, storedReturnTo } = await finishSignInInternal({
        url: params?.url,
        redirectAfter: false,
        consumeReturnTo: false
      });
      if (!token) {
        return null;
      }
      window.location.replace(
        resolveReturnTarget(
          {
            redirectTo: params?.redirectTo,
            returnTo: params?.returnTo,
            fallbackPath: params?.fallbackPath
          },
          storedReturnTo
        )
      );
      return token;
    }
  };
}

export function createHostedRuntime(options: HostedScriptOptions = {}): HostedRuntime {
  const client = createAvsAuth(options);

  function dispatchLoginRequired(
    detail: Extract<SessionCheckResponse, { status: "login_required" }>
  ): void {
    if (!isBrowser()) {
      return;
    }
    window.dispatchEvent(new CustomEvent("avs-auth:login-required", { detail }));
  }

  function bindLinkUpgrade(selectors?: { linkSelector?: string; buttonSelector?: string }): void {
    requireBrowser("bindLinkUpgrade");
    const linkSelector = selectors?.linkSelector ?? 'a[data-avs-auth], a[data-avs-auth-link]';
    const buttonSelector =
      selectors?.buttonSelector ?? '[data-avs-auth-button], button[data-avs-auth]';
    const nodes = [
      ...Array.from(document.querySelectorAll<HTMLElement>(linkSelector)),
      ...Array.from(document.querySelectorAll<HTMLElement>(buttonSelector))
    ];
    for (const node of nodes) {
      if (node.dataset.avsAuthBound === "true") {
        continue;
      }
      node.dataset.avsAuthBound = "true";
      node.addEventListener("click", (event) => {
        event.preventDefault();
        void client.startSignIn({
          requestPii: node.dataset.avsAuthPii === "true" ? true : undefined,
          returnTo: node.dataset.avsAuthReturnTo || undefined
        });
      });
    }
  }

  async function autoHandleCallback(): Promise<TokenResponse | null> {
    requireBrowser("autoHandleCallback");
    if (!isCallbackRoute(client.options.callbackPath)) {
      return null;
    }
    return client.handleCallback();
  }

  return {
    client,
    bindLinkUpgrade,
    autoHandleCallback,
    dispatchLoginRequired
  };
}

export function bootstrapHostedScript(script?: HTMLScriptElement): HostedRuntime | null {
  if (!isBrowser()) {
    return null;
  }
  const currentScript =
    script ??
    (document.currentScript instanceof HTMLScriptElement ? document.currentScript : null);
  if (!currentScript) {
    return null;
  }

  const scriptUrl = new URL(currentScript.src);
  const runtime = createHostedRuntime({
    avsBaseUrl: scriptUrl.origin,
    callbackPath: currentScript.dataset.callbackPath,
    requestPii: parseBooleanDataValue(currentScript.dataset.requestPii, false),
    storageKey: currentScript.dataset.storageKey,
    autoSessionMonitor: parseBooleanDataValue(currentScript.dataset.monitorSession, true),
    sessionMonitorIntervalMs: currentScript.dataset.sessionMonitorIntervalMs
      ? Number(currentScript.dataset.sessionMonitorIntervalMs)
      : undefined
  });

  runtime.bindLinkUpgrade({
    linkSelector: currentScript.dataset.linkSelector,
    buttonSelector: currentScript.dataset.buttonSelector
  });

  if (parseBooleanDataValue(currentScript.dataset.autoHandleCallback, true)) {
    void runtime.autoHandleCallback();
  }

  if (parseBooleanDataValue(currentScript.dataset.monitorSession, true)) {
    runtime.client.startSessionMonitor({
      intervalMs:
        currentScript.dataset.sessionMonitorIntervalMs != null
          ? Number(currentScript.dataset.sessionMonitorIntervalMs)
          : undefined,
      onLoginRequired: (detail) => {
        runtime.dispatchLoginRequired(detail);
      }
    });
  }

  return runtime;
}
