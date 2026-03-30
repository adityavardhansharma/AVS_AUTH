import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getConsent = queryGeneric({
  args: { userId: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const consent = await ctx.db
      .query("consents")
      .withIndex("by_user_id_client_id", (q: any) =>
        q.eq("userId", args.userId).eq("clientId", args.clientId)
      )
      .first();

    return consent && !consent.revokedAt ? consent : null;
  }
});

export const grantConsent = mutationGeneric({
  args: {
    userId: v.string(),
    clientId: v.string(),
    piiGranted: v.boolean(),
    grantedAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("consents")
      .withIndex("by_user_id_client_id", (q: any) =>
        q.eq("userId", args.userId).eq("clientId", args.clientId)
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        piiGranted: args.piiGranted,
        grantedAt: args.grantedAt || now,
        revokedAt: undefined,
        lastUsedAt: args.lastUsedAt ?? now
      });
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("consents", {
      userId: args.userId,
      clientId: args.clientId,
      piiGranted: args.piiGranted,
      grantedAt: args.grantedAt || now,
      revokedAt: undefined,
      lastUsedAt: args.lastUsedAt ?? now
    });
    return await ctx.db.get(id);
  }
});

export const revokeConsent = mutationGeneric({
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

export const listAuthorizedSites = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const consents = await ctx.db
      .query("consents")
      .withIndex("by_user_id", (q: any) => q.eq("userId", args.userId))
      .collect();

    return consents
      .filter((consent: any) => !consent.revokedAt)
      .map((consent: any) => ({
        clientId: consent.clientId,
        origin: consent.clientId.replace(/^origin:/, ""),
        piiGranted: consent.piiGranted,
        grantedAt: consent.grantedAt,
        lastUsedAt: consent.lastUsedAt
      }));
  }
});
