import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getActiveSigningKey = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("signing_keys")
      .withIndex("by_status", (q: any) => q.eq("status", "active"))
      .first();
  }
});

export const listPublicSigningKeys = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("signing_keys").collect();
  }
});

export const rotateSigningKey = mutationGeneric({
  args: {
    kid: v.string(),
    publicJwk: v.any(),
    encryptedPrivateJwk: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    // Retire all currently active keys
    const activeKeys = await ctx.db
      .query("signing_keys")
      .withIndex("by_status", (q: any) => q.eq("status", "active"))
      .collect();

    const now = Date.now();
    for (const key of activeKeys) {
      await ctx.db.patch(key._id, { status: "retired", rotatedAt: now });
    }

    // Insert the new active key
    const id = await ctx.db.insert("signing_keys", {
      kid: args.kid,
      publicJwk: args.publicJwk,
      encryptedPrivateJwk: args.encryptedPrivateJwk,
      status: args.status,
      createdAt: args.createdAt,
      rotatedAt: args.rotatedAt
    });

    return await ctx.db.get(id);
  }
});
