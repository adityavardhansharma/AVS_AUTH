import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const createBrokerSession = mutationGeneric({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastSeenAt: v.number(),
    ipHash: v.optional(v.string()),
    userAgentHash: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("broker_sessions", {
      sessionId: args.sessionId,
      userId: args.userId,
      expiresAt: args.expiresAt,
      revokedAt: args.revokedAt,
      lastSeenAt: args.lastSeenAt,
      ipHash: args.ipHash,
      userAgentHash: args.userAgentHash
    });
    return {
      sessionId: args.sessionId,
      userId: args.userId,
      expiresAt: args.expiresAt,
      lastSeenAt: args.lastSeenAt,
      revokedAt: args.revokedAt
    };
  }
});

export const getBrokerSession = queryGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("broker_sessions")
      .withIndex("by_session_id", (q: any) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session || session.revokedAt || session.expiresAt <= Date.now()) {
      return null;
    }
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt
    };
  }
});

export const touchBrokerSession = mutationGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("broker_sessions")
      .withIndex("by_session_id", (q: any) => q.eq("sessionId", args.sessionId))
      .first();

    if (session && !session.revokedAt && session.expiresAt > Date.now()) {
      await ctx.db.patch(session._id, { lastSeenAt: Date.now() });
    }
    return null;
  }
});

export const revokeBrokerSession = mutationGeneric({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("broker_sessions")
      .withIndex("by_session_id", (q: any) => q.eq("sessionId", args.sessionId))
      .first();

    if (session) {
      await ctx.db.patch(session._id, { revokedAt: Date.now() });
    }
    return null;
  }
});
