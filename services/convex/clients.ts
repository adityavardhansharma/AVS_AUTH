import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const upsertClient = mutationGeneric({
  args: {
    clientId: v.string(),
    origin: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    status: v.union(v.literal("active"), v.literal("blocked")),
    blockedReason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_client_id", (q: any) => q.eq("clientId", args.clientId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("clients", {
      clientId: args.clientId,
      origin: args.origin,
      firstSeenAt: args.firstSeenAt,
      lastSeenAt: args.lastSeenAt,
      status: args.status,
      blockedReason: args.blockedReason
    });
    return await ctx.db.get(id);
  }
});
