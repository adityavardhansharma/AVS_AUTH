export type ConvexConfig = {
  convexUrl?: string;
  convexAdminKey?: string;
};

export function hasConvexConfig(config: ConvexConfig): boolean {
  return Boolean(config.convexUrl && config.convexAdminKey);
}

async function callConvex<TResponse>(
  url: string,
  config: ConvexConfig,
  functionName: string,
  args: Record<string, unknown>
): Promise<TResponse> {
  if (!hasConvexConfig(config)) {
    throw new Error("Convex is not configured");
  }
  const response = await fetch(`${config.convexUrl}${url}`, {
    method: "POST",
    headers: {
      authorization: `Convex ${config.convexAdminKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      path: functionName,
      args
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Convex call to ${functionName} failed (${response.status}): ${text}`);
  }
  const result = await response.json();
  // Convex HTTP API wraps results in { status: "success", value: ... }
  if (result && typeof result === "object" && "value" in (result as Record<string, unknown>)) {
    return (result as any).value as TResponse;
  }
  return result as TResponse;
}

export function callConvexQuery<TResponse>(
  config: ConvexConfig,
  functionName: string,
  args: Record<string, unknown>
): Promise<TResponse> {
  return callConvex<TResponse>("/api/query", config, functionName, args);
}

export function callConvexMutation<TResponse>(
  config: ConvexConfig,
  functionName: string,
  args: Record<string, unknown>
): Promise<TResponse> {
  return callConvex<TResponse>("/api/mutation", config, functionName, args);
}
