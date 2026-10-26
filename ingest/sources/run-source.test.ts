import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient, OboDb } from "@oboapp/db";
import { SourcesRepository } from "@oboapp/db";
import type { DataSource, SourceMetadata } from "@oboapp/source-sdk";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import { runSource } from "./run-source";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
const metadata: SourceMetadata = { id: "example", name: "Example", url: "https://example.com", localities: ["bg.sofia"] };
const content = { title: "Notice", message: "Work", datePublished: "2026-10-19" };
const identifier = "https://example.com/A%2fb?x=1&y=2";

function setup() {
  const records = new Map<string, Record<string, unknown>>();
  const client: DbClient = {
    findOne: vi.fn<DbClient["findOne"]>(async (_, id) => records.get(id) ?? null),
    createOne: vi.fn<DbClient["createOne"]>(async (_, data, id) => {
      if (records.has(id)) throw Object.assign(new Error("duplicate"), { code: 6 });
      records.set(id, data);
      return id;
    }),
    findMany: vi.fn(), insertOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn(),
    deleteMany: vi.fn(), batchWrite: vi.fn(), count: vi.fn(), close: vi.fn(),
  };
  const db = { client, sources: new SourcesRepository(client) } as OboDb;
  const source = {
    discoverItems: vi.fn<DataSource["discoverItems"]>().mockResolvedValue({ items: [{ identifier }] }),
    fetchItem: vi.fn<DataSource["fetchItem"]>().mockResolvedValue(content),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const create = vi.fn().mockResolvedValue(source);
  return { records, client, db, source, create };
}

beforeEach(() => vi.stubEnv("LOCALITY", "bg.sofia"));
afterEach(() => vi.unstubAllEnvs());

describe("scheduled source runner", () => {
  it("preserves identifiers and owns all workflow fields", async () => {
    const { db, create, source, records } = setup();
    source.fetchItem.mockResolvedValue({ ...content, url: "wrong", processed: true, sourceType: "wrong" } as typeof content);
    expect(await runSource(db, metadata, create)).toEqual({ saved: 1, skipped: 0, failed: 0 });
    expect(records.get(encodeDocumentId(identifier))).toEqual({
      ...content, url: identifier, sourceType: metadata.id, locality: "bg.sofia", crawledAt: expect.any(Date), processed: false,
    });
    expect(create).toHaveBeenCalledExactlyOnceWith({ locality: "bg.sofia" });
    expect(source.close).toHaveBeenCalledOnce();
  });

  it.each(encodeDocumentIdForLookup(identifier))("skips historical ID %s regardless of processing state", async (id) => {
    const { db, create, source, records } = setup();
    records.set(id, { processed: false });
    expect(await runSource(db, metadata, create)).toEqual({ saved: 0, skipped: 1, failed: 0 });
    expect(source.fetchItem).not.toHaveBeenCalled();
    expect(records.get(id)).toEqual({ processed: false });
  });

  it("continues after a failure and retries missing items on the next scan", async () => {
    const { db, create, source, records } = setup();
    source.discoverItems.mockResolvedValue({ items: [{ identifier }, { identifier: "synthetic:2", payload: { message: "ready" } }] });
    source.fetchItem.mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValue(content);
    expect(await runSource(db, metadata, create)).toEqual({ saved: 1, skipped: 0, failed: 1 });
    expect(records.has(encodeDocumentId(identifier))).toBe(false);
    expect(await runSource(db, metadata, create)).toEqual({ saved: 1, skipped: 1, failed: 0 });
    expect(source.discoverItems.mock.calls).toEqual([[undefined], [undefined]]);
    expect(source.fetchItem).toHaveBeenCalledWith({ identifier: "synthetic:2", payload: { message: "ready" } });
  });

  it("paginates in one session, supports empty cursors, and skips repeated items", async () => {
    const { db, create, source } = setup();
    source.discoverItems.mockResolvedValueOnce({ items: [{ identifier }], nextCursor: "" })
      .mockResolvedValueOnce({ items: [{ identifier }] });
    expect(await runSource(db, metadata, create)).toEqual({ saved: 1, skipped: 1, failed: 0 });
    expect(source.discoverItems.mock.calls).toEqual([[undefined], [""]]);
    expect(source.fetchItem).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it("stops a repeated cursor and closes the session", async () => {
    const { db, create, source } = setup();
    source.discoverItems.mockResolvedValue({ items: [], nextCursor: "loop" });
    await expect(runSource(db, metadata, create)).rejects.toThrow("repeated pagination cursor");
    expect(source.discoverItems).toHaveBeenCalledTimes(2);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("closes the session when discovery fails", async () => {
    const { db, create, source } = setup();
    source.discoverItems.mockRejectedValue(new Error("listing failed"));
    await expect(runSource(db, metadata, create)).rejects.toThrow("listing failed");
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("does not overwrite a document saved by an overlapping run", async () => {
    const { db, create, source, records } = setup();
    const winner = { ...content, processed: true };
    source.fetchItem.mockImplementation(async () => {
      records.set(encodeDocumentId(identifier), winner);
      return content;
    });
    expect(await runSource(db, metadata, create)).toEqual({ saved: 0, skipped: 1, failed: 0 });
    expect(records.get(encodeDocumentId(identifier))).toEqual(winner);
  });

  it("counts lookup and storage failures without writing partial documents", async () => {
    const { db, client, create, records } = setup();
    vi.mocked(client.findOne).mockRejectedValueOnce(new Error("offline"));
    expect((await runSource(db, metadata, create)).failed).toBe(1);
    vi.mocked(client.createOne).mockRejectedValueOnce(new Error("offline"));
    expect((await runSource(db, metadata, create)).failed).toBe(1);
    expect(records.size).toBe(0);
  });

  it("rejects invalid items and content without persisting them", async () => {
    const { db, create, source, records } = setup();
    source.discoverItems.mockResolvedValue({ items: [{ identifier: " " }, { identifier, payload: "x".repeat(300_000) }, { identifier: "bad-content" }] });
    source.fetchItem.mockResolvedValue({ ...content, datePublished: "invalid" });
    expect(await runSource(db, metadata, create)).toEqual({ saved: 0, skipped: 0, failed: 3 });
    expect(records.size).toBe(0);
    expect(source.fetchItem).toHaveBeenCalledOnce();
  });

  it("rejects unsupported localities before opening a source", async () => {
    const { db, create } = setup();
    await expect(runSource(db, { ...metadata, localities: [] }, create)).rejects.toThrow("locality");
    expect(create).not.toHaveBeenCalled();
  });
});
