// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataSource, SourceMetadata } from "@oboapp/source-sdk";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { encodeDocumentId } from "@/crawlers/shared/firestore";
import { getDb } from "@/lib/db";
import { runSource } from "@/sources/run-source";
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

const metadata: SourceMetadata = {
  id: "citywide-fixture",
  name: "City-wide fixture",
  url: "https://example.com/warnings",
  localities: ["bg.sofia"],
};
const identifier = "https://example.com/warnings?date=2026-10-04&h=abc123";
const geometry = { type: "FeatureCollection", features: [] };
let store: ReturnType<typeof createSourceStore>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [],
    totalCategorized: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each([true, false, undefined])("passes city-wide scope %s from source content through raw storage to ingestion", async (cityWide) => {
  const content = {
    title: "Weather warning",
    message: "Strong wind",
    datePublished: contractDate.toISOString(),
    geoJson: geometry,
    categories: ["weather"],
    isRelevant: true,
    ...(cityWide === undefined ? {} : { cityWide }),
  };
  const source: DataSource = {
    discoverItems: vi.fn().mockResolvedValue({ items: [{ identifier }] }),
    fetchItem: vi.fn().mockResolvedValue(content),
    close: vi.fn(),
  };
  const createSource = () => source;

  expect(await runSource(store.db, metadata, createSource)).toEqual({
    saved: 1,
    skipped: 0,
    failed: 0,
  });
  expect(store.records.get(encodeDocumentId(identifier))).toEqual({
    ...content,
    geoJson: JSON.stringify(geometry),
    url: identifier,
    sourceType: metadata.id,
    locality: "bg.sofia",
    crawledAt: contractDate,
    processed: false,
  });
  expect(await ingest({ sourceType: metadata.id })).toMatchObject({
    total: 1,
    ingested: 1,
    failed: 0,
  });
  expect(messageIngest).toHaveBeenCalledExactlyOnceWith(content.message, metadata.id,
    expect.objectContaining({
      cityWide,
      precomputedGeoJson: geometry,
      sourceDocumentId: encodeDocumentId(identifier),
      locality: "bg.sofia",
    }),
  );
  expect(await runSource(store.db, metadata, createSource)).toEqual({
    saved: 0,
    skipped: 1,
    failed: 0,
  });
  expect(source.fetchItem).toHaveBeenCalledOnce();
  expect(source.close).toHaveBeenCalledTimes(2);
});

it("rejects invalid city-wide scope before persistence and retries it on the next scan", async () => {
  const content = {
    title: "Weather warning",
    message: "Strong wind",
    datePublished: contractDate.toISOString(),
    cityWide: true,
    geoJson: geometry,
  };
  const source: DataSource = {
    discoverItems: vi.fn().mockResolvedValue({ items: [{ identifier }] }),
    fetchItem: vi.fn()
      .mockResolvedValueOnce({ ...content, cityWide: "true" })
      .mockResolvedValue(content),
    close: vi.fn(),
  };
  const createSource = () => source;

  expect(await runSource(store.db, metadata, createSource)).toEqual({
    saved: 0,
    skipped: 0,
    failed: 1,
  });
  expect(store.records.size).toBe(0);
  expect(store.client.createOne).not.toHaveBeenCalled();
  expect(await runSource(store.db, metadata, createSource)).toEqual({
    saved: 1,
    skipped: 0,
    failed: 0,
  });
  expect(store.records.get(encodeDocumentId(identifier))).toMatchObject({ cityWide: true });
  expect(source.fetchItem).toHaveBeenCalledTimes(2);
  expect(source.close).toHaveBeenCalledTimes(2);
});
