import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@oboapp/db";
import { createFacebookConnectStore, FacebookConnectStoreError } from "./store";
import type { FacebookConnectionRecord, FacebookOAuthSession } from "./types";

function database() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    insertOne: vi.fn().mockResolvedValue("id"),
    createOne: vi.fn().mockResolvedValue("id"),
    updateOne: vi.fn().mockResolvedValue(undefined),
    compareAndUpdate: vi.fn().mockResolvedValue(true),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(2),
    batchWrite: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  } satisfies DbClient;
}

function session(): FacebookOAuthSession {
  return {
    id: "session-id",
    browserHash: "browser-hash",
    expiresAt: 1800000,
    phase: "authorizing",
    userTokenCipher: null,
    userHash: null,
    pages: [],
    pageName: null,
    connectionId: null,
  };
}

function connection(): FacebookConnectionRecord {
  return {
    id: "connection-id",
    pageId: "101",
    pageName: "Район Оборище",
    userHash: "user-hash",
    secretVersion: "projects/demo-project/secrets/facebook-tokens/versions/1",
    createdAt: 1234,
    status: "pending_review",
    collectionEnabled: false,
  };
}

describe("Facebook connection metadata storage", () => {
  it("creates an isolated session with empty credential and Page state", async () => {
    const client = database();
    await createFacebookConnectStore(client).createSession("session-id", {
      browserHash: "browser-hash",
      expiresAt: 1800000,
    });
    expect(client.createOne).toHaveBeenCalledWith("facebookOAuthSessions", {
      ...session(), expireTime: new Date(1800000),
    }, "session-id");
  });

  it("reads a known session while removing the adapter document identifier", async () => {
    const client = database();
    client.findOne.mockResolvedValue({ ...session(), _id: "session-id", expireTime: new Date(1800000) });
    const store = createFacebookConnectStore(client);
    expect(await store.getSession("session-id")).toEqual(session());
    client.findOne.mockResolvedValue(null);
    expect(await store.getSession("missing")).toBeNull();
  });

  it("rejects malformed stored sessions and mismatched identity without exposing data", async () => {
    const client = database();
    client.findOne.mockResolvedValue({ ...session(), id: "different", accessToken: "never-log-this" });
    await expect(createFacebookConnectStore(client).getSession("session-id"))
      .rejects.toMatchObject({ code: "invalid_record", message: "Facebook connection storage failed" });
  });

  it("rejects document paths before accessing the database", async () => {
    const client = database();
    await expect(createFacebookConnectStore(client).getSession("session/child/document"))
      .rejects.toMatchObject({ code: "invalid_record" });
    expect(client.findOne).not.toHaveBeenCalled();
  });

  it("claims phase transitions atomically and returns a stale claim as false", async () => {
    const client = database();
    client.compareAndUpdate.mockResolvedValueOnce(true).mockResolvedValue(false);
    const store = createFacebookConnectStore(client);
    expect(await store.transitionSession("session-id", "authorizing", "exchanging")).toBe(true);
    expect(await store.transitionSession("session-id", "authorizing", "exchanging")).toBe(false);
    expect(client.compareAndUpdate).toHaveBeenCalledWith(
      "facebookOAuthSessions", "session-id", "phase", "authorizing", { phase: "exchanging" },
    );
    expect(client.updateOne).not.toHaveBeenCalled();
  });

  it("fails closed when the database lacks atomic conditional updates", async () => {
    const client = database();
    const { compareAndUpdate: _atomic, ...unsupported } = client;
    await expect(createFacebookConnectStore(unsupported).transitionSession("session-id", "authorizing", "exchanging"))
      .rejects.toMatchObject({ code: "atomic_unavailable" });
    expect(client.findOne).not.toHaveBeenCalled();
    expect(client.updateOne).not.toHaveBeenCalled();
  });

  it("allows encrypted transient data but rejects immutable session fields", async () => {
    const client = database();
    const store = createFacebookConnectStore(client);
    await store.updateSession("session-id", { userTokenCipher: "encrypted-envelope", userHash: "user-hash" });
    expect(client.updateOne).toHaveBeenCalledWith("facebookOAuthSessions", "session-id", {
      userTokenCipher: "encrypted-envelope", userHash: "user-hash",
    });
    const invalidPatch = { userHash: "user-hash", expiresAt: 9999999 };
    await expect(store.updateSession("session-id", invalidPatch)).rejects.toMatchObject({ code: "invalid_record" });
    expect(client.updateOne).toHaveBeenCalledTimes(1);
  });

  it("creates disabled connections atomically and rejects enabled collection", async () => {
    const client = database();
    const store = createFacebookConnectStore(client);
    await store.createConnection("connection-id", connection());
    expect(client.createOne).toHaveBeenCalledWith("facebookPageConnections", connection(), "connection-id");
    const enabled = { ...connection(), collectionEnabled: true } as unknown as FacebookConnectionRecord;
    await expect(store.createConnection("connection-id", enabled)).rejects.toMatchObject({ code: "invalid_record" });
    await expect(store.createConnection("different", connection())).rejects.toMatchObject({ code: "invalid_record" });
  });

  it("returns only validated user connections and fails at the deletion query limit", async () => {
    const client = database();
    client.findMany.mockResolvedValue([{ ...connection(), _id: "connection-id" }]);
    const store = createFacebookConnectStore(client);
    expect(await store.getConnectionsForUser("user-hash")).toEqual([connection()]);
    expect(client.findMany).toHaveBeenCalledWith("facebookPageConnections", {
      where: [{ field: "userHash", op: "==", value: "user-hash" }], limit: 100,
    });
    client.findMany.mockResolvedValue(Array.from({ length: 100 }, () => connection()));
    await expect(store.getConnectionsForUser("user-hash")).rejects.toMatchObject({ code: "limit_exceeded" });
    expect(client.deleteOne).not.toHaveBeenCalled();
  });

  it("rejects a query result owned by another user", async () => {
    const client = database();
    client.findMany.mockResolvedValue([{ ...connection(), userHash: "different-user" }]);
    await expect(createFacebookConnectStore(client).getConnectionsForUser("user-hash"))
      .rejects.toMatchObject({ code: "invalid_record" });
  });

  it("revokes collection and deletes credentials metadata through the database abstraction", async () => {
    const client = database();
    const store = createFacebookConnectStore(client);
    await store.revokeConnection("connection-id");
    await store.deleteConnection("connection-id");
    expect(await store.deleteSessionsForUser("user-hash")).toBe(2);
    expect(client.updateOne).toHaveBeenCalledWith("facebookPageConnections", "connection-id", {
      status: "revoked", collectionEnabled: false,
    });
    expect(client.deleteOne).toHaveBeenCalledWith("facebookPageConnections", "connection-id");
    expect(client.deleteMany).toHaveBeenCalledWith("facebookOAuthSessions", [
      { field: "userHash", op: "==", value: "user-hash" },
    ]);
  });

  it("stores deletion receipts without user or Page data", async () => {
    const client = database();
    const store = createFacebookConnectStore(client);
    await store.createDeletionReceipt("receipt-id", { completedAt: 1234 });
    expect(client.createOne).toHaveBeenCalledWith("facebookDeletionReceipts", { completedAt: 1234 }, "receipt-id");
    client.findOne.mockResolvedValue({ _id: "receipt-id", completedAt: 1234 });
    expect(await store.getDeletionReceipt("receipt-id")).toEqual({ completedAt: 1234 });
  });

  it("records a monotonic revocation fence with a thirty-minute TTL target", async () => {
    const client = database();
    const store = createFacebookConnectStore(client);
    await store.recordUserRevocation("user-hash", 1000);
    expect(client.createOne).toHaveBeenCalledWith("facebookUserRevocations", {
      userHash: "user-hash", revokedAt: 1000, expiresAt: 1801000, revision: "1000", expireTime: new Date(1801000),
    }, "user-hash");
    client.findOne.mockResolvedValue({ userHash: "user-hash", revokedAt: 1000, expiresAt: 1801000, revision: "1000" });
    expect(await store.getUserRevocation("user-hash")).toBe(1000);
    await store.recordUserRevocation("user-hash", 999);
    expect(client.compareAndUpdate).not.toHaveBeenCalled();
    await store.recordUserRevocation("user-hash", 2000);
    expect(client.compareAndUpdate).toHaveBeenCalledWith("facebookUserRevocations", "user-hash", "revision", "1000", {
      userHash: "user-hash", revokedAt: 2000, expiresAt: 1802000, revision: "2000", expireTime: new Date(1802000),
    });
  });

  it("tracks an existing exact credential as revoked before retrying destruction", async () => {
    const client = database();
    client.createOne.mockRejectedValue(new Error("Already exists"));
    client.findOne.mockResolvedValue(connection());
    await createFacebookConnectStore(client).trackConnectionCleanup("connection-id", connection());
    expect(client.updateOne).toHaveBeenCalledWith("facebookPageConnections", "connection-id", {
      status: "revoked", collectionEnabled: false,
    });
    client.findOne.mockResolvedValue({ ...connection(), secretVersion: "projects/demo-project/secrets/facebook-tokens/versions/2" });
    await expect(createFacebookConnectStore(client).trackConnectionCleanup("connection-id", connection()))
      .rejects.toMatchObject({ code: "invalid_record" });
  });

  it("retains a token-free cleanup intent and restores ordinary expiry after resolution", async () => {
    const client = database();
    client.findOne.mockResolvedValue({ ...session(), phase: "saving", userHash: "user-hash", userTokenCipher: "cipher" });
    const store = createFacebookConnectStore(client);
    await store.setSessionCleanupIntent("session-id", true);
    expect(client.updateOne).toHaveBeenLastCalledWith("facebookOAuthSessions", "session-id", {
      userTokenCipher: null, pages: [], expireTime: null,
    });
    await store.setSessionCleanupIntent("session-id", false);
    expect(client.updateOne).toHaveBeenLastCalledWith("facebookOAuthSessions", "session-id", {
      userTokenCipher: null, pages: [], expireTime: new Date(1800000),
    });
  });

  it("finds failed cleanup intents through a bounded equality query", async () => {
    const client = database();
    client.findMany.mockResolvedValue([{ ...session(), phase: "failed", userHash: "user-hash", connectionId: "connection-id" }]);
    expect(await createFacebookConnectStore(client).getCleanupIntentIdsForUser("user-hash")).toEqual(["connection-id"]);
    expect(client.findMany).toHaveBeenCalledWith("facebookOAuthSessions", {
      where: [{ field: "userHash", op: "==", value: "user-hash" }], limit: 100,
    });
  });

  it("hides database driver errors and credentials", async () => {
    const client = database();
    client.findOne.mockRejectedValue(new Error("mongodb://secret-password@database"));
    try {
      await createFacebookConnectStore(client).getSession("session-id");
      expect.fail("Expected a controlled storage error");
    } catch (error) {
      expect(error).toBeInstanceOf(FacebookConnectStoreError);
      expect(String(error)).not.toContain("secret-password");
      expect(error).not.toHaveProperty("cause");
    }
  });
});

describe("Facebook OAuth start rate limit", () => {
  it("consumes five starts per hashed key and opens a new ten-minute window", async () => {
    const client = database();
    const records = new Map<string, Record<string, unknown>>();
    client.findOne.mockImplementation(async (_collection, id) => records.get(id) ?? null);
    client.createOne.mockImplementation(async (_collection, data, id) => {
      records.set(id, data);
      return id;
    });
    client.compareAndUpdate.mockImplementation(async (_collection, id, field, expected, patch) => {
      const record = records.get(id);
      if (!record || record[field] !== expected) {
        return false;
      }
      records.set(id, { ...record, ...patch });
      return true;
    });
    const store = createFacebookConnectStore(client);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await store.consumeStartLimit("hashed-ip", 1000)).toBe(true);
    }
    expect(await store.consumeStartLimit("hashed-ip", 1000)).toBe(false);
    expect(await store.consumeStartLimit("another-hashed-ip", 1000)).toBe(true);
    expect(await store.consumeStartLimit("hashed-ip", 600000)).toBe(true);
  });

  it("fails closed after bounded contention instead of allowing an extra start", async () => {
    const client = database();
    client.findOne.mockResolvedValue({ key: "hashed-ip", window: 0, count: 1, revision: "1", expiresAt: 600000 });
    client.compareAndUpdate.mockResolvedValue(false);
    expect(await createFacebookConnectStore(client).consumeStartLimit("hashed-ip", 1000)).toBe(false);
    expect(client.compareAndUpdate).toHaveBeenCalledTimes(6);
  });

  it("enforces the same budget across simultaneous atomic create and update claims", async () => {
    const client = database();
    const records = new Map<string, Record<string, unknown>>();
    client.findOne.mockImplementation(async (_collection, id) => records.get(id) ?? null);
    client.createOne.mockImplementation(async (_collection, data, id) => {
      if (records.has(id)) {
        throw Object.assign(new Error("Already exists"), { code: 6 });
      }
      records.set(id, data);
      return id;
    });
    client.compareAndUpdate.mockImplementation(async (_collection, id, field, expected, patch) => {
      const record = records.get(id);
      if (!record || record[field] !== expected) {
        return false;
      }
      records.set(id, { ...record, ...patch });
      return true;
    });
    const store = createFacebookConnectStore(client);
    const results = await Promise.all(Array.from({ length: 10 }, () => store.consumeStartLimit("hashed-ip", 1000)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});
