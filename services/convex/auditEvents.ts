import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const recordAuditEvent = mutationGeneric({
  args: {
    eventId: v.string(),
    actorType: v.union(v.literal("user"), v.literal("operator"), v.literal("system")),
    actorId: v.optional(v.string()),
    action: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    correlationId: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number()
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("audit_events", {
      eventId: args.eventId,
      actorType: args.actorType,
      actorId: args.actorId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      clientId: args.clientId,
      correlationId: args.correlationId,
      metadata: args.metadata,
      createdAt: args.createdAt
    });
    return await ctx.db.get(id);
  }
});

export const listAuditEvents = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("audit_events")
      .withIndex("by_created_at")
      .order("desc")
      .take(100);
  }
});
