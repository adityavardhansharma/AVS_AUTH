import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAvsAuth,
  decodeIdentityClaims,
  type AvsAuthClient
} from "@avs-auth/auth";
import type {
  AvsAuthOptions,
  AvsIdentity,
  CheckSessionOptions,
  HandleCallbackOptions,
  IdentityClaims,
  SessionCheckResult,
  SessionMonitorOptions,
  StartSignInOptions,
  TokenResponse,
  UseAvsAuthOptions,
  UseAvsAuthResult
} from "@avs-auth/types";

export { createAvsAuth, decodeIdentityClaims };
export type { UseAvsAuthOptions, UseAvsAuthResult };

const REFRESH_LEEWAY_MS = 30_000;

function readStoredTokenState(client: AvsAuthClient): {
  userId: string | null;
  token: string | null;
  expiresAtMs: number | null;
} {
  const identity = client.getIdentity();
  const token = identity.token ?? null;
  if (!token) return { userId: identity.userId, token: null, expiresAtMs: null };
  const claims = decodeIdentityClaims(token);
  return {
    userId: identity.userId,
    token,
    expiresAtMs: typeof claims?.exp === "number" ? claims.exp * 1000 : null
  };
}

function hasExpired(expiresAtMs: number | null): boolean {
  return expiresAtMs !== null && expiresAtMs <= Date.now();
}

function expiresSoon(expiresAtMs: number | null): boolean {
  return expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_LEEWAY_MS;
}

export function createAvsConvexAuth(options: AvsAuthOptions): {
  useAuth: () => {
    isLoading: boolean;
    isAuthenticated: boolean;
    fetchAccessToken: (opts: { forceRefreshToken: boolean }) => Promise<string | null>;
  };
  signIn: (opts?: StartSignInOptions) => Promise<void>;
  signOut: () => void;
} {
  const client = createAvsAuth(options);
  let refreshInFlight: Promise<void> | null = null;

  function beginReauth(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = client
      .startSignIn()
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  }

  function useAuth() {
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(() => {
      const state = readStoredTokenState(client);
      return state.userId !== null && state.token !== null && !hasExpired(state.expiresAtMs);
    });

    const ran = useRef(false);

    useEffect(() => {
      if (ran.current) return;
      ran.current = true;
      client.handleCallback().finally(() => {
        const state = readStoredTokenState(client);
        if (state.token && hasExpired(state.expiresAtMs)) {
          client.clearIdentity();
          setIsAuthenticated(false);
        } else {
          setIsAuthenticated(state.userId !== null && state.token !== null);
        }
        setIsLoading(false);
      });
    }, []);

    const fetchAccessToken = useCallback(
      async (opts: { forceRefreshToken: boolean }) => {
        const state = readStoredTokenState(client);
        if (!state.token || state.userId === null) {
          setIsAuthenticated(false);
          return null;
        }
        if (hasExpired(state.expiresAtMs)) {
          client.clearIdentity();
          setIsAuthenticated(false);
          if (opts.forceRefreshToken) {
            void beginReauth().catch(() => undefined);
          }
          return null;
        }
        if (opts.forceRefreshToken && expiresSoon(state.expiresAtMs)) {
          void beginReauth().catch(() => undefined);
          return null;
        }
        setIsAuthenticated(true);
        return state.token;
      },
      []
    );

    return { isLoading, isAuthenticated, fetchAccessToken };
  }

  return {
    useAuth,
    signIn: async (opts) => {
      await client.startSignIn(opts);
    },
    signOut: () => {
      client.clearIdentity();
      window.location.reload();
    }
  };
}

export function useAvsAuth(options: UseAvsAuthOptions = {}): UseAvsAuthResult {
  const [identity, setIdentity] = useState<AvsIdentity>({ userId: null });
  const [sessionState, setSessionState] = useState<"unknown" | "active" | "login_required">(
    "unknown"
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  const clientRef = useRef<AvsAuthClient | null>(null);
  optionsRef.current = options;

  const getClient = useCallback(() => {
    if (typeof window === "undefined") {
      throw new Error("useAvsAuth can only run in a browser context");
    }
    if (!clientRef.current) {
      clientRef.current = createAvsAuth(optionsRef.current);
    }
    return clientRef.current;
  }, []);

  const refreshIdentity = useCallback(() => {
    try {
      const client = getClient();
      const nextIdentity = client.getIdentity();
      setIdentity(nextIdentity);
      setSessionState(nextIdentity.token ? "unknown" : "login_required");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh identity");
    }
  }, [getClient]);

  const clearIdentity = useCallback(() => {
    try {
      const client = getClient();
      client.clearIdentity();
      setIdentity({ userId: null });
      setSessionState("login_required");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear identity");
    }
  }, [getClient]);

  const signIn = useCallback(
    async (params?: StartSignInOptions) => {
      await getClient().startSignIn(params);
    },
    [getClient]
  );

  const handleCallback = useCallback(
    async (params?: HandleCallbackOptions) => {
      const client = getClient();
      const token = await client.handleCallback(params);
      const nextIdentity = client.getIdentity();
      setIdentity(nextIdentity);
      setSessionState(nextIdentity.token ? "unknown" : "login_required");
      return token;
    },
    [getClient]
  );

  const checkSession = useCallback(
    async (params?: CheckSessionOptions) => {
      const client = getClient();
      const result = await client.checkSession(params);
      if (result.status === "active") {
        setSessionState("active");
        return result;
      }
      if (result.status === "unsupported") {
        setSessionState("unknown");
        return result;
      }
      // login_required
      client.clearIdentity();
      setIdentity({ userId: null });
      setSessionState("login_required");
      return result;
    },
    [getClient]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const client = getClient();
        if (optionsRef.current.autoHandleCallback !== false) {
          await client.handleCallback();
        }
        if (!cancelled) {
          const nextIdentity = client.getIdentity();
          setIdentity(nextIdentity);
          setSessionState(nextIdentity.token ? "unknown" : "login_required");
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to initialize auth");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getClient]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (loading || options.autoSessionMonitor === false) {
      return;
    }
    // When monitor starts with no token, set sessionState to login_required.
    if (!identity.token) {
      setSessionState("login_required");
      return;
    }

    const client = getClient();
    const monitor = client.startSessionMonitor({
      intervalMs: options.sessionMonitorIntervalMs ?? 60_000,
      immediate: true,
      onLoginRequired: () => {
        client.clearIdentity();
        setIdentity({ userId: null });
        setSessionState("login_required");
      },
      onError: () => {
        // fail-open: retain local identity and retry on next interval.
      }
    } satisfies SessionMonitorOptions);

    return () => {
      monitor.stop();
    };
  }, [
    getClient,
    identity.token,
    loading,
    options.autoSessionMonitor,
    options.sessionMonitorIntervalMs
  ]);

  const claims = useMemo<IdentityClaims | null>(
    () => decodeIdentityClaims(identity.token),
    [identity.token]
  );

  return {
    identity,
    claims,
    sessionState,
    loading,
    error,
    signIn,
    handleCallback: handleCallback as (
      params?: HandleCallbackOptions
    ) => Promise<TokenResponse | null>,
    checkSession: checkSession as (
      params?: CheckSessionOptions
    ) => Promise<SessionCheckResult>,
    refreshIdentity,
    clearIdentity,
    authClient: clientRef.current
  };
}
