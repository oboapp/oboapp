// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { crawl } from "@/crawlers/sofiyska-voda/index";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingest } from "./from-sources";
import { messageIngest } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("./index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const baseUrl = "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer";
const identifier = `${baseUrl}/2/123`;
const documentId = "218a47bbe205d2c150898f017534e625";
const legacyDocumentId = "aHR0cHM6Ly9naXNweC5zb2ZpeXNrYXZvZGEuYmcvYXJjZ2lzL3Jlc3Qvc2VydmljZXMvV1NJX1BVQkxJQy9JbmZvQ2VudGVyX1B1YmxpYy9NYXBTZXJ2ZXIvMi8xMjM_";
const originalFeature = {
  attributes: {
    OBJECTID: 123,
    LOCATION: "ул. Тест",
    LASTUPDATE: Date.parse("2026-10-04T07:00:00Z"),
    START_: Date.parse("2026-10-04T08:00:00Z"),
    ALERTEND: Date.parse("2026-10-04T12:00:00Z"),
  },
  geometry: { x: 23.32, y: 42.7 },
};
const expectedMessage = [
  "ул. Тест",
  "",
  "Категория: Текущи спирания",
  "Начало: 4 октомври 2026 г. в 11:00",
  "Край: 4 октомври 2026 г. в 15:00",
  "Последно обновяване: 4 октомври 2026 г. в 10:00",
].join("\n");
const expectedMarkdown = [
  "**Категория:** Текущи спирания",
  "**Начало:** 4 октомври 2026 г. в 11:00",
  "**Край:** 4 октомври 2026 г. в 15:00",
  "**Последно обновяване:** 4 октомври 2026 г. в 10:00",
].join("  \n");
const expectedGeometry = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [23.32, 42.7] },
    properties: {
      layerId: 2,
      layerName: "Текущи спирания",
      titlePrefix: "Текущо спиране",
      location: "ул. Тест",
    },
  }],
};

let store: ReturnType<typeof createSourceStore>;
let features: typeof originalFeature[];
const fetchMock = vi.fn<typeof globalThis.fetch>();

function response(value: unknown): Response {
  return new Response(JSON.stringify(value));
}

function featureWithId(objectId: number, location = "ул. Тест"): typeof originalFeature {
  return {
    ...structuredClone(originalFeature),
    attributes: { ...originalFeature.attributes, OBJECTID: objectId, LOCATION: location },
  };
}

function storedUrls(): unknown[] {
  return [...store.records.values()].map((document) => document.url);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  features = [structuredClone(originalFeature)];
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockReset().mockResolvedValue({
    messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0,
  });
  fetchMock.mockReset().mockImplementation(async (url) => {
    return response({ features: String(url).includes("/2/query") ? features : [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  try {
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.signal?.aborted).toBe(true);
    }
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

describe("published Sofiyska Voda package to ingestion", () => {
  it("persists complete raw content and passes it through ingestion with public links disabled", async () => {
    await crawl();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(documentId)).toEqual({
      url: identifier,
      sourceType: "sofiyska-voda",
      locality: "bg.sofia",
      title: "Текущо спиране – ул. Тест",
      message: expectedMessage,
      markdownText: `ул. Тест\n\n${expectedMarkdown}`,
      datePublished: "2026-10-04T07:00:00.000Z",
      geoJson: JSON.stringify(expectedGeometry),
      deepLinkUrl: "",
      categories: ["water"],
      isRelevant: true,
      processed: false,
      crawledAt: contractDate,
      timespanStart: new Date("2026-10-04T08:00:00Z"),
      timespanEnd: new Date("2026-10-04T12:00:00Z"),
    });
    expect(await ingest({ sourceType: "sofiyska-voda", limit: 10 })).toMatchObject({
      total: 1, ingested: 1, failed: 0,
    });
    expect(store.sources.findMany).toHaveBeenCalledWith({
      where: [
        { field: "processed", op: "==", value: false },
        { field: "sourceType", op: "==", value: "sofiyska-voda" },
      ],
      limit: 10,
    });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(expectedMessage, "sofiyska-voda", {
      sourceDocumentId: documentId,
      sourceUrl: undefined,
      precomputedGeoJson: expectedGeometry,
      boundaryFilter: undefined,
      crawledAt: contractDate,
      datePublished: "2026-10-04T07:00:00.000Z",
      markdownText: `ул. Тест\n\n${expectedMarkdown}`,
      categories: ["water"],
      isRelevant: true,
      timespanStart: new Date("2026-10-04T08:00:00Z"),
      timespanEnd: new Date("2026-10-04T12:00:00Z"),
      cityWide: undefined,
      locality: "bg.sofia",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain("/query?");
    }
  });

  it("persists each page once and keeps the same OBJECTID distinct between current and planned layers", async () => {
    fetchMock.mockResolvedValueOnce(response({
      features: [originalFeature, featureWithId(123, "Duplicate")],
      exceededTransferLimit: true,
    })).mockResolvedValueOnce(response({
      features: [featureWithId(123, "Later duplicate"), featureWithId(124)],
    })).mockResolvedValueOnce(response({ features: [featureWithId(123, "Planned")] }));

    await crawl();

    expect(store.client.createOne).toHaveBeenCalledTimes(3);
    expect(store.records.get(documentId)).toMatchObject({ title: "Текущо спиране – ул. Тест" });
    expect(storedUrls()).toEqual([identifier, `${baseUrl}/2/124`, `${baseUrl}/3/123`]);
    expect([...store.records.values()][2]).toMatchObject({ title: "Планирано спиране – Planned" });
    const queries = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(queries.map((url) => [url.pathname.split("/").at(-2), url.searchParams.get("resultOffset")])).toEqual([
      ["2", "0"], ["2", "1000"], ["3", "0"],
    ]);
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 3, ingested: 3, failed: 0 });
    expect(messageIngest).toHaveBeenCalledTimes(3);
  });

  it.each([
    { format: "MD5", id: documentId },
    { format: "legacy base64", id: legacyDocumentId },
  ])("preserves a historical $format record without creating or ingesting it again", async ({ id }) => {
    const historical = { url: identifier, title: "Historical content", processed: true };
    store.records.set(id, historical);

    await crawl();

    expect(store.records.get(id)).toBe(historical);
    expect(store.records.size).toBe(1);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.sources.findById).toHaveBeenCalledWith(id);
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 0, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled();
  });

  it("retains the first content and downstream processing state when the provider changes an existing identifier", async () => {
    await crawl();
    const first = structuredClone(store.records.get(documentId));
    expect(first).toBeDefined();
    await store.sources.updateOne(documentId, { processed: true });
    features[0]!.attributes.LOCATION = "Changed provider content";

    await crawl();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.records.get(documentId)).toEqual({ ...first, processed: true });
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 0, skipped: 1, failed: 0,
    }));
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 0, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled();
  });

  it("continues after a write failure and retries only the missing interruption in the next scan", async () => {
    features.push(featureWithId(124));
    store.client.createOne.mockRejectedValueOnce(new Error("Temporary write failure"));

    await crawl();

    expect(storedUrls()).toEqual([`${baseUrl}/2/124`]);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 1, skipped: 0, failed: 1,
    }));
    await crawl();

    expect(store.records.size).toBe(2);
    expect(store.client.createOne).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 1, skipped: 1, failed: 0,
    }));
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 2, ingested: 2, failed: 0 });
  });

  it("keeps a historical record unchanged after a lookup failure and processes later interruptions", async () => {
    const historical = { url: identifier, title: "Historical content", processed: true };
    store.records.set(documentId, historical);
    features.push(featureWithId(124));
    store.sources.findById.mockRejectedValueOnce(new Error("Temporary lookup failure"));

    await crawl();

    expect(store.records.get(documentId)).toBe(historical);
    expect(store.records.size).toBe(2);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.client.createOne).toHaveBeenCalledWith("sources", expect.objectContaining({
      url: `${baseUrl}/2/124`,
    }), expect.any(String));
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 1, skipped: 0, failed: 1,
    }));
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
  });

  it("rejects invalid geometry without writing raw content and recovers corrected coordinates next scan", async () => {
    features[0]!.geometry = { x: 999, y: 999 };

    await expect(crawl()).rejects.toThrow("All Sofiyska Voda interruptions failed to process");

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    features[0]!.geometry = { x: 42.7, y: 23.32 };
    await crawl();

    const raw = store.records.get(documentId);
    expect(raw?.geoJson).toBe(JSON.stringify(expectedGeometry));
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledWith(expectedMessage, "sofiyska-voda", expect.objectContaining({
      precomputedGeoJson: expectedGeometry,
      sourceDocumentId: documentId,
      sourceUrl: undefined,
    }));
  });

  it("rejects a completely failed persistence scan without leaving incomplete raw documents", async () => {
    store.client.createOne.mockRejectedValue(new Error("Storage unavailable"));

    await expect(crawl()).rejects.toThrow("All Sofiyska Voda interruptions failed to process");

    expect(store.records.size).toBe(0);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 0, skipped: 0, failed: 1,
    }));
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 0, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled();
  });

  it.each([
    { name: "HTTP", body: "Unavailable", status: 503 },
    { name: "ArcGIS", body: JSON.stringify({ error: { code: 500, message: "Provider unavailable" } }), status: 200 },
    { name: "malformed", body: JSON.stringify({ features: "invalid" }), status: 200 },
  ])("propagates a $name discovery failure without writing or ingesting content", async ({ body, status }) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));

    await expect(crawl()).rejects.toThrow();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith("Crawl complete", expect.anything());
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 0, ingested: 0 });
  });

  it("keeps complete earlier-page records when a later discovery page fails and retries the remainder next scan", async () => {
    fetchMock.mockResolvedValueOnce(response({ features: [originalFeature], exceededTransferLimit: true }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));

    await expect(crawl()).rejects.toThrow("503");

    expect(store.records.get(documentId)).toMatchObject({ url: identifier, processed: false });
    expect(store.records.size).toBe(1);
    features.push(featureWithId(124));
    await crawl();

    expect(store.records.size).toBe(2);
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", expect.objectContaining({
      saved: 1, skipped: 1, failed: 0,
    }));
    expect(await ingest({ sourceType: "sofiyska-voda" })).toMatchObject({ total: 2, ingested: 2, failed: 0 });
  });
});
