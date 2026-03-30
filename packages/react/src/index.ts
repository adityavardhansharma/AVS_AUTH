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

  function useAuth() {
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
      void client.handleCallback().finally(() => {
        const identity = client.getIdentity();
        setIsAuthenticated(Boolean(identity.userId && identity.token));
        setIsLoading(false);
      });
    }, []);

    const fetchAccessToken = useCallback(async () => {
      const identity = client.getIdentity();
      return identity.token ?? null;
    }, []);

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
    const client = getClient();
    const nextIdentity = client.getIdentity();
    setIdentity(nextIdentity);
    setSessionState(nextIdentity.userId ? "unknown" : "login_required");
  }, [getClient]);

  const clearIdentity = useCallback(() => {
    const client = getClient();
    client.clearIdentity();
    setIdentity({ userId: null });
    setSessionState("login_required");
  }, [getClient]);

  const signIn = useCallback(
    async (params?: StartSignInOptions) => {
      await getClient().startSignIn(params);
    },
    [getClient]
  );

  const handleCallback = useCallback(
    async (params?: HandleCallbackOptions) => {
      const token = await getClient().handleCallback(params);
      refreshIdentity();
      return token;
    },
    [getClient, refreshIdentity]
  );

  const checkSession = useCallback(
    async (params?: CheckSessionOptions) => {
      const client = getClient();
      const result = await client.checkSession(params);
      if (result.status === "active") {
        setSessionState("active");
      } else if (result.status === "login_required") {
        client.clearIdentity();
        setIdentity({ userId: null });
        setSessionState("login_required");
      } else {
        setSessionState("unknown");
      }
      return result;
    },
    [getClient]
  );

  useEffect(() => {
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
          setSessionState(nextIdentity.userId ? "unknown" : "login_required");
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
    if (loading || options.autoSessionMonitor === false || !identity.token) {
      return;
    }

    const client = getClient();
    const monitor = client.startSessionMonitor({
      intervalMs: options.sessionMonitorIntervalMs,
      onLoginRequired: () => {
        client.clearIdentity();
        setIdentity({ userId: null });
        setSessionState("login_required");
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
