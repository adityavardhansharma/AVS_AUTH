import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const transactionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("authenticated"),
  v.literal("completed"),
  v.literal("denied"),
  v.literal("expired")
);

export const createAuthTransaction = mutationGeneric({
  args: {
    transactionId: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    state: v.string(),
    nonce: v.optional(v.string()),
    codeChallenge: v.string(),
    codeChallengeMethod: v.literal("S256"),
    requestPii: v.boolean(),
    userId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    status: transactionStatusValidator,
    createdAt: v.number(),
    expiresAt: v.number()
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("auth_transactions", {
      transactionId: args.transactionId,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      state: args.state,
      nonce: args.nonce,
      codeChallenge: args.codeChallenge,
      codeChallengeMethod: args.codeChallengeMethod,
      requestPii: args.requestPii,
      userId: args.userId,
      sessionId: args.sessionId,
      status: args.status,
      createdAt: args.createdAt,
      expiresAt: args.expiresAt
    });
    return await ctx.db.get(id);
  }
});

export const getAuthTransactionByState = queryGeneric({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const tx = await ctx.db
      .query("auth_transactions")
      .withIndex("by_state", (q: any) => q.eq("state", args.state))
      .first();

    if (!tx || tx.expiresAt <= Date.now() || tx.status === "expired") {
      return null;
    }
    return tx;
  }
});

export const getAuthTransaction = queryGeneric({
  args: { transactionId: v.string() },
  handler: async (ctx, args) => {
    const tx = await ctx.db
      .query("auth_transactions")
      .withIndex("by_transaction_id", (q: any) => q.eq("transactionId", args.transactionId))
      .first();

    if (!tx || tx.expiresAt <= Date.now() || tx.status === "expired") {
      return null;
    }
    return tx;
  }
});

export const attachUserToTransaction = mutationGeneric({
  args: {
    transactionId: v.string(),
    userId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    status: transactionStatusValidator
  },
  handler: async (ctx, args) => {
    const tx = await ctx.db
      .query("auth_transactions")
      .withIndex("by_transaction_id", (q: any) => q.eq("transactionId", args.transactionId))
      .first();

    if (tx) {
      await ctx.db.patch(tx._id, {
        userId: args.userId,
        sessionId: args.sessionId,
        status: args.status
      });
    }
    return null;
  }
});
