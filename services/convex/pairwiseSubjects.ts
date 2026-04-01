import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getPairwiseByUserAndClient = queryGeneric({
  args: {
    userId: v.string(),
    clientId: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pairwise_subjects")
      .withIndex("by_user_id_client_id", (q: any) =>
        q.eq("userId", args.userId).eq("clientId", args.clientId)
      )
      .first();
  }
});

export const getOrCreatePairwiseSubject = mutationGeneric({
  args: {
    userId: v.string(),
    clientId: v.string(),
    pairwiseSub: v.union(v.string(), v.null()),
    createdAt: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pairwise_subjects")
      .withIndex("by_user_id_client_id", (q: any) =>
        q.eq("userId", args.userId).eq("clientId", args.clientId)
      )
      .first();

    if (existing) {
      return existing;
    }

    const now = args.createdAt ?? Date.now();
    const pairwiseSub = args.pairwiseSub ?? `ps_${crypto.randomUUID()}`;

    const id = await ctx.db.insert("pairwise_subjects", {
      userId: args.userId,
      clientId: args.clientId,
      pairwiseSub,
      createdAt: now
    });

    return await ctx.db.get(id);
  }
});
