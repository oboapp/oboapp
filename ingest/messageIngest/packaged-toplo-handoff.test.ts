// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-toplo-bg/metadata";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { pointGeometry, toploHtml } from "@/__mocks__/source-contract-fixtures";
import { crawl } from "@/crawlers/toplo-bg/index";
import { getDb } from "@/lib/db";
import { ingest } from "./from-sources";
import { messageIngest } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("./index", () => ({ messageIngest: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const identifier = "https://toplo.bg/incidents/item-1";
const itemId = "cbf67133fb60fcb862ec54ff677afd05";
const legacyId = "aHR0cHM6Ly90b3Bsby5iZy9pbmNpZGVudHMvaXRlbS0x";
const expectedMessage = "Ремонт\n\n4 октомври 2026 г. в 08:00\nул. Тест";
const geometryJson = '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[23.32,42.7]},"properties":{}}]}';

let store: ReturnType<typeof createSourceStore>;
let listing: string;
let fetchListing: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  vi.stubEnv("TZ", "UTC");
  listing = toploHtml();
  store = createSourceStore();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [],
    totalCategorized: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
  });
  fetchListing = vi.fn<typeof globalThis.fetch>(async () => {
    return new Response(listing);
  });
  vi.stubGlobal("fetch", fetchListing);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function withGeometry(value: unknown): string {
  return toploHtml().replace(JSON.stringify(pointGeometry.features), JSON.stringify(value));
}

describe("Toplo package handoff", () => {
  it("keeps the catalog identity and emergent classification", () => {
    expect(metadata).toEqual({
      id: "toplo-bg",
      name: "Топлофикация София",
      url: "https://toplo.bg/accidents-and-maintenance",
      localities: ["bg.sofia"],
      emergent: true,
    });
  });

  it("passes exact listing content and precomputed geometry through ingestion once", async () => {
    await crawl();

    expect(store.records.get(itemId)).toEqual({
      url: identifier,
      sourceType: "toplo-bg",
      locality: "bg.sofia",
      title: "Ремонт",
      message: expectedMessage,
      markdownText: expectedMessage,
      datePublished: "2026-10-04T08:00:00.000Z",
      deepLinkUrl: "",
      geoJson: geometryJson,
      categories: ["heating"],
      isRelevant: true,
      timespanStart: new Date("2026-10-04T08:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T08:00:00.000Z"),
      crawledAt: contractDate,
      processed: false,
    });
    expect(await ingest({ sourceType: "toplo-bg" })).toMatchObject({
      total: 1,
      ingested: 1,
      failed: 0,
    });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(expectedMessage, "toplo-bg", {
      precomputedGeoJson: pointGeometry,
      sourceUrl: undefined,
      sourceDocumentId: itemId,
      boundaryFilter: undefined,
      crawledAt: contractDate,
      datePublished: "2026-10-04T08:00:00.000Z",
      markdownText: expectedMessage,
      categories: ["heating"],
      isRelevant: true,
      timespanStart: new Date("2026-10-04T08:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T08:00:00.000Z"),
      cityWide: undefined,
      locality: "bg.sofia",
    });

    // Seed completion owned by the downstream pipeline, where this smoke test stops.
    await store.sources.updateOne(itemId, { processed: true });
    await crawl();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.records.get(itemId)?.processed).toBe(true);
    expect((await ingest({ sourceType: "toplo-bg" })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(fetchListing).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchListing.mock.calls) {
      expect(url).toBe("https://toplo.bg/accidents-and-maintenance");
      expect(options?.signal?.aborted).toBe(true);
    }
  });

  it.each([
    { id: itemId, processed: false },
    { id: itemId, processed: true },
    { id: legacyId, processed: false },
    { id: legacyId, processed: true },
  ])("preserves historical $id with processed=$processed after provider changes", async ({ id, processed }) => {
    const historical = { url: identifier, title: "Historical content", processed };
    store.records.set(id, historical);
    listing = toploHtml(["item-1"], "2026-10-05T08:00:00.000Z")
      .replace('"Name":"Ремонт"', '"Name":"Changed provider content"');

    await crawl();

    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(id)).toBe(historical);
    expect(store.records.size).toBe(1);
    expect(fetchListing).toHaveBeenCalledOnce();
  });

  it("preserves unusual synthetic identifier spelling without a detail request", async () => {
    listing = toploHtml(["A%2fb?x=1&y=2"]);

    await crawl();

    expect(store.records.get("13b14cabde375a6af06dc1725332fb5d")?.url).toBe(
      "https://toplo.bg/incidents/A%2fb?x=1&y=2",
    );
    expect(fetchListing).toHaveBeenCalledExactlyOnceWith(
      "https://toplo.bg/accidents-and-maintenance",
      expect.objectContaining({ headers: { Accept: "text/html" } }),
    );
  });

  it.each([
    { start: "invalid", end: null, expectedStart: contractDate, expectedEnd: contractDate },
    {
      start: "2024-01-01T00:00:00.000Z",
      end: null,
      expectedStart: contractDate,
      expectedEnd: contractDate,
    },
    {
      start: "2026-10-04T08:00:00.000Z",
      end: "invalid",
      expectedStart: new Date("2026-10-04T08:00:00.000Z"),
      expectedEnd: new Date("2026-10-04T08:00:00.000Z"),
    },
    {
      start: "2026-10-04T08:00:00.000Z",
      end: "2026-10-03T08:00:00.000Z",
      expectedStart: new Date("2026-10-04T08:00:00.000Z"),
      expectedEnd: new Date("2026-10-03T08:00:00.000Z"),
    },
  ])("preserves provider date $start and legacy timespans with end=$end", async ({ start, end, expectedStart, expectedEnd }) => {
    listing = toploHtml(["item-1"], start).replace('"UntilDate":null', `"UntilDate":${JSON.stringify(end)}`);

    await crawl();

    expect(store.records.get(itemId)).toMatchObject({
      datePublished: start,
      timespanStart: expectedStart,
      timespanEnd: expectedEnd,
    });
  });

  it.each([
    {
      name: "partially invalid features and swapped Point coordinates",
      geometry: [
        { type: "Feature", geometry: { type: "Point", coordinates: [42.7, 23.32] }, properties: {} },
        { type: "Feature", geometry: { type: "Point", coordinates: [999, 999] }, properties: {} },
      ],
      expected: geometryJson,
    },
    {
      name: "a swapped LineString",
      geometry: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[42.7, 23.32], [42.71, 23.33]] }, properties: {} },
      ],
      expected: '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[23.32,42.7],[23.33,42.71]]},"properties":{}}]}',
    },
    {
      name: "an empty FeatureCollection",
      geometry: { type: "FeatureCollection", features: [] },
      expected: '{"type":"FeatureCollection","features":[]}',
    },
  ])("preserves legacy normalization for $name", async ({ geometry, expected }) => {
    listing = withGeometry(geometry);

    await crawl();

    expect(store.records.get(itemId)?.geoJson).toBe(expected);
  });

  it("saves large cached geometry and unrelated incidents without oversized discovery payloads", async () => {
    const largeNote = "x".repeat(270_000);
    const largeGeometry = [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [23.32, 42.7] },
      properties: { note: largeNote },
    }];
    listing = toploHtml(["item-1", "item-2"])
      .replace(JSON.stringify(pointGeometry.features), JSON.stringify(largeGeometry));

    await crawl();

    expect(store.records.size).toBe(2);
    const geometry: unknown = JSON.parse(String(store.records.get(itemId)?.geoJson));
    expect(geometry).toEqual({ type: "FeatureCollection", features: largeGeometry });
    expect(store.records.get("88df5870f23267ba483802452310c670")?.message).toBe(expectedMessage);
    expect(fetchListing).toHaveBeenCalledOnce();
  });
});
