import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    googleSub: v.string(),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    name: v.optional(v.string()),
    picture: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("blocked"))
  }).index("by_google_sub", ["googleSub"]),
  broker_sessions: defineTable({
    sessionId: v.string(),
    userId: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastSeenAt: v.number(),
    ipHash: v.optional(v.string()),
    userAgentHash: v.optional(v.string())
  }).index("by_session_id", ["sessionId"]).index("by_user_id", ["userId"]),
  clients: defineTable({
    clientId: v.string(),
    origin: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    status: v.union(v.literal("active"), v.literal("blocked")),
    blockedReason: v.optional(v.string())
  }).index("by_client_id", ["clientId"]),
  consents: defineTable({
    userId: v.string(),
    clientId: v.string(),
    piiGranted: v.boolean(),
    grantedAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number())
  }).index("by_user_id_client_id", ["userId", "clientId"]).index("by_user_id", ["userId"]),
  auth_transactions: defineTable({
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
    status: v.union(
      v.literal("pending"),
      v.literal("authenticated"),
      v.literal("completed"),
      v.literal("denied"),
      v.literal("expired")
    ),
    createdAt: v.number(),
    expiresAt: v.number()
  }).index("by_transaction_id", ["transactionId"]).index("by_state", ["state"]),
  authorization_codes: defineTable({
    code: v.string(),
    transactionId: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    userId: v.string(),
    redeemedAt: v.optional(v.number()),
    expiresAt: v.number()
  }).index("by_code", ["code"]),
  pairwise_subjects: defineTable({
    userId: v.string(),
    clientId: v.string(),
    pairwiseSub: v.string(),
    createdAt: v.number()
  }).index("by_user_id_client_id", ["userId", "clientId"]).index("by_pairwise_sub", ["pairwiseSub"]),
  // SENSITIVE TABLE — `encryptedPrivateJwk` currently stores plain JWK JSON
  // (not encrypted despite the field name). Treat as sensitive at rest:
  //   • Convex access rules should restrict reads to internal functions only.
  //   • TODO: wrap value with KMS envelope encryption before insert, decrypt
  //     on read inside the edge-gateway signer. Renaming the field to
  //     `privateJwk` would require a schema migration; keeping the name as a
  //     reminder that encryption is the intended end-state.
  signing_keys: defineTable({
    kid: v.string(),
    publicJwk: v.any(),
    encryptedPrivateJwk: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number())
  }).index("by_kid", ["kid"]).index("by_status", ["status"]),
  audit_events: defineTable({
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
  }).index("by_event_id", ["eventId"]).index("by_created_at", ["createdAt"]),
  origin_metrics: defineTable({
    clientId: v.string(),
    windowStart: v.number(),
    authorizeCount: v.number(),
    tokenCount: v.number(),
    sessionCheckCount: v.number(),
    blockedUntil: v.optional(v.number())
  }).index("by_client_id_window_start", ["clientId", "windowStart"])
});
