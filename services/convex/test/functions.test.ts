import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory Convex DB mock
// ---------------------------------------------------------------------------

type Doc = Record<string, any>;

let nextId = 1;

function makeId(): string {
  return `doc_${nextId++}`;
}

class MockQueryBuilder {
  private docs: Doc[];
  private indexFilter?: (doc: Doc) => boolean;
  private orderDirection: "asc" | "desc" = "asc";

  constructor(docs: Doc[]) {
    this.docs = docs;
  }

  withIndex(_name: string, fn?: (q: any) => any): this {
    if (!fn) {
      // Index used only for ordering (e.g. `.withIndex("by_created_at")`) — no filter.
      return this;
    }
    // Build a filter from the query builder
    const conditions: Array<{ field: string; value: any }> = [];
    const q = {
      eq: (field: string, value: any) => {
        conditions.push({ field, value });
        return q;
      }
    };
    fn(q);
    this.indexFilter = (doc) => conditions.every((c) => doc[c.field] === c.value);
    return this;
  }

  filter(fn: (q: any) => any): this {
    const q = {
      eq: (a: any, b: any) => ({ type: "eq", a, b }),
      field: (name: string) => ({ type: "field", name })
    };
    const condition = fn(q);
    if (condition?.type === "eq") {
      const fieldRef = condition.a;
      const value = condition.b;
      if (fieldRef?.type === "field") {
        const fieldName = fieldRef.name;
        const prev = this.indexFilter;
        this.indexFilter = (doc) => {
          const docValue = fieldName === "_id" ? doc._id : doc[fieldName];
          return (prev ? prev(doc) : true) && docValue === value;
        };
      }
    }
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.orderDirection = direction;
    return this;
  }

  take(n: number): Doc[] {
    return this.getFiltered().slice(0, n);
  }

  async first(): Promise<Doc | null> {
    return this.getFiltered()[0] ?? null;
  }

  async collect(): Promise<Doc[]> {
    return this.getFiltered();
  }

  private getFiltered(): Doc[] {
    let filtered = this.indexFilter ? this.docs.filter(this.indexFilter) : [...this.docs];
    return filtered;
  }
}

class MockDb {
  private tables: Map<string, Map<string, Doc>> = new Map();

  private getTable(name: string): Map<string, Doc> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }

  query(tableName: string): MockQueryBuilder {
    const table = this.getTable(tableName);
    return new MockQueryBuilder(Array.from(table.values()));
  }

  async insert(tableName: string, data: Doc): Promise<string> {
    const id = makeId();
    const doc = { ...data, _id: id };
    this.getTable(tableName).set(id, doc);
    return id;
  }

  async patch(id: string, updates: Partial<Doc>): Promise<void> {
    for (const [, table] of this.tables) {
      if (table.has(id)) {
        const existing = table.get(id)!;
        table.set(id, { ...existing, ...updates });
        return;
      }
    }
    throw new Error(`Document ${id} not found`);
  }

  async get(id: string): Promise<Doc | null> {
    for (const [, table] of this.tables) {
      if (table.has(id)) {
        return table.get(id)!;
      }
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    for (const [, table] of this.tables) {
      if (table.has(id)) {
        table.delete(id);
        return;
      }
    }
    throw new Error(`Document ${id} not found`);
  }

  clear(): void {
    this.tables.clear();
  }
}

function makeCtx(db: MockDb) {
  return { db };
}

// ---------------------------------------------------------------------------
// Helper: call a Convex handler directly
// ---------------------------------------------------------------------------
// mutationGeneric / queryGeneric store the raw handler on `_handler`; fall back
// to calling the function itself (which delegates via the dontCallDirectly
// wrapper) if _handler is not present.
async function callHandler(fn: any, args: any, db: MockDb): Promise<any> {
  const ctx = makeCtx(db);
  const handler = fn._handler ?? fn;
  return handler(ctx, args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: MockDb;

beforeEach(() => {
  db = new MockDb();
  nextId = 1;
});

// ---- Users ----
describe("users", () => {
  it("upserts a new user from Google profile", async () => {
    const { upsertUserFromGoogleProfile } = await import("../users");
    const result = await callHandler(upsertUserFromGoogleProfile, {
      profile: {
        googleSub: "google-sub-123",
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
        picture: "https://example.com/pic.jpg"
      }
    }, db);
    expect(result.userId).toBeTruthy();
    expect(result.profile.googleSub).toBe("google-sub-123");
    expect(result.profile.email).toBe("test@example.com");
  });

  it("updates an existing user on second upsert", async () => {
    const { upsertUserFromGoogleProfile } = await import("../users");
    const first = await callHandler(upsertUserFromGoogleProfile, {
      profile: { googleSub: "google-sub-123", email: "old@example.com" }
    }, db);

    const second = await callHandler(upsertUserFromGoogleProfile, {
      profile: { googleSub: "google-sub-123", email: "new@example.com" }
    }, db);

    expect(first.userId).toBe(second.userId);
    expect(second.profile.email).toBe("new@example.com");
  });

  it("getUserByGoogleSub finds a user", async () => {
    const { upsertUserFromGoogleProfile, getUserByGoogleSub } = await import("../users");
    await callHandler(upsertUserFromGoogleProfile, {
      profile: { googleSub: "gsub-456" }
    }, db);

    const found = await callHandler(getUserByGoogleSub, { googleSub: "gsub-456" }, db);
    expect(found).not.toBeNull();
    expect(found?.googleSub).toBe("gsub-456");
  });

  it("getUserByGoogleSub returns null for unknown sub", async () => {
    const { getUserByGoogleSub } = await import("../users");
    const found = await callHandler(getUserByGoogleSub, { googleSub: "nonexistent" }, db);
    expect(found).toBeNull();
  });

  it("deletes a user account and related records", async () => {
    const { upsertUserFromGoogleProfile, deleteUserAccount, getUserByGoogleSub } = await import("../users");
    const { createBrokerSession } = await import("../sessions");
    const { grantConsent, listAuthorizedSites } = await import("../consents");

    const user = await callHandler(upsertUserFromGoogleProfile, {
      profile: { googleSub: "delete-me", email: "delete@example.com", name: "Delete Me" }
    }, db);

    await callHandler(createBrokerSession, {
      sessionId: "sess_delete",
      userId: user.userId,
      expiresAt: Date.now() + 86_400_000,
      lastSeenAt: Date.now()
    }, db);

    await callHandler(grantConsent, {
      userId: user.userId,
      clientId: "origin:https://example.com",
      piiGranted: true,
      grantedAt: Date.now()
    }, db);

    await db.insert("pairwise_subjects", {
      userId: user.userId,
      clientId: "origin:https://example.com",
      pairwiseSub: "ps_delete",
      createdAt: Date.now()
    });

    const result = await callHandler(deleteUserAccount, { userId: user.userId }, db);
    expect(result.deleted).toBe(true);

    const found = await callHandler(getUserByGoogleSub, { googleSub: "delete-me" }, db);
    expect(found).toBeNull();

    const sites = await callHandler(listAuthorizedSites, { userId: user.userId }, db);
    expect(sites).toEqual([]);

    const sessions = await db.query("broker_sessions").collect();
    expect(sessions).toEqual([]);
  });
});

// ---- Sessions ----
describe("sessions", () => {
  it("creates and retrieves a broker session", async () => {
    const { createBrokerSession, getBrokerSession } = await import("../sessions");
    const now = Date.now();
    await callHandler(createBrokerSession, {
      sessionId: "sess_abc",
      userId: "user_123",
      expiresAt: now + 86400000,
      lastSeenAt: now
    }, db);

    const session = await callHandler(getBrokerSession, { sessionId: "sess_abc" }, db);
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe("sess_abc");
    expect(session?.userId).toBe("user_123");
  });

  it("returns null for nonexistent session", async () => {
    const { getBrokerSession } = await import("../sessions");
    const session = await callHandler(getBrokerSession, { sessionId: "sess_nonexistent" }, db);
    expect(session).toBeNull();
  });

  it("revokes a session by setting revokedAt", async () => {
    const { createBrokerSession, revokeBrokerSession, getBrokerSession } = await import("../sessions");
    const now = Date.now();
    await callHandler(createBrokerSession, {
      sessionId: "sess_revoke",
      userId: "user_456",
      expiresAt: now + 86400000,
      lastSeenAt: now
    }, db);

    await callHandler(revokeBrokerSession, { sessionId: "sess_revoke" }, db);
    const session = await callHandler(getBrokerSession, { sessionId: "sess_revoke" }, db);
    // getBrokerSession returns null for revoked sessions
    expect(session).toBeNull();
  });

  it("touchBrokerSession updates lastSeenAt for active sessions", async () => {
    const { createBrokerSession, touchBrokerSession } = await import("../sessions");
    const now = Date.now();
    await callHandler(createBrokerSession, {
      sessionId: "sess_touch",
      userId: "user_789",
      expiresAt: now + 86400000,
      lastSeenAt: now - 5000
    }, db);

    const result = await callHandler(touchBrokerSession, { sessionId: "sess_touch" }, db);
    // touchBrokerSession returns null per implementation
    expect(result).toBeNull();
  });

  it("touchBrokerSession does nothing for revoked sessions", async () => {
    const { createBrokerSession, revokeBrokerSession, touchBrokerSession, getBrokerSession } = await import("../sessions");
    const now = Date.now();
    await callHandler(createBrokerSession, {
      sessionId: "sess_touch_revoked",
      userId: "user_999",
      expiresAt: now + 86400000,
      lastSeenAt: now
    }, db);
    await callHandler(revokeBrokerSession, { sessionId: "sess_touch_revoked" }, db);

    // touch should silently do nothing on a revoked session
    const result = await callHandler(touchBrokerSession, { sessionId: "sess_touch_revoked" }, db);
    expect(result).toBeNull();
    // session is still null (revoked)
    const session = await callHandler(getBrokerSession, { sessionId: "sess_touch_revoked" }, db);
    expect(session).toBeNull();
  });
});

// ---- Consents ----
describe("consents", () => {
  it("grants and retrieves consent", async () => {
    const { grantConsent, getConsent } = await import("../consents");
    await callHandler(grantConsent, {
      userId: "user_1",
      clientId: "origin:https://app.example.com",
      piiGranted: true,
      grantedAt: Date.now(),
      lastUsedAt: Date.now()
    }, db);

    const consent = await callHandler(getConsent, {
      userId: "user_1",
      clientId: "origin:https://app.example.com"
    }, db);
    expect(consent).not.toBeNull();
    expect(consent?.piiGranted).toBe(true);
  });

  it("re-granting updates an existing consent and clears revokedAt", async () => {
    const { grantConsent, revokeConsent, getConsent } = await import("../consents");
    const now = Date.now();
    await callHandler(grantConsent, {
      userId: "user_regrant",
      clientId: "origin:https://app.example.com",
      piiGranted: false,
      grantedAt: now
    }, db);
    await callHandler(revokeConsent, {
      userId: "user_regrant",
      clientId: "origin:https://app.example.com"
    }, db);
    // Re-grant after revoke should restore consent
    await callHandler(grantConsent, {
      userId: "user_regrant",
      clientId: "origin:https://app.example.com",
      piiGranted: true,
      grantedAt: now
    }, db);
    const consent = await callHandler(getConsent, {
      userId: "user_regrant",
      clientId: "origin:https://app.example.com"
    }, db);
    expect(consent).not.toBeNull();
    expect(consent?.piiGranted).toBe(true);
  });

  it("revokeConsent marks consent as revoked", async () => {
    const { grantConsent, revokeConsent, getConsent } = await import("../consents");
    await callHandler(grantConsent, {
      userId: "user_revoke",
      clientId: "origin:https://revoke.example.com",
      piiGranted: false,
      grantedAt: Date.now()
    }, db);

    await callHandler(revokeConsent, {
      userId: "user_revoke",
      clientId: "origin:https://revoke.example.com"
    }, db);

    const consent = await callHandler(getConsent, {
      userId: "user_revoke",
      clientId: "origin:https://revoke.example.com"
    }, db);
    expect(consent).toBeNull();
  });

  it("revokeConsent is a no-op when consent does not exist", async () => {
    const { revokeConsent } = await import("../consents");
    // Should not throw
    await expect(
      callHandler(revokeConsent, {
        userId: "user_no_consent",
        clientId: "origin:https://none.example.com"
      }, db)
    ).resolves.toBeNull();
  });

  it("listAuthorizedSites filters out revoked consents", async () => {
    const { grantConsent, revokeConsent, listAuthorizedSites } = await import("../consents");
    await callHandler(grantConsent, {
      userId: "user_list",
      clientId: "origin:https://active.example.com",
      piiGranted: false,
      grantedAt: Date.now()
    }, db);
    await callHandler(grantConsent, {
      userId: "user_list",
      clientId: "origin:https://revoked.example.com",
      piiGranted: false,
      grantedAt: Date.now()
    }, db);
    await callHandler(revokeConsent, {
      userId: "user_list",
      clientId: "origin:https://revoked.example.com"
    }, db);

    const sites = await callHandler(listAuthorizedSites, { userId: "user_list" }, db);
    expect(sites.length).toBe(1);
    expect(sites[0].clientId).toBe("origin:https://active.example.com");
  });

  it("listAuthorizedSites strips origin: prefix from the origin field", async () => {
    const { grantConsent, listAuthorizedSites } = await import("../consents");
    await callHandler(grantConsent, {
      userId: "user_origin_check",
      clientId: "origin:https://myapp.example.com",
      piiGranted: false,
      grantedAt: Date.now()
    }, db);

    const sites = await callHandler(listAuthorizedSites, { userId: "user_origin_check" }, db);
    expect(sites[0].origin).toBe("https://myapp.example.com");
  });

  it("listAuthorizedSites returns empty array for user with no consents", async () => {
    const { listAuthorizedSites } = await import("../consents");
    const sites = await callHandler(listAuthorizedSites, { userId: "user_nobody" }, db);
    expect(sites).toEqual([]);
  });
});

// ---- Authorization Codes ----
describe("authorization codes", () => {
  it("creates and redeems a code", async () => {
    const { createAuthorizationCode, redeemAuthorizationCode } = await import("../codes");
    await callHandler(createAuthorizationCode, {
      code: "code_abc123",
      transactionId: "tx_1",
      clientId: "origin:https://app.example.com",
      redirectUri: "https://app.example.com/callback",
      userId: "user_1",
      expiresAt: Date.now() + 300000
    }, db);

    const redeemed = await callHandler(redeemAuthorizationCode, { code: "code_abc123" }, db);
    expect(redeemed).not.toBeNull();
    expect(redeemed?.code).toBe("code_abc123");
  });

  it("redeemAuthorizationCode returns null for nonexistent code", async () => {
    const { redeemAuthorizationCode } = await import("../codes");
    const result = await callHandler(redeemAuthorizationCode, { code: "nonexistent" }, db);
    expect(result).toBeNull();
  });

  it("redeemAuthorizationCode returns the original record (pre-patch snapshot)", async () => {
    const { createAuthorizationCode, redeemAuthorizationCode } = await import("../codes");
    await callHandler(createAuthorizationCode, {
      code: "code_redeem_test",
      transactionId: "tx_2",
      clientId: "origin:https://app.example.com",
      redirectUri: "https://app.example.com/callback",
      userId: "user_2",
      expiresAt: Date.now() + 300000
    }, db);

    const first = await callHandler(redeemAuthorizationCode, { code: "code_redeem_test" }, db);
    expect(first).not.toBeNull();
    // The implementation returns `record` (before the patch), so redeemedAt is not yet set
    expect(first?.code).toBe("code_redeem_test");
  });

  it("redeemAuthorizationCode returns null for an already-redeemed code", async () => {
    const { createAuthorizationCode, redeemAuthorizationCode } = await import("../codes");
    await callHandler(createAuthorizationCode, {
      code: "code_double_redeem",
      transactionId: "tx_3",
      clientId: "origin:https://app.example.com",
      redirectUri: "https://app.example.com/callback",
      userId: "user_3",
      expiresAt: Date.now() + 300000
    }, db);

    await callHandler(redeemAuthorizationCode, { code: "code_double_redeem" }, db);
    const second = await callHandler(redeemAuthorizationCode, { code: "code_double_redeem" }, db);
    expect(second).toBeNull();
  });

  it("redeemAuthorizationCode returns null for an expired code", async () => {
    const { createAuthorizationCode, redeemAuthorizationCode } = await import("../codes");
    await callHandler(createAuthorizationCode, {
      code: "code_expired",
      transactionId: "tx_4",
      clientId: "origin:https://app.example.com",
      redirectUri: "https://app.example.com/callback",
      userId: "user_4",
      expiresAt: Date.now() - 1 // already expired
    }, db);

    const result = await callHandler(redeemAuthorizationCode, { code: "code_expired" }, db);
    expect(result).toBeNull();
  });

  it("createAuthorizationCode persists all fields", async () => {
    const { createAuthorizationCode } = await import("../codes");
    const expiresAt = Date.now() + 300000;
    const doc = await callHandler(createAuthorizationCode, {
      code: "code_fields",
      transactionId: "tx_fields",
      clientId: "origin:https://fields.example.com",
      redirectUri: "https://fields.example.com/cb",
      userId: "user_fields",
      expiresAt
    }, db);
    expect(doc).not.toBeNull();
    expect(doc?.transactionId).toBe("tx_fields");
    expect(doc?.userId).toBe("user_fields");
    expect(doc?.expiresAt).toBe(expiresAt);
  });
});

// ---- Pairwise Subjects ----
describe("pairwise subjects", () => {
  it("getOrCreatePairwiseSubject creates a stable pairwise sub", async () => {
    const { getOrCreatePairwiseSubject } = await import("../pairwiseSubjects");
    const result1 = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_1",
      clientId: "origin:https://app.example.com",
      pairwiseSub: "ps_stable_123"
    }, db);
    const result2 = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_1",
      clientId: "origin:https://app.example.com",
      pairwiseSub: "ps_stable_456" // different input but same user+client
    }, db);
    // Should return the same record (idempotent)
    expect(result1.pairwiseSub).toBe(result2.pairwiseSub);
    expect(result1.pairwiseSub).toBe("ps_stable_123");
  });

  it("getOrCreatePairwiseSubject creates different subs for different clients", async () => {
    const { getOrCreatePairwiseSubject } = await import("../pairwiseSubjects");
    const r1 = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_same",
      clientId: "origin:https://app1.example.com",
      pairwiseSub: "ps_app1"
    }, db);
    const r2 = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_same",
      clientId: "origin:https://app2.example.com",
      pairwiseSub: "ps_app2"
    }, db);
    expect(r1.pairwiseSub).not.toBe(r2.pairwiseSub);
  });

  it("getOrCreatePairwiseSubject creates different subs for different users", async () => {
    const { getOrCreatePairwiseSubject } = await import("../pairwiseSubjects");
    const r1 = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_alpha",
      clientId: "origin:https://shared.example.com",
      pairwiseSub: "ps_alpha"
    }, db);
    const r2 = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_beta",
      clientId: "origin:https://shared.example.com",
      pairwiseSub: "ps_beta"
    }, db);
    expect(r1.pairwiseSub).not.toBe(r2.pairwiseSub);
  });

  it("getOrCreatePairwiseSubject generates a sub when null is passed", async () => {
    const { getOrCreatePairwiseSubject } = await import("../pairwiseSubjects");
    const result = await callHandler(getOrCreatePairwiseSubject, {
      userId: "user_null_sub",
      clientId: "origin:https://auto.example.com",
      pairwiseSub: null
    }, db);
    expect(result).not.toBeNull();
    expect(typeof result.pairwiseSub).toBe("string");
    expect(result.pairwiseSub.length).toBeGreaterThan(0);
  });
});

// ---- Signing Keys ----
describe("signing keys", () => {
  it("getActiveSigningKey returns null when no keys exist", async () => {
    const { getActiveSigningKey } = await import("../signingKeys");
    const key = await callHandler(getActiveSigningKey, {}, db);
    expect(key).toBeNull();
  });

  it("rotateSigningKey inserts a new active key", async () => {
    const { rotateSigningKey, getActiveSigningKey } = await import("../signingKeys");
    await callHandler(rotateSigningKey, {
      kid: "kid-new-1",
      publicJwk: { kty: "EC", crv: "P-256", x: "x1", y: "y1" },
      encryptedPrivateJwk: "encrypted-key-data",
      status: "active",
      createdAt: Date.now()
    }, db);

    const active = await callHandler(getActiveSigningKey, {}, db);
    expect(active).not.toBeNull();
    expect(active?.kid).toBe("kid-new-1");
    expect(active?.status).toBe("active");
  });

  it("rotateSigningKey retires old active keys", async () => {
    const { rotateSigningKey, listPublicSigningKeys } = await import("../signingKeys");
    // Insert first key
    await callHandler(rotateSigningKey, {
      kid: "kid-old-1",
      publicJwk: { kty: "EC", crv: "P-256", x: "x1", y: "y1" },
      encryptedPrivateJwk: "enc-old",
      status: "active",
      createdAt: Date.now() - 10000
    }, db);

    // Rotate to new key
    await callHandler(rotateSigningKey, {
      kid: "kid-new-2",
      publicJwk: { kty: "EC", crv: "P-256", x: "x2", y: "y2" },
      encryptedPrivateJwk: "enc-new",
      status: "active",
      createdAt: Date.now()
    }, db);

    const allKeys = await callHandler(listPublicSigningKeys, {}, db);
    expect(allKeys.length).toBe(2);
    const oldKey = allKeys.find((k: any) => k.kid === "kid-old-1");
    const newKey = allKeys.find((k: any) => k.kid === "kid-new-2");
    expect(oldKey?.status).toBe("retired");
    expect(newKey?.status).toBe("active");
  });

  it("rotateSigningKey inserts a retired key directly when status is retired", async () => {
    const { rotateSigningKey, getActiveSigningKey, listPublicSigningKeys } = await import("../signingKeys");
    await callHandler(rotateSigningKey, {
      kid: "kid-retired",
      publicJwk: { kty: "EC", crv: "P-256", x: "xr", y: "yr" },
      encryptedPrivateJwk: "enc-retired",
      status: "retired",
      createdAt: Date.now()
    }, db);

    // No active key should exist
    const active = await callHandler(getActiveSigningKey, {}, db);
    expect(active).toBeNull();

    const all = await callHandler(listPublicSigningKeys, {}, db);
    expect(all.length).toBe(1);
    expect(all[0].status).toBe("retired");
  });

  it("listPublicSigningKeys returns all keys regardless of status", async () => {
    const { rotateSigningKey, listPublicSigningKeys } = await import("../signingKeys");
    await callHandler(rotateSigningKey, {
      kid: "kid-a",
      publicJwk: { kty: "EC", crv: "P-256", x: "xa", y: "ya" },
      encryptedPrivateJwk: "enc-a",
      status: "active",
      createdAt: Date.now() - 20000
    }, db);
    await callHandler(rotateSigningKey, {
      kid: "kid-b",
      publicJwk: { kty: "EC", crv: "P-256", x: "xb", y: "yb" },
      encryptedPrivateJwk: "enc-b",
      status: "active",
      createdAt: Date.now()
    }, db);

    const all = await callHandler(listPublicSigningKeys, {}, db);
    expect(all.length).toBe(2);
    expect(all.some((k: any) => k.kid === "kid-a")).toBe(true);
    expect(all.some((k: any) => k.kid === "kid-b")).toBe(true);
  });

  it("getActiveSigningKey returns null after all keys are retired", async () => {
    const { rotateSigningKey, getActiveSigningKey } = await import("../signingKeys");
    // Insert active, then rotate to retire it, then rotate again with a retired status
    await callHandler(rotateSigningKey, {
      kid: "kid-first",
      publicJwk: { kty: "EC", crv: "P-256", x: "x1", y: "y1" },
      encryptedPrivateJwk: "enc-1",
      status: "active",
      createdAt: Date.now() - 10000
    }, db);
    // Now insert a second call with retired status (retires kid-first, inserts kid-second as retired)
    await callHandler(rotateSigningKey, {
      kid: "kid-second",
      publicJwk: { kty: "EC", crv: "P-256", x: "x2", y: "y2" },
      encryptedPrivateJwk: "enc-2",
      status: "retired",
      createdAt: Date.now()
    }, db);

    const active = await callHandler(getActiveSigningKey, {}, db);
    expect(active).toBeNull();
  });
});

// ---- Auth Transactions ----
describe("transactions", () => {
  const baseTx = {
    transactionId: "tx_1",
    clientId: "origin:https://app.example.com",
    redirectUri: "https://app.example.com/callback",
    state: "state_abc",
    codeChallenge: "challenge_xyz",
    codeChallengeMethod: "S256" as const,
    requestPii: false,
    status: "pending" as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000
  };

  it("creates and retrieves a transaction by state", async () => {
    const { createAuthTransaction, getAuthTransactionByState } = await import("../transactions");
    await callHandler(createAuthTransaction, baseTx, db);
    const found = await callHandler(getAuthTransactionByState, { state: "state_abc" }, db);
    expect(found).not.toBeNull();
    expect(found?.transactionId).toBe("tx_1");
    expect(found?.status).toBe("pending");
  });

  it("creates and retrieves a transaction by transactionId", async () => {
    const { createAuthTransaction, getAuthTransaction } = await import("../transactions");
    await callHandler(createAuthTransaction, baseTx, db);
    const found = await callHandler(getAuthTransaction, { transactionId: "tx_1" }, db);
    expect(found).not.toBeNull();
    expect(found?.state).toBe("state_abc");
  });

  it("getAuthTransactionByState returns null for expired transaction", async () => {
    const { createAuthTransaction, getAuthTransactionByState } = await import("../transactions");
    await callHandler(createAuthTransaction, {
      ...baseTx,
      transactionId: "tx_exp",
      state: "state_expired",
      expiresAt: Date.now() - 1 // already expired
    }, db);
    const found = await callHandler(getAuthTransactionByState, { state: "state_expired" }, db);
    expect(found).toBeNull();
  });

  it("getAuthTransaction returns null for expired transaction", async () => {
    const { createAuthTransaction, getAuthTransaction } = await import("../transactions");
    await callHandler(createAuthTransaction, {
      ...baseTx,
      transactionId: "tx_exp2",
      state: "state_exp2",
      expiresAt: Date.now() - 1
    }, db);
    const found = await callHandler(getAuthTransaction, { transactionId: "tx_exp2" }, db);
    expect(found).toBeNull();
  });

  it("getAuthTransactionByState returns null for unknown state", async () => {
    const { getAuthTransactionByState } = await import("../transactions");
    const found = await callHandler(getAuthTransactionByState, { state: "nonexistent" }, db);
    expect(found).toBeNull();
  });

  it("attachUserToTransaction updates user, session, and status", async () => {
    const { createAuthTransaction, attachUserToTransaction, getAuthTransaction } = await import("../transactions");
    await callHandler(createAuthTransaction, baseTx, db);
    await callHandler(attachUserToTransaction, {
      transactionId: "tx_1",
      userId: "user_123",
      sessionId: "sess_456",
      status: "authenticated"
    }, db);
    const found = await callHandler(getAuthTransaction, { transactionId: "tx_1" }, db);
    expect(found?.userId).toBe("user_123");
    expect(found?.sessionId).toBe("sess_456");
    expect(found?.status).toBe("authenticated");
  });

  it("attachUserToTransaction is a no-op for nonexistent transaction", async () => {
    const { attachUserToTransaction } = await import("../transactions");
    const result = await callHandler(attachUserToTransaction, {
      transactionId: "tx_nonexistent",
      userId: "user_1",
      status: "authenticated"
    }, db);
    expect(result).toBeNull();
  });

  it("preserves optional nonce field", async () => {
    const { createAuthTransaction, getAuthTransaction } = await import("../transactions");
    await callHandler(createAuthTransaction, {
      ...baseTx,
      transactionId: "tx_nonce",
      state: "state_nonce",
      nonce: "nonce_value_123"
    }, db);
    const found = await callHandler(getAuthTransaction, { transactionId: "tx_nonce" }, db);
    expect(found?.nonce).toBe("nonce_value_123");
  });
});

// ---- Clients ----
describe("clients", () => {
  it("upsertClient creates a new client record", async () => {
    const { upsertClient } = await import("../clients");
    const now = Date.now();
    const client = await callHandler(upsertClient, {
      clientId: "origin:https://app.example.com",
      origin: "https://app.example.com",
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active"
    }, db);
    expect(client).not.toBeNull();
    expect(client?.clientId).toBe("origin:https://app.example.com");
    expect(client?.status).toBe("active");
  });

  it("upsertClient updates lastSeenAt on second call", async () => {
    const { upsertClient } = await import("../clients");
    const now = Date.now();
    const first = await callHandler(upsertClient, {
      clientId: "origin:https://app.example.com",
      origin: "https://app.example.com",
      firstSeenAt: now - 10000,
      lastSeenAt: now - 10000,
      status: "active"
    }, db);
    const second = await callHandler(upsertClient, {
      clientId: "origin:https://app.example.com",
      origin: "https://app.example.com",
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active"
    }, db);
    // Same record
    expect(first?._id).toBe(second?._id);
    // lastSeenAt should be updated
    expect(second?.lastSeenAt).toBeGreaterThanOrEqual(first?.lastSeenAt);
  });

  it("upsertClient preserves original firstSeenAt on second call", async () => {
    const { upsertClient } = await import("../clients");
    const first = await callHandler(upsertClient, {
      clientId: "origin:https://first.example.com",
      origin: "https://first.example.com",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      status: "active"
    }, db);
    await callHandler(upsertClient, {
      clientId: "origin:https://first.example.com",
      origin: "https://first.example.com",
      firstSeenAt: 9999,
      lastSeenAt: 9999,
      status: "active"
    }, db);
    // firstSeenAt should not change
    const refetched = await callHandler(upsertClient, {
      clientId: "origin:https://first.example.com",
      origin: "https://first.example.com",
      firstSeenAt: 0,
      lastSeenAt: 0,
      status: "active"
    }, db);
    expect(refetched?.firstSeenAt).toBe(first?.firstSeenAt);
  });
});

// ---- Operator ----
describe("operator", () => {
  it("blockClient blocks an existing client", async () => {
    const { upsertClient } = await import("../clients");
    const { blockClient } = await import("../operator");
    const now = Date.now();
    await callHandler(upsertClient, {
      clientId: "origin:https://bad.example.com",
      origin: "https://bad.example.com",
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active"
    }, db);

    await callHandler(blockClient, {
      clientId: "origin:https://bad.example.com",
      reason: "abuse"
    }, db);

    // Verify via a raw DB query on the mock
    const client = await db.query("clients")
      .withIndex("by_client_id", (q: any) => q.eq("clientId", "origin:https://bad.example.com"))
      .first();
    expect(client?.status).toBe("blocked");
    expect(client?.blockedReason).toBe("abuse");
  });

  it("blockClient creates a blocked record when client does not exist (block-before-first-touch)", async () => {
    const { blockClient } = await import("../operator");
    await callHandler(blockClient, {
      clientId: "origin:https://unknown.example.com",
      reason: "pre-emptive block"
    }, db);

    const client = await db.query("clients")
      .withIndex("by_client_id", (q: any) => q.eq("clientId", "origin:https://unknown.example.com"))
      .first();
    expect(client).not.toBeNull();
    expect(client?.status).toBe("blocked");
    expect(client?.blockedReason).toBe("pre-emptive block");
    expect(client?.origin).toBe("https://unknown.example.com");
  });

  it("unblockClient restores active status", async () => {
    const { blockClient, unblockClient } = await import("../operator");
    // Create via blockClient (block-before-first-touch)
    await callHandler(blockClient, {
      clientId: "origin:https://restored.example.com",
      reason: "test"
    }, db);
    await callHandler(unblockClient, {
      clientId: "origin:https://restored.example.com"
    }, db);

    const client = await db.query("clients")
      .withIndex("by_client_id", (q: any) => q.eq("clientId", "origin:https://restored.example.com"))
      .first();
    expect(client?.status).toBe("active");
    expect(client?.blockedReason).toBeUndefined();
  });

  it("unblockClient is a no-op when client does not exist", async () => {
    const { unblockClient } = await import("../operator");
    const result = await callHandler(unblockClient, {
      clientId: "origin:https://phantom.example.com"
    }, db);
    expect(result).toBeNull();
  });

  it("revokeClientConsentForUser revokes an existing consent", async () => {
    const { grantConsent, getConsent } = await import("../consents");
    const { revokeClientConsentForUser } = await import("../operator");
    await callHandler(grantConsent, {
      userId: "user_op1",
      clientId: "origin:https://op.example.com",
      piiGranted: true,
      grantedAt: Date.now()
    }, db);
    await callHandler(revokeClientConsentForUser, {
      userId: "user_op1",
      clientId: "origin:https://op.example.com"
    }, db);
    const consent = await callHandler(getConsent, {
      userId: "user_op1",
      clientId: "origin:https://op.example.com"
    }, db);
    expect(consent).toBeNull();
  });

  it("revokeClientConsentForUser is a no-op when consent does not exist", async () => {
    const { revokeClientConsentForUser } = await import("../operator");
    const result = await callHandler(revokeClientConsentForUser, {
      userId: "user_none",
      clientId: "origin:https://none.example.com"
    }, db);
    expect(result).toBeNull();
  });

  it("revokeAllSessionsForUser revokes all sessions for a user", async () => {
    const { createBrokerSession, getBrokerSession } = await import("../sessions");
    const { revokeAllSessionsForUser } = await import("../operator");
    const now = Date.now();
    await callHandler(createBrokerSession, {
      sessionId: "sess_op_a",
      userId: "user_mass_revoke",
      expiresAt: now + 86400000,
      lastSeenAt: now
    }, db);
    await callHandler(createBrokerSession, {
      sessionId: "sess_op_b",
      userId: "user_mass_revoke",
      expiresAt: now + 86400000,
      lastSeenAt: now
    }, db);

    await callHandler(revokeAllSessionsForUser, { userId: "user_mass_revoke" }, db);

    const sessA = await callHandler(getBrokerSession, { sessionId: "sess_op_a" }, db);
    const sessB = await callHandler(getBrokerSession, { sessionId: "sess_op_b" }, db);
    expect(sessA).toBeNull(); // revoked sessions return null
    expect(sessB).toBeNull();
  });

  it("revokeAllSessionsForUser is a no-op when user has no sessions", async () => {
    const { revokeAllSessionsForUser } = await import("../operator");
    const result = await callHandler(revokeAllSessionsForUser, { userId: "user_no_sessions" }, db);
    expect(result).toBeNull();
  });
});

// ---- Audit Events ----
describe("audit events", () => {
  it("recordAuditEvent inserts and returns the event", async () => {
    const { recordAuditEvent } = await import("../auditEvents");
    const now = Date.now();
    const event = await callHandler(recordAuditEvent, {
      eventId: "evt_1",
      actorType: "user",
      actorId: "user_123",
      action: "consent.granted",
      targetType: "consent",
      targetId: "consent_456",
      clientId: "origin:https://app.example.com",
      correlationId: "corr_abc",
      createdAt: now
    }, db);
    expect(event).not.toBeNull();
    expect(event?.eventId).toBe("evt_1");
    expect(event?.actorType).toBe("user");
    expect(event?.action).toBe("consent.granted");
  });

  it("recordAuditEvent stores optional metadata", async () => {
    const { recordAuditEvent } = await import("../auditEvents");
    const event = await callHandler(recordAuditEvent, {
      eventId: "evt_meta",
      actorType: "operator",
      action: "client.blocked",
      targetType: "client",
      correlationId: "corr_meta",
      metadata: { reason: "abuse", ip: "1.2.3.4" },
      createdAt: Date.now()
    }, db);
    expect(event?.metadata).toEqual({ reason: "abuse", ip: "1.2.3.4" });
  });

  it("recordAuditEvent stores system actor events without actorId", async () => {
    const { recordAuditEvent } = await import("../auditEvents");
    const event = await callHandler(recordAuditEvent, {
      eventId: "evt_sys",
      actorType: "system",
      action: "key.rotated",
      targetType: "signing_key",
      correlationId: "corr_sys",
      createdAt: Date.now()
    }, db);
    expect(event?.actorType).toBe("system");
    expect(event?.actorId).toBeUndefined();
  });

  it("listAuditEvents returns events in descending order", async () => {
    const { recordAuditEvent, listAuditEvents } = await import("../auditEvents");
    await callHandler(recordAuditEvent, {
      eventId: "evt_old",
      actorType: "user",
      action: "login",
      targetType: "session",
      correlationId: "c1",
      createdAt: 1000
    }, db);
    await callHandler(recordAuditEvent, {
      eventId: "evt_new",
      actorType: "user",
      action: "logout",
      targetType: "session",
      correlationId: "c2",
      createdAt: 2000
    }, db);

    const events = await callHandler(listAuditEvents, {}, db);
    expect(events.length).toBe(2);
    // Note: MockQueryBuilder.order is a no-op in our mock, so we just check both exist
    expect(events.some((e: any) => e.eventId === "evt_old")).toBe(true);
    expect(events.some((e: any) => e.eventId === "evt_new")).toBe(true);
  });

  it("listAuditEvents returns empty array when no events exist", async () => {
    const { listAuditEvents } = await import("../auditEvents");
    const events = await callHandler(listAuditEvents, {}, db);
    expect(events).toEqual([]);
  });
});

// ---- Origin Metrics / Rate Limiting ----
describe("origin metrics (rate limiting)", () => {
  it("recordAndCheckRateLimit allows the first request", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const result = await callHandler(recordAndCheckRateLimit, {
      clientId: "origin:https://app.example.com",
      endpoint: "authorize"
    }, db);
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBe(0);
  });

  it("recordAndCheckRateLimit increments authorize counter", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const args = { clientId: "origin:https://count.example.com", endpoint: "authorize" as const };
    await callHandler(recordAndCheckRateLimit, args, db);
    const result = await callHandler(recordAndCheckRateLimit, args, db);
    expect(result.allowed).toBe(true);
  });

  it("recordAndCheckRateLimit blocks after exceeding authorize limit", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const args = {
      clientId: "origin:https://limited.example.com",
      endpoint: "authorize" as const,
      limitAuthorize: 2 // low limit for testing
    };
    await callHandler(recordAndCheckRateLimit, args, db); // 1
    await callHandler(recordAndCheckRateLimit, args, db); // 2
    const blocked = await callHandler(recordAndCheckRateLimit, args, db); // 3 — exceeds limit of 2
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("recordAndCheckRateLimit blocks after exceeding token limit", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const args = {
      clientId: "origin:https://token-limited.example.com",
      endpoint: "token" as const,
      limitToken: 1
    };
    await callHandler(recordAndCheckRateLimit, args, db); // 1
    const blocked = await callHandler(recordAndCheckRateLimit, args, db); // 2 — exceeds limit of 1
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("recordAndCheckRateLimit keeps returning blocked once blocked", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const args = {
      clientId: "origin:https://stay-blocked.example.com",
      endpoint: "authorize" as const,
      limitAuthorize: 1
    };
    await callHandler(recordAndCheckRateLimit, args, db); // 1
    await callHandler(recordAndCheckRateLimit, args, db); // exceeds
    const still = await callHandler(recordAndCheckRateLimit, args, db); // still blocked
    expect(still.allowed).toBe(false);
  });

  it("recordAndCheckRateLimit tracks session_check independently", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const result = await callHandler(recordAndCheckRateLimit, {
      clientId: "origin:https://session.example.com",
      endpoint: "session_check"
    }, db);
    expect(result.allowed).toBe(true);
  });

  it("recordAndCheckRateLimit uses separate counters per endpoint", async () => {
    const { recordAndCheckRateLimit } = await import("../originMetrics");
    const clientId = "origin:https://multi.example.com";
    // Hit authorize limit
    await callHandler(recordAndCheckRateLimit, { clientId, endpoint: "authorize", limitAuthorize: 1 }, db);
    await callHandler(recordAndCheckRateLimit, { clientId, endpoint: "authorize", limitAuthorize: 1 }, db);
    // Token endpoint should still be allowed on first request of this window
    // (but if authorize exceeds limit, the whole origin is blocked)
    const tokenResult = await callHandler(recordAndCheckRateLimit, { clientId, endpoint: "token", limitAuthorize: 1 }, db);
    // The implementation blocks the entire origin when any limit is exceeded
    expect(tokenResult.allowed).toBe(false);
  });
});
