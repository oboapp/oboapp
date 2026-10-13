import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingest } from "./from-sources";
import { encodeDocumentId } from "../crawlers/shared/firestore";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateOne: vi.fn(),
  messageIngest: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getDb: async () => ({ sources: { findMany: mocks.findMany, updateOne: mocks.updateOne } }),
}));
vi.mock("./index", () => ({ messageIngest: mocks.messageIngest }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const geometry = {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: { type: "Point", coordinates: [23.32, 42.7] }, properties: {} }],
};
function source(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://example.com/article",
    title: "Article",
    message: "",
    sourceType: "sofia-bg",
    locality: "bg.sofia",
    datePublished: new Date().toISOString(),
    crawledAt: new Date(),
    processed: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([source()]);
  mocks.updateOne.mockResolvedValue(undefined);
  mocks.messageIngest.mockResolvedValue({ messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0 });
});

describe("empty source ingestion", () => {
  it.each(["", " \n\t ", undefined])("marks empty text %j processed without calling the pipeline", async (message) => {
    mocks.findMany.mockResolvedValue([source({ message })]);
    const result = await ingest();
    expect(mocks.updateOne).toHaveBeenCalledExactlyOnceWith(encodeDocumentId(source().url), { processed: true });
    expect(mocks.messageIngest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 0, ingested: 0 });
  });

  it("does not select a processed empty source on the next run", async () => {
    const record = source();
    mocks.findMany.mockImplementation(async ({ where }) => {
      expect(where).toContainEqual({ field: "processed", op: "==", value: false });
      return record.processed ? [] : [record];
    });
    mocks.updateOne.mockImplementation(async () => { record.processed = true; });
    await ingest();
    expect(await ingest()).toMatchObject({ total: 0, failed: 0 });
    expect(mocks.updateOne).toHaveBeenCalledOnce();
    expect(mocks.messageIngest).not.toHaveBeenCalled();
  });

  it("leaves empty sources untouched in a dry run", async () => {
    expect(await ingest({ dryRun: true })).toMatchObject({ failed: 0 });
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.messageIngest).not.toHaveBeenCalled();
  });

  it.each([geometry, JSON.stringify(geometry)])("preserves text-free sources with precomputed geometry", async (geoJson) => {
    mocks.findMany.mockResolvedValue([source({ geoJson, markdownText: "Road closure" })]);
    expect(await ingest()).toMatchObject({ ingested: 1, failed: 0 });
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.messageIngest).toHaveBeenCalledWith("", "sofia-bg", expect.objectContaining({ precomputedGeoJson: geometry, markdownText: "Road closure" }));
  });

  it("continues normal ingestion for non-empty text", async () => {
    mocks.findMany.mockResolvedValue([source({ message: "Road closure" })]);
    expect(await ingest()).toMatchObject({ ingested: 1, failed: 0 });
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.messageIngest).toHaveBeenCalledOnce();
  });

  it("reports a failed processed-state update without invoking the pipeline", async () => {
    mocks.updateOne.mockRejectedValue(new Error("database unavailable"));
    expect(await ingest()).toMatchObject({ failed: 1, errors: [{ url: source().url, error: "database unavailable" }] });
    expect(mocks.messageIngest).not.toHaveBeenCalled();
  });
});
