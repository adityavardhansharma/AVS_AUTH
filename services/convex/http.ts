export type ConvexHttpConfig = {
  convexUrl: string;
  adminKey: string;
};

export async function callConvexQuery<TResponse>(
  config: ConvexHttpConfig,
  functionName: string,
  args: Record<string, unknown>
): Promise<TResponse> {
  const response = await fetch(`${config.convexUrl}/api/query`, {
    method: "POST",
    headers: {
      authorization: `Convex ${config.adminKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      path: functionName,
      args
    })
  });
  if (!response.ok) {
    throw new Error(`Convex query failed (${response.status})`);
  }
  const result = await response.json();
  return (result as any).value ?? result;
}

export async function callConvexMutation<TResponse>(
  config: ConvexHttpConfig,
  functionName: string,
  args: Record<string, unknown>
): Promise<TResponse> {
  const response = await fetch(`${config.convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      authorization: `Convex ${config.adminKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      path: functionName,
      args
    })
  });
  if (!response.ok) {
    throw new Error(`Convex mutation failed (${response.status})`);
  }
  const result = await response.json();
  return (result as any).value ?? result;
}
