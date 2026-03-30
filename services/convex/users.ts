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
