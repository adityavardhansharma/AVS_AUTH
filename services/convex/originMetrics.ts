import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const WINDOW_MS = 60_000; // 1 minute window

export const recordAndCheckRateLimit = mutationGeneric({
  args: {
    clientId: v.string(),
    endpoint: v.union(v.literal("authorize"), v.literal("token"), v.literal("session_check")),
    limitAuthorize: v.optional(v.number()),
    limitToken: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = now - (now % WINDOW_MS);
    const limitAuthorize = args.limitAuthorize ?? 60;
    const limitToken = args.limitToken ?? 120;

    const existing = await ctx.db
      .query("origin_metrics")
      .withIndex("by_client_id_window_start", (q: any) =>
        q.eq("clientId", args.clientId).eq("windowStart", windowStart)
      )
      .first();

    if (existing) {
      // Check if already blocked
      if (existing.blockedUntil && existing.blockedUntil > now) {
        const retryAfter = Math.ceil((existing.blockedUntil - now) / 1000);
        return { allowed: false, retryAfter };
      }

      // Increment the counter for the relevant endpoint
      const updates: Record<string, number> = {};
      if (args.endpoint === "authorize") {
        updates.authorizeCount = existing.authorizeCount + 1;
      } else if (args.endpoint === "token") {
        updates.tokenCount = existing.tokenCount + 1;
      } else {
        updates.sessionCheckCount = existing.sessionCheckCount + 1;
      }

      // Check limits after increment
      const newAuthorizeCount = args.endpoint === "authorize" ? existing.authorizeCount + 1 : existing.authorizeCount;
      const newTokenCount = args.endpoint === "token" ? existing.tokenCount + 1 : existing.tokenCount;

      if (newAuthorizeCount > limitAuthorize || newTokenCount > limitToken) {
        const blockedUntil = windowStart + WINDOW_MS;
        await ctx.db.patch(existing._id, { ...updates, blockedUntil });
        const retryAfter = Math.ceil((blockedUntil - now) / 1000);
        return { allowed: false, retryAfter };
      }

      await ctx.db.patch(existing._id, updates);
      return { allowed: true, retryAfter: 0 };
    } else {
      // Create new window record
      const counts = {
        authorizeCount: args.endpoint === "authorize" ? 1 : 0,
        tokenCount: args.endpoint === "token" ? 1 : 0,
        sessionCheckCount: args.endpoint === "session_check" ? 1 : 0
      };
      await ctx.db.insert("origin_metrics", {
        clientId: args.clientId,
        windowStart,
        ...counts
      });
      return { allowed: true, retryAfter: 0 };
    }
  }
});
