export const AVS_AUTH_SCRIPT_SOURCE = `(function () {
  if (typeof window === "undefined") {
    return;
  }

  var scriptEl = document.currentScript;
  var dataset = scriptEl && scriptEl.dataset ? scriptEl.dataset : {};
  var scriptSrc = scriptEl && scriptEl.src ? scriptEl.src : "";
  var fallbackAvsBaseUrl = (function () {
    try {
      if (scriptSrc) {
        return new URL(scriptSrc, window.location.href).origin;
      }
    } catch (_error) {
      // ignore parse issues and use server default.
    }
    return "https://auth.adityavs.tech";
  })();

  function randomString(length) {
    var size = typeof length === "number" ? length : 64;
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    var random = new Uint8Array(size);
    crypto.getRandomValues(random);
    var out = "";
    for (var i = 0; i < random.length; i += 1) {
      out += chars[random[i] % chars.length];
    }
    return out;
  }

  function bytesToBase64Url(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  function parseJson(value) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function deriveClientId(redirectUri) {
    try {
      return "origin:" + new URL(redirectUri).origin;
    } catch (_error) {
      return "origin:" + window.location.origin;
    }
  }

  function normalizeReturnTo(value) {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }

    try {
      var parsed = new URL(value, window.location.origin);
      if (parsed.origin !== window.location.origin) {
        return null;
      }

      var route = parsed.pathname + parsed.search + parsed.hash;
      if (!route.startsWith("/") || route.startsWith("//")) {
        return null;
      }
      return route;
    } catch (_error) {
      return null;
    }
  }

  function currentRoute() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function readStoredReturnTo(storageKey) {
    var raw = sessionStorage.getItem(storageKey);
    return normalizeReturnTo(raw);
  }

  function popStoredReturnTo(storageKey) {
    var route = readStoredReturnTo(storageKey);
    sessionStorage.removeItem(storageKey);
    return route;
  }

  function rememberReturnTo(route, storageKey, callbackPath, fallbackPath) {
    var normalized = normalizeReturnTo(route) || fallbackPath;
    if (normalized === callbackPath) {
      normalized = fallbackPath;
    }
    sessionStorage.setItem(storageKey, normalized);
    return normalized;
  }

  function resolveReturnTarget(options, storedReturnTo, defaultsObject) {
    var custom = normalizeReturnTo(options && options.redirectTo);
    if (!custom) {
      custom = normalizeReturnTo(options && options.returnTo);
    }
    if (custom) {
      return custom;
    }
    if (storedReturnTo) {
      return storedReturnTo;
    }

    return normalizeReturnTo(options && options.fallbackPath) || defaultsObject.fallbackPath || "/";
  }

  function parseScope(scope) {
    if (typeof scope !== "string") {
      return false;
    }

    var parts = scope.split(/\\s+/).filter(Boolean);
    return parts.includes("profile") || parts.includes("email");
  }

  function parseBoolean(value) {
    return value === true || value === "true" || value === "1" || value === "yes";
  }

  var defaultCallbackPath = normalizeReturnTo(dataset.avsCallbackPath || "/avs-auth/callback") || "/avs-auth/callback";
  var defaultRedirectUri = dataset.avsRedirectUri || new URL(defaultCallbackPath, window.location.origin).toString();
  var defaultClientId = dataset.avsClientId || deriveClientId(defaultRedirectUri);
  var parsedMonitorInterval = Number.parseInt(dataset.avsSessionMonitorIntervalMs || "", 10);
  var defaultSessionMonitorIntervalMs = Number.isFinite(parsedMonitorInterval) && parsedMonitorInterval >= 1000
    ? parsedMonitorInterval
    : 60000;
  var pkceMaxAgeMs = 10 * 60 * 1000;
  var defaults = {
    avsBaseUrl: dataset.avsBaseUrl || fallbackAvsBaseUrl,
    callbackPath: defaultCallbackPath,
    redirectUri: defaultRedirectUri,
    clientId: defaultClientId,
    requestPii: dataset.avsPii === "true" || parseScope(dataset.avsScope),
    storageKey: dataset.avsStorageKey || "avs_auth_identity",
    pkceStorageKey: dataset.avsPkceStorageKey || "avs_auth_pkce",
    returnToStorageKey: dataset.avsReturnToStorageKey || "avs_auth_return_to",
    fallbackPath: normalizeReturnTo(dataset.avsFallbackPath || "/") || "/",
    autoSessionMonitor: dataset.avsAutoSessionMonitor !== "false",
    sessionMonitorIntervalMs: defaultSessionMonitorIntervalMs
  };

  async function createPkceBundle() {
    var verifier = randomString(64);
    var state = randomString(32);
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    var challenge = bytesToBase64Url(new Uint8Array(digest));
    return { state: state, verifier: verifier, challenge: challenge };
  }

  function createSignInUrl(params) {
    var options = params || {};
    var redirectUri = options.redirectUri || defaults.redirectUri;
    var effectiveClientId = options.clientId || deriveClientId(redirectUri) || defaults.clientId;
    var state = options.state;
    var challenge = options.codeChallenge;
    if (!state || !challenge) {
      throw new Error("createSignInUrl requires both state and codeChallenge.");
    }

    var requestPii = options.requestPii === true || options.pii === true || (options.requestPii !== false && defaults.requestPii);
    var url = new URL("/authorize", options.avsBaseUrl || defaults.avsBaseUrl);
    url.searchParams.set("client_id", effectiveClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (requestPii) {
      url.searchParams.set("pii", "true");
    }
    return url.toString();
  }

  function parseCallback(url) {
    var parsed = new URL(url || window.location.href);
    var code = parsed.searchParams.get("code");
    var state = parsed.searchParams.get("state");
    if (!code || !state) {
      return null;
    }
    return { code: code, state: state };
  }

  function clearCallbackParams() {
    var url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    history.replaceState({}, "", url.toString());
  }

  function getIdentity(storageKey) {
    var key = storageKey || defaults.storageKey;
    var raw = localStorage.getItem(key);
    if (!raw) {
      return { userId: null };
    }

    var parsed = parseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      return { userId: null };
    }

    return {
      userId: typeof parsed.userId === "string" ? parsed.userId : (typeof parsed.pairwiseSub === "string" ? parsed.pairwiseSub : null),
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      expiresIn: typeof parsed.expiresIn === "number" ? parsed.expiresIn : undefined,
      receivedAt: typeof parsed.receivedAt === "number" ? parsed.receivedAt : undefined
    };
  }

  function persistIdentity(userId, token, storageKey, extras) {
    var key = storageKey || defaults.storageKey;
    var payload = {
      userId: userId,
      token: token
    };
    if (extras && typeof extras === "object") {
      if (typeof extras.expiresIn === "number") {
        payload.expiresIn = extras.expiresIn;
      }
      if (typeof extras.receivedAt === "number") {
        payload.receivedAt = extras.receivedAt;
      }
    }
    localStorage.setItem(key, JSON.stringify(payload));
  }

  function clearIdentity(storageKey) {
    localStorage.removeItem(storageKey || defaults.storageKey);
  }

  async function exchangeCode(params) {
    var options = params || {};
    if (Object.prototype.hasOwnProperty.call(options, "clientSecret") && options.clientSecret !== undefined) {
      throw new Error("clientSecret is not supported in browser code. Use a server-side token exchange.");
    }

    var tokenEndpoint = new URL("/token", options.avsBaseUrl || defaults.avsBaseUrl).toString();
    var redirectUri = options.redirectUri || defaults.redirectUri;
    var effectiveClientId = options.clientId || deriveClientId(redirectUri) || defaults.clientId;

    var body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: effectiveClientId,
      redirect_uri: redirectUri,
      code: options.code || "",
      code_verifier: options.codeVerifier || ""
    });

    var response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body
    });

    if (!response.ok) {
      throw new Error("Token exchange failed (" + response.status + ")");
    }

    return response.json();
  }

  function decodeIdentityClaims(idToken) {
    if (typeof idToken !== "string") {
      return null;
    }
    var parts = idToken.split(".");
    if (parts.length < 2) {
      return null;
    }
    try {
      return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch (_error) {
      return null;
    }
  }

  async function checkSession(params) {
    var options = params || {};
    var token = typeof options.token === "string"
      ? options.token
      : getIdentity(options.storageKey || defaults.storageKey).token;
    if (!token) {
      return {
        status: "login_required",
        reason: "invalid_token"
      };
    }

    var expectedClientId = options.clientId;
    if (!expectedClientId && options.redirectUri) {
      expectedClientId = deriveClientId(options.redirectUri);
    }
    if (expectedClientId) {
      var claims = decodeIdentityClaims(token);
      if (!claims || claims.aud !== expectedClientId) {
        return {
          status: "login_required",
          reason: "invalid_token"
        };
      }
    }

    var endpoint = new URL("/session/check", options.avsBaseUrl || defaults.avsBaseUrl).toString();
    var response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (response.status === 404 || response.status === 501) {
      return { status: "unsupported" };
    }

    if (response.status === 200) {
      var activePayload = parseJson(await response.text());
      if (activePayload && activePayload.status === "active") {
        return { status: "active" };
      }
      throw new Error("Session check returned an invalid success payload.");
    }

    if (response.status === 401) {
      var deniedPayload = parseJson(await response.text());
      var reason = deniedPayload && typeof deniedPayload.reason === "string" ? deniedPayload.reason : "invalid_token";
      if (reason !== "revoked" && reason !== "expired" && reason !== "invalid_token") {
        reason = "invalid_token";
      }
      return {
        status: "login_required",
        reason: reason
      };
    }

    throw new Error("Session check failed (" + response.status + ").");
  }

  function startSessionMonitor(params) {
    var options = params || {};
    var intervalMs = Math.max(1000, Math.floor(options.intervalMs || defaults.sessionMonitorIntervalMs));
    var immediate = options.immediate !== false;
    var stopped = false;
    var inFlight = false;

    function stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(timer);
    }

    async function runCheck() {
      if (stopped || inFlight) {
        return;
      }

      inFlight = true;
      try {
        var result = await checkSession(options);
        if (result.status === "login_required") {
          if (typeof options.onLoginRequired === "function") {
            options.onLoginRequired(result);
          }
          stop();
        }
      } catch (error) {
        if (typeof options.onError === "function") {
          options.onError(error);
        }
      } finally {
        inFlight = false;
      }
    }

    var timer = setInterval(function () {
      runCheck().catch(function () {
        // Error forwarding is handled inside runCheck.
      });
    }, intervalMs);

    if (immediate) {
      runCheck().catch(function () {
        // Error forwarding is handled inside runCheck.
      });
    }

    return { stop: stop };
  }

  async function startSignIn(params) {
    var options = params || {};
    var returnToStorageKey = options.returnToStorageKey || defaults.returnToStorageKey;
    rememberReturnTo(
      typeof options.returnTo === "string" ? options.returnTo : currentRoute(),
      returnToStorageKey,
      defaults.callbackPath,
      defaults.fallbackPath
    );

    var bundle = options.bundle || (await createPkceBundle());
    var pkceStorageKey = options.pkceStorageKey || defaults.pkceStorageKey;
    sessionStorage.setItem(
      pkceStorageKey,
      JSON.stringify({
        state: bundle.state,
        verifier: bundle.verifier,
        createdAt: Date.now()
      })
    );

    var url = createSignInUrl({
      avsBaseUrl: options.avsBaseUrl,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      requestPii: options.requestPii,
      pii: options.pii,
      state: bundle.state,
      codeChallenge: bundle.challenge
    });

    window.location.assign(url);
    return { url: url, bundle: bundle };
  }

  async function finishSignIn(params) {
    var options = params || {};
    var callback = parseCallback(options.url || window.location.href);
    if (!callback) {
      return null;
    }

    var pkceStorageKey = options.pkceStorageKey || defaults.pkceStorageKey;
    var rawPkce = sessionStorage.getItem(pkceStorageKey);
    if (!rawPkce) {
      throw new Error("Missing PKCE verifier in sessionStorage.");
    }

    var pkce = parseJson(rawPkce);
    if (!pkce || typeof pkce.state !== "string" || typeof pkce.verifier !== "string") {
      throw new Error("PKCE verifier payload is invalid.");
    }

    if (typeof pkce.createdAt === "number" && Date.now() - pkce.createdAt > pkceMaxAgeMs) {
      sessionStorage.removeItem(pkceStorageKey);
      throw new Error("PKCE verifier expired. Start sign-in again.");
    }

    if (pkce.state !== callback.state) {
      throw new Error("State mismatch in callback.");
    }

    var returnToStorageKey = options.returnToStorageKey || defaults.returnToStorageKey;
    var storedReturnTo = options.consumeReturnTo === false
      ? readStoredReturnTo(returnToStorageKey)
      : popStoredReturnTo(returnToStorageKey);

    var token = await exchangeCode({
      avsBaseUrl: options.avsBaseUrl,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      code: callback.code,
      codeVerifier: pkce.verifier
    });

    if (!token || typeof token.pairwise_sub !== "string" || typeof token.id_token !== "string") {
      throw new Error("Token response missing required fields.");
    }

    persistIdentity(token.pairwise_sub, token.id_token, options.storageKey || defaults.storageKey, {
      expiresIn: typeof token.expires_in === "number" ? token.expires_in : undefined,
      receivedAt: Date.now()
    });
    sessionStorage.removeItem(pkceStorageKey);

    if (options.redirectAfter === true) {
      var redirectTarget = resolveReturnTarget(options, storedReturnTo, defaults);
      window.location.replace(redirectTarget);
    } else if (options.clearCallbackParams !== false) {
      clearCallbackParams();
    }

    return token;
  }

  async function handleCallback(params) {
    if (handleCallback.inFlight) {
      return handleCallback.inFlight;
    }

    var options = params || {};
    var run = (async function () {
      var returnToStorageKey = options.returnToStorageKey || defaults.returnToStorageKey;
      var token = await finishSignIn(
        Object.assign({}, options, {
          redirectAfter: false,
          consumeReturnTo: false
        })
      );
      if (!token) {
        return null;
      }

      var storedReturnTo = popStoredReturnTo(returnToStorageKey);
      var redirectTarget = resolveReturnTarget(options, storedReturnTo, defaults);
      window.location.replace(redirectTarget);
      return token;
    })();

    handleCallback.inFlight = run;
    try {
      return await run;
    } finally {
      handleCallback.inFlight = null;
    }
  }

  handleCallback.inFlight = null;

  function getAuthorizeLinkConfig(anchor) {
    if (!anchor || typeof anchor.href !== "string" || anchor.href.length === 0) {
      return null;
    }

    var parsed;
    try {
      parsed = new URL(anchor.href, window.location.href);
    } catch (_error) {
      return null;
    }

    if (parsed.pathname !== "/authorize") {
      return null;
    }

    var redirectUri = parsed.searchParams.get("redirect_uri");
    if (!redirectUri) {
      return null;
    }

    if (parsed.searchParams.get("state") || parsed.searchParams.get("code_challenge") || parsed.searchParams.get("code_challenge_method")) {
      return null;
    }

    return {
      avsBaseUrl: parsed.origin,
      redirectUri: redirectUri,
      clientId: parsed.searchParams.get("client_id") || undefined,
      requestPii: parseBoolean(parsed.searchParams.get("pii")),
      returnTo: parsed.searchParams.get("return_to") || undefined
    };
  }

  function shouldHandleAnchorClick(event) {
    if (event.defaultPrevented) {
      return false;
    }

    if (event.button !== 0) {
      return false;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }

    return true;
  }

  function bootstrapAuthorizeLinks() {
    if (window.__avsAuthorizeLinksBootstrapped) {
      return;
    }
    window.__avsAuthorizeLinksBootstrapped = true;

    document.addEventListener("click", function (event) {
      if (!shouldHandleAnchorClick(event)) {
        return;
      }

      var target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }

      var anchor = target.closest("a[href]");
      if (!anchor) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      var config = getAuthorizeLinkConfig(anchor);
      if (!config) {
        return;
      }

      event.preventDefault();
      startSignIn(config).catch(function (error) {
        console.error("[avs-auth.js] Failed to start sign-in from authorize link", error);
      });
    });
  }

  function bootstrapCallbackHandler() {
    if (dataset.avsAutoCallback === "false") {
      return;
    }

    if (window.location.pathname !== defaults.callbackPath) {
      return;
    }

    if (!parseCallback(window.location.href)) {
      return;
    }

    handleCallback().catch(function (error) {
      console.error("[avs-auth.js] Failed to handle callback", error);
    });
  }

  function bootstrapSessionMonitor() {
    if (!defaults.autoSessionMonitor) {
      return;
    }

    var identity = getIdentity(defaults.storageKey);
    if (!identity || typeof identity.token !== "string") {
      return;
    }

    startSessionMonitor({
      storageKey: defaults.storageKey,
      intervalMs: defaults.sessionMonitorIntervalMs,
      onLoginRequired: function (result) {
        clearIdentity(defaults.storageKey);
        try {
          window.dispatchEvent(new CustomEvent("avs-auth:login-required", { detail: result }));
        } catch (_error) {
          // Ignore CustomEvent availability issues.
        }
      },
      onError: function (error) {
        console.warn("[avs-auth.js] Session monitor check failed", error);
      }
    });
  }

  var api = {
    defaults: defaults,
    createPkceBundle: createPkceBundle,
    createSignInUrl: createSignInUrl,
    parseCallback: parseCallback,
    clearCallbackParams: clearCallbackParams,
    startSignIn: startSignIn,
    finishSignIn: finishSignIn,
    handleCallback: handleCallback,
    exchangeCode: exchangeCode,
    checkSession: checkSession,
    startSessionMonitor: startSessionMonitor,
    getIdentity: getIdentity,
    persistIdentity: persistIdentity,
    clearIdentity: clearIdentity,
    decodeIdentityClaims: decodeIdentityClaims
  };

  window.AvsAuth = Object.assign(window.AvsAuth || {}, api);
  if (dataset.avsAutoLinks !== "false") {
    bootstrapAuthorizeLinks();
  }
  bootstrapCallbackHandler();
  bootstrapSessionMonitor();
})();`;
