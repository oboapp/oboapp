import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceSnapshot } from "@oboapp/shared";
import type { BatchOperation, DbClient } from "../types";
import {
  SOURCE_SNAPSHOTS_COLLECTION,
  SourceSnapshotsRepository,
} from "./source-snapshots";

const snapshot: SourceSnapshot = {
  sourceType: "toplo-bg",
  locality: "bg.sofia",
  count: 99,
  observedAt: "2026-11-09T19:30:00.000Z",
};

const incident = {
  id: "incident-one",
  accidentId: "accident-one",
  name: "Яворов",
  addresses: "Цар Иван Асен II 42",
  type: "accident" as const,
  status: 1,
  reportedStart: "2026-11-09T15:00:00Z",
  estimatedEnd: "2026-11-10T20:00:00Z",
  createdAt: null,
};

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

describe("SourceSnapshotsRepository", () => {
  let db: DbClient;
  let repository: SourceSnapshotsRepository;

  beforeEach(() => {
    db = createMockClient();
    repository = new SourceSnapshotsRepository(db);
  });

  it("retains separate history records when an older observation arrives late", async () => {
    const records = new Map<string, BatchOperation>();
    vi.mocked(db.batchWrite).mockImplementation(async (operations) => {
      for (const operation of operations) {
        records.set(operation.id, operation);
      }
    });

    await repository.save(snapshot);
    await repository.save({
      ...snapshot,
      count: 94,
      observedAt: "2026-11-09T20:00:00.000Z",
    });
    await repository.save({
      ...snapshot,
      count: 104,
      observedAt: "2026-11-09T19:00:00.000Z",
    });

    expect(records.size).toBe(3);
    expect(Array.from(records.values(), (record) => {
      return record.data;
    })).toEqual([
      snapshot,
      { ...snapshot, count: 94, observedAt: "2026-11-09T20:00:00.000Z" },
      { ...snapshot, count: 104, observedAt: "2026-11-09T19:00:00.000Z" },
    ]);
  });

  it("normalizes timestamps so retries replace the same observation", async () => {
    await repository.save({ ...snapshot, observedAt: "2026-11-09T19:30:00Z" });
    await repository.save(snapshot);

    const [first, second] = vi.mocked(db.batchWrite).mock.calls;
    expect(first[0]).toEqual(second[0]);
    expect(first[0]).toEqual([
      {
        type: "set",
        collection: SOURCE_SNAPSHOTS_COLLECTION,
        id: expect.any(String),
        data: snapshot,
      },
    ]);
  });

  it("keeps source and locality identities separate, including separators", async () => {
    await repository.save(snapshot);
    await repository.save({ ...snapshot, sourceType: "other-source" });
    await repository.save({ ...snapshot, locality: "bg.plovdiv" });
    await repository.save({
      ...snapshot,
      locality: "one:two",
      sourceType: "three",
    });
    await repository.save({
      ...snapshot,
      locality: "one",
      sourceType: "two:three",
    });

    const ids = vi.mocked(db.batchWrite).mock.calls.map(([operations]) => {
      return operations[0].id;
    });

    expect(new Set(ids).size).toBe(5);
  });

  it("retains incident fields and complete empty listings", async () => {
    const complete = { ...snapshot, count: 1, incidents: [incident] };
    const empty = { ...snapshot, count: 0, incidents: [] };

    await repository.save(complete);
    await repository.save(empty);

    expect(vi.mocked(db.batchWrite).mock.calls.map(([operations]) => {
      return operations[0].data;
    })).toEqual([complete, empty]);
  });

  it.each([
    { ...snapshot, count: -1 },
    { ...snapshot, observedAt: "invalid" },
    { ...snapshot, count: 2, incidents: [incident] },
    { ...snapshot, count: 2, incidents: [incident, incident] },
  ])("rejects invalid observations before writing: %j", async (invalid) => {
    await expect(repository.save(invalid)).rejects.toThrow();
    expect(db.batchWrite).not.toHaveBeenCalled();
  });

  it("finds the newest observation for the requested source and locality", async () => {
    const complete = { ...snapshot, count: 1, incidents: [incident] };
    vi.mocked(db.findMany).mockResolvedValue([
      { ...complete, _id: "snapshot-id" },
    ]);

    await expect(repository.findLatest("toplo-bg", "bg.sofia"))
      .resolves.toEqual(complete);
    expect(db.findMany).toHaveBeenCalledWith(SOURCE_SNAPSHOTS_COLLECTION, {
      where: [
        { field: "locality", op: "==", value: "bg.sofia" },
        { field: "sourceType", op: "==", value: "toplo-bg" },
      ],
      orderBy: [{ field: "observedAt", direction: "desc" }],
      limit: 1,
    });
  });

  it("distinguishes a missing observation from a successful zero count", async () => {
    await expect(repository.findLatest("toplo-bg", "bg.sofia"))
      .resolves.toBeNull();

    const empty = { ...snapshot, count: 0, incidents: [] };
    vi.mocked(db.findMany).mockResolvedValue([empty]);

    await expect(repository.findLatest("toplo-bg", "bg.sofia"))
      .resolves.toEqual(empty);
  });

  it("rejects a corrupt stored observation", async () => {
    vi.mocked(db.findMany).mockResolvedValue([
      { ...snapshot, count: 2, incidents: [incident] },
    ]);

    await expect(repository.findLatest("toplo-bg", "bg.sofia"))
      .rejects.toThrow();
  });

  it("propagates storage failures", async () => {
    vi.mocked(db.batchWrite).mockRejectedValue(new Error("Write failed"));
    vi.mocked(db.findMany).mockRejectedValue(new Error("Read failed"));

    await expect(repository.save(snapshot)).rejects.toThrow("Write failed");
    await expect(repository.findLatest("toplo-bg", "bg.sofia"))
      .rejects.toThrow("Read failed");
  });
});
