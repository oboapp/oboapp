// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-sensor-community/metadata";
import { contractDate, createSourceStore } from "@/__mocks__/source-contract";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import type { ParsedReading } from "@/lib/air-quality/parse-sensor-response";
import { getDb } from "@/lib/db";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import catalog from "../../../shared/src/sources/sensor-community";
import { crawl } from "./index";

const { read } = vi.hoisted(() => ({
  read: vi.fn<(locality: string, from: Date, through: Date) => Promise<ParsedReading[]>>(),
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/air-quality/readings-store", () => ({
  createReadingsStore: () => ({ getReadingsInRange: read }),
}));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));

const identifier = "sensor-community://bg.sofia/r0c0/1791104400000";
const secondId = "sensor-community://bg.sofia/r0c1/1791104400000";
const itemId = encodeDocumentId(identifier);
let store: ReturnType<typeof createSourceStore>;

function readings(lng = 23.19): ParsedReading[] {
  return [1, 2, 3].map((sensorId) => ({
    sensorId, sensorType: "SDS011", lat: 42.61, lng, p1: 100, p2: 80,
    timestamp: new Date(contractDate.getTime() - 5 * 60_000),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  vi.mocked(getDb).mockResolvedValue(store.db);
  read.mockResolvedValue(readings());
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Sensor.Community package handoff", () => {
  it("preserves the half-hour identifier, four-hour store query and raw alert", async () => {
    expect(metadata).toEqual(catalog);
    await crawl();
    expect(read).toHaveBeenCalledExactlyOnceWith("bg.sofia", new Date("2026-10-04T05:15:00Z"), contractDate);
    const west = 23.188;
    const south = 42.605;
    const east = west + (23.528 - west) / 7;
    const north = south + (42.83 - south) / 7;
    const geoJson = {
      type: "FeatureCollection", features: [{
        type: "Feature", properties: {}, geometry: {
          type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
        },
      }],
    };
    expect(store.records.get(itemId)).toEqual({
      title: "Влошено качество на въздуха – r0c0", sourceType: metadata.id, locality: "bg.sofia",
      url: identifier, message: expect.stringContaining("PM2.5: 80.0, PM10: 100"),
      markdownText: expect.stringContaining("Измерено от 3 независими сензора"),
      geoJson, deepLinkUrl: "", categories: ["air-quality"], isRelevant: true,
      crawledAt: contractDate, datePublished: contractDate.toISOString(), processed: false,
      timespanStart: new Date("2026-10-04T07:15:00Z"), timespanEnd: contractDate,
    });
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(
      expect.any(String), metadata.id, expect.objectContaining({ sourceDocumentId: itemId, precomputedGeoJson: geoJson }),
    );
    await crawl();
    expect(store.client.createOne).toHaveBeenCalledOnce();
  });

  it.each(encodeDocumentIdForLookup(identifier))("skips the stored document with ID %s", async (id) => {
    for (const processed of [false, true]) {
      const record = { url: identifier, processed };
      store.records.set(id, record);
      await crawl();
      expect(store.records.get(id)).toBe(record);
    }
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it("continues after one cell fails to persist and retries it on the next scan", async () => {
    read.mockResolvedValue([...readings(), ...readings(23.24)]);
    store.client.createOne.mockRejectedValueOnce(new Error("Write unavailable"));
    await crawl();
    expect([...store.records.keys()]).toEqual([encodeDocumentId(secondId)]);
    await crawl();
    expect(store.records.size).toBe(2);
    expect(store.records.has(itemId)).toBe(true);
    expect(store.client.createOne).toHaveBeenCalledTimes(3);
  });

  it("propagates storage failures and accepts a healthy empty window", async () => {
    read.mockRejectedValueOnce(new Error("Readings unavailable")).mockResolvedValueOnce([]);
    await expect(crawl()).rejects.toThrow("Readings unavailable");
    await crawl();
    expect(store.client.createOne).not.toHaveBeenCalled();
  });
});
