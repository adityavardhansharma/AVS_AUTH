import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getUserByGoogleSub = queryGeneric({
  args: { googleSub: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_google_sub", (q: any) => q.eq("googleSub", args.googleSub))
      .first();
  }
});

export const getUserById = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // userId is the Convex document _id string
    return await ctx.db
      .query("users")
      .filter((q: any) => q.eq(q.field("_id"), args.userId))
      .first();
  }
});

export const upsertUserFromGoogleProfile = mutationGeneric({
  args: {
    profile: v.object({
      googleSub: v.string(),
      email: v.optional(v.string()),
      emailVerified: v.optional(v.boolean()),
      name: v.optional(v.string()),
      picture: v.optional(v.string())
    })
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_google_sub", (q: any) => q.eq("googleSub", args.profile.googleSub))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.profile.email,
        emailVerified: args.profile.emailVerified,
        name: args.profile.name,
        picture: args.profile.picture,
        updatedAt: now
      });
      const updated = await ctx.db.get(existing._id);
      return {
        userId: (updated as any)._id.toString(),
        profile: {
          googleSub: (updated as any).googleSub,
          email: (updated as any).email,
          emailVerified: (updated as any).emailVerified,
          name: (updated as any).name,
          picture: (updated as any).picture
        }
      };
    }

    const id = await ctx.db.insert("users", {
      googleSub: args.profile.googleSub,
      email: args.profile.email,
      emailVerified: args.profile.emailVerified,
      name: args.profile.name,
      picture: args.profile.picture,
      createdAt: now,
      updatedAt: now,
      status: "active"
    });

    return {
      userId: id.toString(),
      profile: {
        googleSub: args.profile.googleSub,
        email: args.profile.email,
        emailVerified: args.profile.emailVerified,
        name: args.profile.name,
        picture: args.profile.picture
      }
    };
  }
});

export const deleteUserAccount = mutationGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .filter((q: any) => q.eq(q.field("_id"), args.userId))
      .first();

    if (!user) {
      return { deleted: false };
    }

    const sessions = await ctx.db
      .query("broker_sessions")
      .withIndex("by_user_id", (q: any) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    const consents = await ctx.db
      .query("consents")
      .withIndex("by_user_id", (q: any) => q.eq("userId", args.userId))
      .collect();
    for (const consent of consents) {
      await ctx.db.delete(consent._id);
    }

    const pairwiseSubjects = await ctx.db.query("pairwise_subjects").collect();
    for (const pairwise of pairwiseSubjects) {
      if (pairwise.userId === args.userId) {
        await ctx.db.delete(pairwise._id);
      }
    }

    const transactions = await ctx.db.query("auth_transactions").collect();
    for (const transaction of transactions) {
      if (transaction.userId === args.userId) {
        await ctx.db.delete(transaction._id);
      }
    }

    const codes = await ctx.db.query("authorization_codes").collect();
    for (const code of codes) {
      if (code.userId === args.userId) {
        await ctx.db.delete(code._id);
      }
    }

    await ctx.db.delete(user._id);
    return { deleted: true };
  }
});
