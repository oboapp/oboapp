import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoAdapter } from "./mongo-adapter";
import { ObjectId, type MongoClient } from "mongodb";

type CursorMock = {
  sort: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  project: ReturnType<typeof vi.fn>;
  toArray: ReturnType<typeof vi.fn>;
};

function createCursorMock(docs: Record<string, unknown>[] = []): CursorMock {
  const cursor = {
    sort: vi.fn(),
    limit: vi.fn(),
    project: vi.fn(),
    toArray: vi.fn().mockResolvedValue(docs),
  };

  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  cursor.project.mockReturnValue(cursor);

  return cursor;
}

describe("MongoAdapter", () => {
  const findMock = vi.fn();
  const bulkWriteMock = vi.fn().mockResolvedValue(undefined);
  const countDocumentsMock = vi.fn();
  const updateOneMock = vi.fn();
  const deleteManyMock = vi.fn();
  const collectionMock = {
    find: findMock,
    bulkWrite: bulkWriteMock,
    countDocuments: countDocumentsMock,
    updateOne: updateOneMock,
    deleteMany: deleteManyMock,
  };

  const dbMock = {
    collection: vi.fn().mockReturnValue(collectionMock),
  };

  const clientMock = {
    db: vi.fn().mockReturnValue(dbMock),
    close: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.collection.mockReturnValue(collectionMock);
  });

  it("preserves ObjectId cursors across more than 500 documents", async () => {
    const ids = Array.from({ length: 501 }, () => new ObjectId());
    const adapter = new MongoAdapter(
      clientMock as unknown as MongoClient,
      "oboapp",
    );
    findMock.mockReturnValueOnce(
      createCursorMock(ids.slice(0, 500).map((_id) => ({ _id }))),
    );
    const first = await adapter.findPage("notificationMatches", { limit: 500 });
    expect(first.documents).toHaveLength(500);
    expect(first.documents[499]._id).toBe(ids[499].toHexString());
    expect(first.nextCursor?.value).toBe(ids[499]);
    findMock.mockReturnValueOnce(createCursorMock([{ _id: ids[500] }]));
    const second = await adapter.findPage("notificationMatches", {
      limit: 500,
      after: first.nextCursor!,
    });
    expect(second.documents[0]._id).toBe(ids[500].toHexString());
    expect(findMock).toHaveBeenLastCalledWith({
      $and: [{}, { $expr: { $gt: ["$_id", { $literal: ids[499] }] } }],
    });
  });

  it("uses BSON expression ordering to cross from string IDs to ObjectIds", async () => {
    const id = new ObjectId();
    findMock.mockReturnValue(createCursorMock([{ _id: id }]));
    const adapter = new MongoAdapter(
      clientMock as unknown as MongoClient,
      "oboapp",
    );
    const page = await adapter.findPage("notificationMatches", {
      limit: 500,
      where: [{ field: "notified", op: "==", value: true }],
      after: { backend: "mongodb", value: "$last-string-id" },
    });
    expect(page.nextCursor?.value).toBe(id);
    expect(findMock).toHaveBeenCalledWith({
      $and: [
        { notified: true },
        { $expr: { $gt: ["$_id", { $literal: "$last-string-id" }] } },
      ],
    });
  });

  it("builds an $and filter when multiple where clauses target the same field", async () => {
    const cursor = createCursorMock([]);
    findMock.mockReturnValue(cursor);

    const adapter = new MongoAdapter(clientMock as any, "oboapp");
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-31T23:59:59.999Z");

    await adapter.findMany("messages", {
      where: [
        { field: "finalizedAt", op: ">", value: start },
        { field: "finalizedAt", op: "<=", value: end },
      ],
    });

    expect(findMock).toHaveBeenCalledWith({
      $and: [{ finalizedAt: { $gt: start } }, { finalizedAt: { $lte: end } }],
    });
  });

  it("uses replaceOne for set operations without merge", async () => {
    const adapter = new MongoAdapter(clientMock as any, "oboapp");

    await adapter.batchWrite([
      {
        type: "set",
        collection: "messages",
        id: "msg-1",
        data: { text: "hello" },
      },
    ]);

    expect(bulkWriteMock).toHaveBeenCalledWith([
      {
        replaceOne: {
          filter: { _id: "msg-1" },
          replacement: { _id: "msg-1", text: "hello" },
          upsert: true,
        },
      },
    ]);
  });

  it("uses updateOne with $set for set operations with merge=true", async () => {
    const adapter = new MongoAdapter(clientMock as any, "oboapp");

    await adapter.batchWrite([
      {
        type: "set",
        collection: "messages",
        id: "msg-1",
        data: { text: "hello" },
        merge: true,
      },
    ]);

    expect(bulkWriteMock).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: "msg-1" },
          update: { $set: { _id: "msg-1", text: "hello" } },
          upsert: true,
        },
      },
    ]);
  });

  it("normalizes $addToSet arrays to $each in updateOne", async () => {
    const adapter = new MongoAdapter(clientMock as any, "oboapp");

    await adapter.updateOne("messages", "msg-1", {
      $addToSet: {
        tags: ["a", "b"],
      },
    });

    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: "msg-1" },
      {
        $addToSet: {
          tags: { $each: ["a", "b"] },
        },
      },
    );
  });

  it("passes through scalar $addToSet values in updateOne", async () => {
    const adapter = new MongoAdapter(clientMock as any, "oboapp");

    await adapter.updateOne("messages", "msg-1", {
      $addToSet: {
        status: "active",
      },
    });

    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: "msg-1" },
      {
        $addToSet: {
          status: "active",
        },
      },
    );
  });

  it("uses $set wrapper when updateOne receives plain object", async () => {
    const adapter = new MongoAdapter(clientMock as any, "oboapp");

    await adapter.updateOne("messages", "msg-1", { text: "hello" });

    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: "msg-1" },
      { $set: { text: "hello" } },
    );
  });
});
