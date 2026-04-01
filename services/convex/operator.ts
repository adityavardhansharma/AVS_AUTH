import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const blockClient = mutationGeneric({
  args: { clientId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const client = await ctx.db
      .query("clients")
      .withIndex("by_client_id", (q: any) => q.eq("clientId", args.clientId))
      .first();

    if (client) {
      await ctx.db.patch(client._id, {
        status: "blocked",
        blockedReason: args.reason
      });
    } else {
      const now = Date.now();
      await ctx.db.insert("clients", {
        clientId: args.clientId,
        origin: args.clientId.replace(/^origin:/, ""),
        firstSeenAt: now,
        lastSeenAt: now,
        status: "blocked",
        blockedReason: args.reason
      });
    }
    return null;
  }
});

export const unblockClient = mutationGeneric({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const client = await ctx.db
      .query("clients")
      .withIndex("by_client_id", (q: any) => q.eq("clientId", args.clientId))
      .first();

    if (client) {
      await ctx.db.patch(client._id, {
        status: "active",
        blockedReason: undefined
      });
    }
    return null;
  }
});

export const revokeClientConsentForUser = mutationGeneric({
  args: { userId: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const consent = await ctx.db
      .query("consents")
      .withIndex("by_user_id_client_id", (q: any) =>
        q.eq("userId", args.userId).eq("clientId", args.clientId)
      )
      .first();

    if (consent) {
      await ctx.db.patch(consent._id, { revokedAt: Date.now() });
    }
    return null;
  }
});

export const revokeAllSessionsForUser = mutationGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("broker_sessions")
      .withIndex("by_user_id", (q: any) => q.eq("userId", args.userId))
      .collect();

    const now = Date.now();
    for (const session of sessions) {
      if (!session.revokedAt) {
        await ctx.db.patch(session._id, { revokedAt: now });
      }
    }
    return null;
  }
});
