import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

export const createAuthorizationCode = mutationGeneric({
  args: {
    code: v.string(),
    transactionId: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    userId: v.string(),
    redeemedAt: v.optional(v.number()),
    expiresAt: v.number()
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("authorization_codes", {
      code: args.code,
      transactionId: args.transactionId,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      userId: args.userId,
      redeemedAt: args.redeemedAt,
      expiresAt: args.expiresAt
    });
    return await ctx.db.get(id);
  }
});

export const redeemAuthorizationCode = mutationGeneric({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("authorization_codes")
      .withIndex("by_code", (q: any) => q.eq("code", args.code))
      .first();

    if (!record || record.redeemedAt || record.expiresAt <= Date.now()) {
      return null;
    }

    await ctx.db.patch(record._id, { redeemedAt: Date.now() });
    return record;
  }
});
