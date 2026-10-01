import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient } from "./types";
import { MessagesRepository } from "./collections/messages";
import { SourcesRepository } from "./collections/sources";
import { InterestsRepository } from "./collections/interests";
import { NotificationMatchesRepository } from "./collections/notification-matches";
import { NotificationSubscriptionsRepository } from "./collections/notification-subscriptions";
import { GtfsStopsRepository } from "./collections/gtfs-stops";

/** Create a fresh mock DbClient for each test */
function createMockClient(): DbClient {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    insertOne: vi.fn().mockResolvedValue("auto-id"),
    createOne: vi.fn().mockResolvedValue("created-id"),
    updateOne: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(0),
    batchWrite: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── MessagesRepository ───────────────────────────────────────

describe("MessagesRepository", () => {
  let db: DbClient;
  let repo: MessagesRepository;

  beforeEach(() => {
    db = createMockClient();
    repo = new MessagesRepository(db);
  });

  it("findById delegates to findOne with correct collection", async () => {
    await repo.findById("abc");
    expect(db.findOne).toHaveBeenCalledWith("messages", "abc");
  });

  it("findMany delegates with correct collection", async () => {
    const opts = {
      where: [{ field: "source", op: "==" as const, value: "test" }],
      limit: 5,
    };
    await repo.findMany(opts);
    expect(db.findMany).toHaveBeenCalledWith("messages", opts);
  });

  it("createOne uses atomic create with correct args", async () => {
    const data = { text: "hello" };
    await repo.createOne("msg-1", data);
    expect(db.createOne).toHaveBeenCalledWith("messages", data, "msg-1");
  });

  it("insertOne passes id when provided", async () => {
    const data = { text: "hello" };
    await repo.insertOne(data, "custom-id");
    expect(db.insertOne).toHaveBeenCalledWith("messages", data, "custom-id");
  });

  it("insertOne auto-generates id when none provided", async () => {
    const data = { text: "hello" };
    await repo.insertOne(data);
    expect(db.insertOne).toHaveBeenCalledWith("messages", data, undefined);
  });

  describe("findBySourceDocumentIds", () => {
    it("queries single batch for <= 30 IDs", async () => {
      const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
      await repo.findBySourceDocumentIds(ids);

      expect(db.findMany).toHaveBeenCalledTimes(1);
      expect(db.findMany).toHaveBeenCalledWith("messages", {
        where: [{ field: "sourceDocumentId", op: "in", value: ids }],
        select: undefined,
      });
    });

    it("batches queries in chunks of 30", async () => {
      const ids = Array.from({ length: 65 }, (_, i) => `id-${i}`);
      await repo.findBySourceDocumentIds(ids);

      // 65 / 30 = 3 batches (30 + 30 + 5)
      expect(db.findMany).toHaveBeenCalledTimes(3);
    });

    it("passes select fields to each batch query", async () => {
      const ids = ["id-1"];
      await repo.findBySourceDocumentIds(ids, ["_id", "text"]);

      expect(db.findMany).toHaveBeenCalledWith("messages", {
        where: [{ field: "sourceDocumentId", op: "in", value: ids }],
        select: ["_id", "text"],
      });
    });

    it("merges results from multiple batches", async () => {
      const ids = Array.from({ length: 35 }, (_, i) => `id-${i}`);
      vi.mocked(db.findMany)
        .mockResolvedValueOnce([{ _id: "a" }])
        .mockResolvedValueOnce([{ _id: "b" }, { _id: "c" }]);

      const result = await repo.findBySourceDocumentIds(ids);
      expect(result).toEqual([{ _id: "a" }, { _id: "b" }, { _id: "c" }]);
    });

    it("returns empty array for empty input", async () => {
      const result = await repo.findBySourceDocumentIds([]);
      expect(db.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});

// ─── SourcesRepository ────────────────────────────────────────

describe("SourcesRepository", () => {
  let db: DbClient;
  let repo: SourcesRepository;

  beforeEach(() => {
    db = createMockClient();
    repo = new SourcesRepository(db);
  });

  it("setOne uses batchWrite with set operation", async () => {
    const data = { url: "https://example.com" };
    await repo.setOne("src-1", data);
    expect(db.batchWrite).toHaveBeenCalledWith([
      { type: "set", collection: "sources", id: "src-1", data },
    ]);
  });

  describe("deleteManyByIds", () => {
    it("deletes in batches of 500", async () => {
      const ids = Array.from({ length: 520 }, (_, i) => `id-${i}`);
      await repo.deleteManyByIds(ids);

      expect(db.batchWrite).toHaveBeenCalledTimes(2);

      // First batch: 500 items
      const firstCall = vi.mocked(db.batchWrite).mock.calls[0][0];
      expect(firstCall).toHaveLength(500);
      expect(firstCall[0]).toEqual({
        type: "delete",
        collection: "sources",
        id: "id-0",
      });

      // Second batch: 20 items
      const secondCall = vi.mocked(db.batchWrite).mock.calls[1][0];
      expect(secondCall).toHaveLength(20);
    });

    it("handles empty array (no batchWrite calls)", async () => {
      await repo.deleteManyByIds([]);
      expect(db.batchWrite).not.toHaveBeenCalled();
    });
  });
});

// ─── InterestsRepository ──────────────────────────────────────

describe("InterestsRepository", () => {
  let db: DbClient;
  let repo: InterestsRepository;

  beforeEach(() => {
    db = createMockClient();
    repo = new InterestsRepository(db);
  });

  it("findByUserId queries with userId and orders by createdAt desc", async () => {
    await repo.findByUserId("user-1");
    expect(db.findMany).toHaveBeenCalledWith("interests", {
      where: [{ field: "userId", op: "==", value: "user-1" }],
      orderBy: [{ field: "createdAt", direction: "desc" }],
    });
  });

  describe("deleteAllByUserId", () => {
    it("deletes all docs for a user via deleteMany and returns count", async () => {
      vi.mocked(db.deleteMany).mockResolvedValue(2);

      const deleted = await repo.deleteAllByUserId("user-1");

      expect(deleted).toBe(2);
      expect(db.deleteMany).toHaveBeenCalledWith("interests", [
        { field: "userId", op: "==", value: "user-1" },
      ]);
    });

    it("returns 0 when user has no docs", async () => {
      vi.mocked(db.deleteMany).mockResolvedValue(0);
      const deleted = await repo.deleteAllByUserId("user-1");
      expect(deleted).toBe(0);
    });
  });
});

// ─── NotificationMatchesRepository ────────────────────────────

describe("NotificationMatchesRepository", () => {
  let db: DbClient;
  let repo: NotificationMatchesRepository;

  beforeEach(() => {
    db = createMockClient();
    repo = new NotificationMatchesRepository(db);
  });

  it("findUnnotified queries a bounded projection", async () => {
    await repo.findUnnotified(100);
    expect(db.findMany).toHaveBeenCalledWith("notificationMatches", {
      where: [{ field: "notified", op: "==", value: false }],
      limit: 100,
      select: [
        "userId",
        "messageId",
        "interestId",
        "matchedAt",
        "notified",
        "notifiedAt",
        "distance",
      ],
    });
  });

  it("findByUserId queries with userId, notified=true, ordered by notifiedAt desc", async () => {
    await repo.findByUserId("user-1", { limit: 10 });
    expect(db.findMany).toHaveBeenCalledWith("notificationMatches", {
      where: [
        { field: "userId", op: "==", value: "user-1" },
        { field: "notified", op: "==", value: true },
      ],
      orderBy: [{ field: "notifiedAt", direction: "desc" }],
      limit: 10,
    });
  });

  it("findByUserId omits limit when not provided", async () => {
    await repo.findByUserId("user-1");
    expect(db.findMany).toHaveBeenCalledWith("notificationMatches", {
      where: [
        { field: "userId", op: "==", value: "user-1" },
        { field: "notified", op: "==", value: true },
      ],
      orderBy: [{ field: "notifiedAt", direction: "desc" }],
      limit: undefined,
    });
  });

  describe("deleteAllByUserId", () => {
    it("deletes all matches for a user via deleteMany and returns count", async () => {
      vi.mocked(db.deleteMany).mockResolvedValue(1);

      const deleted = await repo.deleteAllByUserId("user-1");

      expect(deleted).toBe(1);
      expect(db.deleteMany).toHaveBeenCalledWith("notificationMatches", [
        { field: "userId", op: "==", value: "user-1" },
      ]);
    });

    it("returns 0 when no matches exist", async () => {
      vi.mocked(db.deleteMany).mockResolvedValue(0);
      const deleted = await repo.deleteAllByUserId("user-1");
      expect(deleted).toBe(0);
    });
  });
});

// ─── NotificationSubscriptionsRepository ──────────────────────

describe("NotificationSubscriptionsRepository", () => {
  let db: DbClient;
  let repo: NotificationSubscriptionsRepository;

  beforeEach(() => {
    db = createMockClient();
    repo = new NotificationSubscriptionsRepository(db);
  });

  it("findByUserId queries with userId", async () => {
    await repo.findByUserId("user-1");
    expect(db.findMany).toHaveBeenCalledWith("notificationSubscriptions", {
      where: [{ field: "userId", op: "==", value: "user-1" }],
    });
  });

  describe("findByUserAndToken", () => {
    it("returns a matching subscription", async () => {
      const sub = { _id: "sub-1", userId: "user-1", token: "tok-1" };
      vi.mocked(db.findMany).mockResolvedValue([sub]);

      const result = await repo.findByUserAndToken("user-1", "tok-1");

      expect(result).toEqual(sub);
      expect(db.findMany).toHaveBeenCalledWith("notificationSubscriptions", {
        where: [
          { field: "userId", op: "==", value: "user-1" },
          { field: "token", op: "==", value: "tok-1" },
        ],
        limit: 1,
      });
    });

    it("returns null when no match found", async () => {
      vi.mocked(db.findMany).mockResolvedValue([]);
      const result = await repo.findByUserAndToken("user-1", "tok-1");
      expect(result).toBeNull();
    });
  });

  describe("hasSubscription", () => {
    it("returns true when user has subscriptions", async () => {
      vi.mocked(db.findMany).mockResolvedValue([
        { _id: "sub-1", userId: "user-1" },
      ]);
      const result = await repo.hasSubscription("user-1");
      expect(result).toBe(true);
    });

    it("returns false when user has no subscriptions", async () => {
      vi.mocked(db.findMany).mockResolvedValue([]);
      const result = await repo.hasSubscription("user-1");
      expect(result).toBe(false);
    });
  });

  describe("deleteAllByUserId", () => {
    it("deletes all subscriptions for a user via deleteMany and returns count", async () => {
      vi.mocked(db.deleteMany).mockResolvedValue(2);

      const deleted = await repo.deleteAllByUserId("user-1");

      expect(deleted).toBe(2);
      expect(db.deleteMany).toHaveBeenCalledWith("notificationSubscriptions", [
        { field: "userId", op: "==", value: "user-1" },
      ]);
    });

    it("returns 0 when no subscriptions exist", async () => {
      vi.mocked(db.deleteMany).mockResolvedValue(0);
      const deleted = await repo.deleteAllByUserId("user-1");
      expect(deleted).toBe(0);
    });
  });
});

// ─── GtfsStopsRepository ──────────────────────────────────────

describe("GtfsStopsRepository", () => {
  let db: DbClient;
  let repo: GtfsStopsRepository;

  beforeEach(() => {
    db = createMockClient();
    repo = new GtfsStopsRepository(db);
  });

  it("findById uses stop code as ID", async () => {
    await repo.findById("STOP_001");
    expect(db.findOne).toHaveBeenCalledWith("gtfsStops", "STOP_001");
  });

  describe("upsertBatch", () => {
    it("creates batch set operations in chunks of 100", async () => {
      const stops = Array.from({ length: 110 }, (_, i) => ({
        stopCode: `STOP_${i}`,
        data: { name: `Stop ${i}` },
      }));

      await repo.upsertBatch(stops);

      expect(db.batchWrite).toHaveBeenCalledTimes(2);

      // First batch: 100 ops
      const firstCall = vi.mocked(db.batchWrite).mock.calls[0][0];
      expect(firstCall).toHaveLength(100);
      expect(firstCall[0]).toEqual({
        type: "set",
        collection: "gtfsStops",
        id: "STOP_0",
        data: { name: "Stop 0" },
        merge: true,
      });

      // Second batch: 10 ops
      const secondCall = vi.mocked(db.batchWrite).mock.calls[1][0];
      expect(secondCall).toHaveLength(10);
    });

    it("handles empty array (no batchWrite calls)", async () => {
      await repo.upsertBatch([]);
      expect(db.batchWrite).not.toHaveBeenCalled();
    });

    it("uses merge: true on all set operations", async () => {
      await repo.upsertBatch([{ stopCode: "S1", data: { name: "Stop 1" } }]);

      const ops = vi.mocked(db.batchWrite).mock.calls[0][0];
      expect(ops[0].merge).toBe(true);
    });
  });
});
