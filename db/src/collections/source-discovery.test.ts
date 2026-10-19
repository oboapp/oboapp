import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../types";
import { SourceDiscoveryRepository, SOURCE_DISCOVERY_COLLECTION, SOURCE_WORK_COLLECTION } from "./source-discovery";

const now = "2026-10-19T00:00:00.000Z";
const item = { identifier: "https://example.com/A%2fb", sourceType: "example", locality: "bg.sofia" };
const stored = { sourceType: "example", locality: "bg.sofia", token: "old", cursor: "page-2" };

function setup() {
  const db: DbClient = {
    findOne: vi.fn().mockResolvedValue(null), findMany: vi.fn(),
    createOne: vi.fn().mockResolvedValue("id"), insertOne: vi.fn(), updateOne: vi.fn(),
    compareAndUpdate: vi.fn().mockResolvedValue(true), deleteOne: vi.fn(),
    deleteMany: vi.fn(), batchWrite: vi.fn(), count: vi.fn(), close: vi.fn(),
  };
  return { db, repository: new SourceDiscoveryRepository(db) };
}

describe("source discovery repository", () => {
  it("creates and returns a durable initial checkpoint", async () => {
    const { db, repository } = setup();
    const checkpoint = await repository.openCheckpoint("scan", "example", "bg.sofia", now);
    expect(checkpoint).toEqual({ cursor: null, token: expect.any(String) });
    expect(db.createOne).toHaveBeenCalledWith(SOURCE_DISCOVERY_COLLECTION,
      { ...checkpoint, sourceType: "example", locality: "bg.sofia", createdAt: now, updatedAt: now }, "scan");
  });

  it("reuses an existing cursor without resetting it", async () => {
    const { db, repository } = setup();
    vi.mocked(db.findOne).mockResolvedValue(stored);
    expect(await repository.openCheckpoint("scan", "example", "bg.sofia", now)).toEqual({ token: "old", cursor: "page-2" });
    expect(db.createOne).not.toHaveBeenCalled();
  });

  it.each([6, 11000, "already-exists"])("handles concurrent checkpoint creation with duplicate code %s", async (code) => {
    const { db, repository } = setup();
    vi.mocked(db.findOne).mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
    vi.mocked(db.createOne).mockRejectedValue(Object.assign(new Error("duplicate"), { code }));
    expect(await repository.openCheckpoint("scan", "example", "bg.sofia", now)).toEqual({ token: "old", cursor: "page-2" });
  });

  it.each([
    { ...stored, sourceType: "other" }, { ...stored, locality: "bg.plovdiv" },
    { ...stored, token: "" }, { ...stored, cursor: undefined }, { ...stored, cursor: 1 },
  ])("fails closed on invalid checkpoint identity/state %j", async (record) => {
    const { db, repository } = setup();
    vi.mocked(db.findOne).mockResolvedValue(record);
    await expect(repository.openCheckpoint("scan", "example", "bg.sofia", now)).rejects.toThrow("Invalid discovery checkpoint");
    expect(db.createOne).not.toHaveBeenCalled();
  });

  it("does not treat a disappeared checkpoint as a fresh scan", async () => {
    const { db, repository } = setup();
    vi.mocked(db.createOne).mockRejectedValue(Object.assign(new Error("duplicate"), { code: 6 }));
    await expect(repository.openCheckpoint("scan", "example", "bg.sofia", now)).rejects.toThrow("disappeared");
  });

  it("propagates checkpoint read and write failures", async () => {
    const { db, repository } = setup();
    vi.mocked(db.findOne).mockRejectedValueOnce(new Error("read offline"));
    await expect(repository.openCheckpoint("scan", "example", "bg.sofia", now)).rejects.toThrow("read offline");
    expect(db.createOne).not.toHaveBeenCalled();
    vi.mocked(db.createOne).mockRejectedValue(new Error("write offline"));
    await expect(repository.openCheckpoint("scan", "example", "bg.sofia", now)).rejects.toThrow("write offline");
  });

  it("registers pending work in a separate collection without a processed field", async () => {
    const { db, repository } = setup();
    expect(await repository.registerItem("item", item, now)).toBe(true);
    expect(db.createOne).toHaveBeenCalledWith(SOURCE_WORK_COLLECTION, {
      ...item, status: "pending", leaseToken: expect.any(String), attempts: 0, createdAt: now, updatedAt: now,
    }, "item");
  });

  it("retains original context when an identifier is discovered again", async () => {
    const { db, repository } = setup();
    vi.mocked(db.createOne).mockRejectedValue(Object.assign(new Error("duplicate"), { code: 6 }));
    vi.mocked(db.findOne).mockResolvedValue({ ...item, payloadJson: '"original"' });
    expect(await repository.registerItem("item", { ...item, payloadJson: '"updated"' }, now)).toBe(false);
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(db.compareAndUpdate).not.toHaveBeenCalled();
  });

  it.each([null, { identifier: "different" }])("rejects a missing or colliding pending identifier %j", async (record) => {
    const { db, repository } = setup();
    vi.mocked(db.createOne).mockRejectedValue(Object.assign(new Error("duplicate"), { code: 6 }));
    vi.mocked(db.findOne).mockResolvedValue(record);
    await expect(repository.registerItem("item", item, now)).rejects.toThrow("collision or missing");
  });

  it("does not swallow non-duplicate storage errors based on their wording", async () => {
    const { db, repository } = setup();
    vi.mocked(db.createOne).mockRejectedValue(new Error("already exists but not a coded conflict"));
    await expect(repository.registerItem("item", item, now)).rejects.toThrow("not a coded conflict");
    expect(db.findOne).not.toHaveBeenCalled();
  });

  it("atomically rotates a checkpoint token and preserves adapter binding", async () => {
    const { db } = setup();
    db.compareAndUpdate = vi.fn(async function (this: DbClient) { expect(this).toBe(db); return true; });
    const checkpoint = await new SourceDiscoveryRepository(db).advanceCheckpoint("scan", "old", null, now);
    expect(checkpoint.token).not.toBe("old");
    expect(db.compareAndUpdate).toHaveBeenCalledWith(SOURCE_DISCOVERY_COLLECTION, "scan", "token", "old", { ...checkpoint, updatedAt: now });
  });

  it("rejects stale checkpoint advancement", async () => {
    const { db, repository } = setup();
    vi.mocked(db.compareAndUpdate!).mockResolvedValue(false);
    await expect(repository.advanceCheckpoint("scan", "old", "next", now)).rejects.toThrow("reload");
  });

  it("requires atomic updates before any reads or writes", () => {
    const { db } = setup();
    delete db.compareAndUpdate;
    expect(() => new SourceDiscoveryRepository(db)).toThrow("requires atomic");
    expect(db.findOne).not.toHaveBeenCalled();
    expect(db.createOne).not.toHaveBeenCalled();
  });
});
