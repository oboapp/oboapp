import { describe, expect, it, vi } from "vitest";
import type { DbClient, OboDb } from "@oboapp/db";
import { SourcesRepository, SOURCE_DISCOVERY_COLLECTION, SOURCE_WORK_COLLECTION } from "@oboapp/db";
import type { DiscoveryPage, SourceMetadata } from "@oboapp/source-sdk";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import { openDiscoveryCheckpoint, registerDiscoveryPage } from "./register-discovery";

const source: SourceMetadata = { id: "toplo-bg", name: "Топлофикация", url: "https://toplo.bg", localities: ["bg.sofia"] };
const locality = "bg.sofia";
const identifier = "https://toplo.bg/incidents/A%2fb?x=1&y=2";
const page: DiscoveryPage = { items: [{ identifier, payload: { title: "Авария", value: 1 } }], nextCursor: "page-2" };

function setup() {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  function records(collection: string) {
    let entries = collections.get(collection);
    if (!entries) { entries = new Map(); collections.set(collection, entries); }
    return entries;
  }
  const client: DbClient = {
    findOne: vi.fn<DbClient["findOne"]>(async (collection, id) => records(collection).get(id) ?? null),
    findMany: vi.fn<DbClient["findMany"]>(async (collection, options) => [...records(collection).values()].filter((record) =>
      (options?.where ?? []).every(({ field, op, value }) => {
        if (op !== "==") throw new Error("Unsupported mock operator");
        return record[field] === value;
      }))),
    createOne: vi.fn<DbClient["createOne"]>(async (collection, data, id) => {
      if (records(collection).has(id)) throw Object.assign(new Error("duplicate"), { code: 6 });
      records(collection).set(id, { ...data });
      return id;
    }),
    compareAndUpdate: vi.fn<NonNullable<DbClient["compareAndUpdate"]>>(async (collection, id, field, expected, data) => {
      const old = records(collection).get(id);
      if (!old || old[field] !== expected) return false;
      records(collection).set(id, { ...old, ...data });
      return true;
    }),
    insertOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn(), deleteMany: vi.fn(),
    batchWrite: vi.fn(), count: vi.fn(), close: vi.fn(),
  };
  const db = { client, sources: new SourcesRepository(client) } as OboDb;
  return { db, client, records };
}

describe("durable discovery registration", () => {
  it("registers synthetic identifiers and restart-safe context before advancing the cursor", async () => {
    const { db, records } = setup();
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    const result = await registerDiscoveryPage(db, source, locality, checkpoint, page);
    expect(result.registered).toBe(1);
    expect(result.known).toBe(0);
    expect(result.checkpoint.cursor).toBe("page-2");
    expect(result.checkpoint.token).not.toBe(checkpoint.token);
    expect(records(SOURCE_WORK_COLLECTION).get(encodeDocumentId(identifier))).toMatchObject({
      identifier, sourceType: "toplo-bg", locality, status: "pending", attempts: 0,
      payloadJson: JSON.stringify({ title: "Авария", value: 1 }),
    });
    expect(await db.sources.findMany({ where: [{ field: "processed", op: "==", value: false }] })).toEqual([]);
    expect(records("sources").size).toBe(0);
  });

  it.each(encodeDocumentIdForLookup(identifier))("recognizes historical raw ID %s even when unprocessed", async (id) => {
    const { db, records } = setup();
    const original = { url: identifier, processed: false, message: "original" };
    records("sources").set(id, original);
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    const result = await registerDiscoveryPage(db, source, locality, checkpoint, page);
    expect(result).toMatchObject({ registered: 0, known: 1 });
    expect(records(SOURCE_WORK_COLLECTION).size).toBe(0);
    expect(records("sources").get(id)).toEqual(original);
  });

  it("retains pending context across duplicate identifiers, revisions and package reruns", async () => {
    const { db, records } = setup();
    const initial = await openDiscoveryCheckpoint(db, source, locality);
    const first = await registerDiscoveryPage(db, source, locality, initial, page);
    const original = { ...records(SOURCE_WORK_COLLECTION).get(encodeDocumentId(identifier)) };
    const repeated = await registerDiscoveryPage(db, source, locality, first.checkpoint, {
      items: [{ identifier, observedAt: "new-provider-revision", payload: { title: "changed" } }, { identifier }],
    });
    expect(repeated).toMatchObject({ registered: 0, known: 2, checkpoint: { cursor: null } });
    expect(records(SOURCE_WORK_COLLECTION).get(encodeDocumentId(identifier))).toEqual(original);
  });

  it("replays a partially registered page without losing its cursor or duplicating work", async () => {
    const { db, client, records } = setup();
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    const create = vi.mocked(client.createOne).getMockImplementation()!;
    vi.mocked(client.createOne).mockImplementation(async (collection, data, id) => {
      if (data.identifier === "https://example.com/second") throw new Error("storage offline");
      return create(collection, data, id);
    });
    const two: DiscoveryPage = { items: [...page.items, { identifier: "https://example.com/second" }], nextCursor: "page-3" };
    await expect(registerDiscoveryPage(db, source, locality, checkpoint, two)).rejects.toThrow("storage offline");
    expect(await openDiscoveryCheckpoint(db, source, locality)).toEqual(checkpoint);
    expect(records(SOURCE_WORK_COLLECTION).size).toBe(1);
    vi.mocked(client.createOne).mockImplementation(create);
    const replay = await registerDiscoveryPage(db, source, locality, checkpoint, two);
    expect(replay).toMatchObject({ registered: 1, known: 1, checkpoint: { cursor: "page-3" } });
    expect(records(SOURCE_WORK_COLLECTION).size).toBe(2);
  });

  it("keeps the cursor when historical lookup fails", async () => {
    const { db, client, records } = setup();
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    const find = vi.mocked(client.findOne).getMockImplementation()!;
    vi.mocked(client.findOne).mockImplementation(async (collection, id) => {
      if (collection === "sources") throw new Error("lookup offline");
      return find(collection, id);
    });
    await expect(registerDiscoveryPage(db, source, locality, checkpoint, page)).rejects.toThrow("lookup offline");
    expect(await openDiscoveryCheckpoint(db, source, locality)).toEqual(checkpoint);
    expect(records(SOURCE_WORK_COLLECTION).size).toBe(0);
  });

  it("allows only one concurrent page to advance the same checkpoint", async () => {
    const { db, records } = setup();
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    const outcomes = await Promise.allSettled([
      registerDiscoveryPage(db, source, locality, checkpoint, page),
      registerDiscoveryPage(db, source, locality, checkpoint, page),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(records(SOURCE_WORK_COLLECTION).size).toBe(1);
    expect((await openDiscoveryCheckpoint(db, source, locality)).cursor).toBe("page-2");
  });

  it("validates every item before registering any part of the page", async () => {
    const { db, records } = setup();
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    await expect(registerDiscoveryPage(db, source, locality, checkpoint, {
      items: [...page.items, { identifier: "https://example.com/oversize", payload: "x".repeat(256 * 1024) }], nextCursor: "bad",
    })).rejects.toThrow("exceeds");
    expect(records(SOURCE_WORK_COLLECTION).size).toBe(0);
    expect(await openDiscoveryCheckpoint(db, source, locality)).toEqual(checkpoint);
  });

  it("rejects unknown or unsupported locality before creating a checkpoint", async () => {
    const { db, records } = setup();
    await expect(openDiscoveryCheckpoint(db, source, "not-a-locality")).rejects.toThrow();
    await expect(openDiscoveryCheckpoint(db, { ...source, localities: [] }, locality)).rejects.toThrow("does not support");
    expect(records(SOURCE_DISCOVERY_COLLECTION).size).toBe(0);
  });

  it("preserves empty opaque cursors and resets only a completed scan", async () => {
    const { db } = setup();
    const checkpoint = await openDiscoveryCheckpoint(db, source, locality);
    const first = await registerDiscoveryPage(db, source, locality, checkpoint, { items: [], nextCursor: "" });
    expect(first.checkpoint.cursor).toBe("");
    const done = await registerDiscoveryPage(db, source, locality, first.checkpoint, { items: [] });
    expect(done.checkpoint.cursor).toBeNull();
  });
});
