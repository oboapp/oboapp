// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-nimh-severe-weather/metadata";
import sourceDefinition from "../../../shared/src/sources/nimh-severe-weather";
import { createBrowserMock, createSourceStore } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface FrozenWarning {
  identifier: string;
  content: {
    title: string;
    datePublished: string;
    message: string;
    markdownText: string;
    geoJson: { type: "FeatureCollection"; features: [] };
    categories: string[];
    isRelevant: boolean;
    cityWide: boolean;
    timespanStart: string;
    timespanEnd: string;
  };
}

function readFixture(name: string): string {
  return readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

// Expectations were frozen from the legacy parser and builders before conversion.
const entityWarning = JSON.parse(readFixture("active-entities.expected.json")) as FrozenWarning;
const legacyWarning = JSON.parse(readFixture("legacy-wind.expected.json")) as FrozenWarning;
const entityHtml = readFixture("active-entities.html");
const noDangerHtml = readFixture("no-danger.html");
const legacyHtml = readFixture("legacy-wind.html");
const clock = new Date("2026-02-01T12:00:00.000Z");
const entityId = "2396bae10fb38f0f53a8eef496205d9f";
const entityLegacyId = "aHR0cHM6Ly93ZWF0aGVyLmJnL29ic2h0aW5pL2luZGV4LnBocD96PXUmbz1TT0YmZGF0ZT0yMDI2LTAyLTAxJmg9NGFmNjMxMmJkYTBi";
const windId = "0dace604ebb1f2c761abb7af196af61e";
const windLegacyId = "aHR0cHM6Ly93ZWF0aGVyLmJnL29ic2h0aW5pL2luZGV4LnBocD96PXUmbz1TT0YmZGF0ZT0yMDI2LTEwLTA0Jmg9YzlkMTQ1NmVhYjQ2";
const consumerRequire = createRequire(import.meta.url);
const sourceRequire = createRequire(consumerRequire.resolve("@oboapp/source-nimh-severe-weather"));
const { chromium } = sourceRequire("playwright") as typeof import("playwright");
let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  browser = createBrowserMock();
  browser.page.content.mockResolvedValue(entityHtml);
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockReset().mockResolvedValue({
    messages: [],
    totalCategorized: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function expectedRaw(warning: FrozenWarning): Record<string, unknown> {
  return {
    ...warning.content,
    url: warning.identifier,
    sourceType: metadata.id,
    locality: "bg.sofia",
    geoJson: JSON.stringify(warning.content.geoJson),
    timespanStart: new Date(warning.content.timespanStart),
    timespanEnd: new Date(warning.content.timespanEnd),
    crawledAt: new Date(),
    processed: false,
  };
}

describe("published NIMH package to ingestion", () => {
  it("keeps the catalog identity and non-emergent classification", () => {
    expect(metadata).toEqual(sourceDefinition);
    expect(metadata).toEqual({
      id: "nimh-severe-weather",
      name: "НИМХ - Опасно време",
      url: "https://weather.bg/obshtini/index.php?z=u&o=SOF",
      localities: ["bg.sofia"],
    });
  });

  it("persists complete browser-serialized content and passes exact city-wide fields to ingestion", async () => {
    await crawl();

    expect(store.records.get(entityId)).toEqual(expectedRaw(entityWarning));
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(await ingest({ sourceType: metadata.id, limit: 10 })).toMatchObject({
      total: 1,
      ingested: 1,
      failed: 0,
    });
    expect(store.sources.findMany).toHaveBeenCalledWith({
      where: [
        { field: "processed", op: "==", value: false },
        { field: "sourceType", op: "==", value: metadata.id },
      ],
      limit: 10,
    });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(entityWarning.content.message, metadata.id, {
      precomputedGeoJson: entityWarning.content.geoJson,
      sourceUrl: entityWarning.identifier,
      sourceDocumentId: entityId,
      boundaryFilter: undefined,
      crawledAt: clock,
      datePublished: entityWarning.content.datePublished,
      markdownText: entityWarning.content.markdownText,
      categories: ["weather"],
      isRelevant: true,
      timespanStart: new Date("2026-01-31T22:00:00.000Z"),
      timespanEnd: new Date("2026-02-01T21:59:59.000Z"),
      cityWide: true,
      locality: "bg.sofia",
    });

    // Completion belongs to the downstream pipeline beyond this handoff.
    await store.sources.updateOne(entityId, { processed: true });
    await crawl();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.records.get(entityId)?.processed).toBe(true);
    expect((await ingest({ sourceType: metadata.id })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(browser.page.goto.mock.calls).toEqual([
      [metadata.url, { waitUntil: "networkidle", timeout: 30_000 }],
      [metadata.url, { waitUntil: "networkidle", timeout: 30_000 }],
    ]);
    expect(chromium.launch).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous wind warning URL, text and fixed +02:00 autumn timespan", async () => {
    vi.setSystemTime(new Date("2026-10-04T09:15:00.000Z"));
    browser.page.content.mockResolvedValue(legacyHtml);

    await crawl();

    expect(legacyWarning.identifier).toBe(
      "https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-10-04&h=c9d1456eab46",
    );
    expect(store.records.get(windId)).toEqual(expectedRaw(legacyWarning));
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledWith(legacyWarning.content.message, metadata.id, expect.objectContaining({
      sourceDocumentId: windId,
      sourceUrl: legacyWarning.identifier,
      timespanStart: new Date("2026-10-03T22:00:00.000Z"),
      timespanEnd: new Date("2026-10-04T21:59:59.000Z"),
      cityWide: true,
    }));
  });

  it.each([
    { id: entityId, html: entityHtml, identifier: entityWarning.identifier, processed: false },
    { id: entityId, html: entityHtml, identifier: entityWarning.identifier, processed: true },
    { id: entityLegacyId, html: entityHtml, identifier: entityWarning.identifier, processed: false },
    { id: entityLegacyId, html: entityHtml, identifier: entityWarning.identifier, processed: true },
    { id: windId, html: legacyHtml, identifier: legacyWarning.identifier, processed: false },
    { id: windId, html: legacyHtml, identifier: legacyWarning.identifier, processed: true },
    { id: windLegacyId, html: legacyHtml, identifier: legacyWarning.identifier, processed: false },
    { id: windLegacyId, html: legacyHtml, identifier: legacyWarning.identifier, processed: true },
  ])("preserves historical $id with processed=$processed", async ({ id, html, identifier, processed }) => {
    const historical = { url: identifier, title: "Historical content", processed };
    store.records.set(id, historical);
    browser.page.content.mockResolvedValue(html);

    await crawl();

    expect(store.records.size).toBe(1);
    expect(store.records.get(id)).toBe(historical);
    expect(store.sources.findById).toHaveBeenCalledWith(id);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: metadata.id,
      saved: 0,
      skipped: 1,
      failed: 0,
    });
    expect(browser.page.goto).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it.each([false, true])("ignores prose-only updates and keeps processed=%s", async (processed) => {
    await crawl();
    await store.sources.updateOne(entityId, { processed });
    const original = store.records.get(entityId);
    browser.page.content.mockResolvedValue(entityHtml.replace(
      "<div>издадена на:",
      "<p>Обновена препоръка за гражданите</p><div>издадена на:",
    ));

    await crawl();

    expect(store.records.size).toBe(1);
    expect(store.records.get(entityId)).toBe(original);
    expect(store.records.get(entityId)?.processed).toBe(processed);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "severity",
      html: entityHtml.replace('class="yellow"', 'class="orange"'),
      identifier: "https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-02-01&h=ef5af1faf1de",
      id: "3ff663aed59e12e774e24706d1412f1f",
    },
    {
      name: "notes",
      html: entityHtml.replace("10°C", "11°C"),
      identifier: "https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-02-01&h=e0a9aba1831a",
      id: "10662b09c4d11e6d4dd3b431209e66e8",
    },
  ])("creates a new warning when structured $name changes", async ({ html, identifier, id }) => {
    await crawl();
    await store.sources.updateOne(entityId, { processed: true });
    const original = store.records.get(entityId);
    browser.page.content.mockResolvedValue(html);

    await crawl();

    expect(store.records.size).toBe(2);
    expect(store.records.get(entityId)).toBe(original);
    expect(store.records.get(id)).toMatchObject({ url: identifier, processed: false, cityWide: true });
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledWith(expect.any(String), metadata.id, expect.objectContaining({
      sourceDocumentId: id,
      sourceUrl: identifier,
      cityWide: true,
    }));
  });

  it("keeps no-danger scans empty and closes their browser", async () => {
    browser.page.content.mockResolvedValue(noDangerHtml);

    await crawl();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 0, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: metadata.id,
      saved: 0,
      skipped: 0,
      failed: 0,
    });
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("fails a completely unsuccessful write and retries without incomplete raw documents", async () => {
    store.client.createOne.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(crawl()).rejects.toThrow(/All NIMH/);

    expect(store.records.size).toBe(0);
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ total: 0, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: metadata.id,
      saved: 0,
      skipped: 0,
      failed: 1,
    });

    await crawl();

    expect(store.records.get(entityId)).toEqual(expectedRaw(entityWarning));
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("keeps a historical record unchanged after a lookup failure and skips it on retry", async () => {
    const historical = { url: entityWarning.identifier, title: "Historical content", processed: true };
    store.records.set(entityId, historical);
    store.sources.findById.mockRejectedValueOnce(new Error("Lookup unavailable"));

    await expect(crawl()).rejects.toThrow(/All NIMH/);
    await crawl();

    expect(store.records.size).toBe(1);
    expect(store.records.get(entityId)).toBe(historical);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it.each(["HTTP", "network", "parse"])("cleans up a failed %s discovery and retries the next scan", async (stage) => {
    if (stage === "HTTP") {
      browser.page.goto.mockResolvedValueOnce({ ok: () => false, status: () => 503 });
    } else if (stage === "network") {
      browser.page.goto.mockRejectedValueOnce(new Error("Network unavailable"));
    } else {
      browser.page.content.mockResolvedValueOnce("<html>Provider format changed</html>");
    }

    await expect(crawl()).rejects.toThrow();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith("Crawl complete", expect.anything());
    expect(browser.browser.close).toHaveBeenCalledOnce();

    await crawl();

    expect(store.records.get(entityId)).toEqual(expectedRaw(entityWarning));
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("retries a failed browser launch without writing content", async () => {
    vi.mocked(chromium.launch).mockRejectedValueOnce(new Error("Browser unavailable"));

    await expect(crawl()).rejects.toThrow("Browser unavailable");

    expect(store.records.size).toBe(0);
    expect(browser.browser.newPage).not.toHaveBeenCalled();

    await crawl();

    expect(store.records.get(entityId)).toEqual(expectedRaw(entityWarning));
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("propagates database setup failures before opening the provider", async () => {
    vi.mocked(getDb).mockRejectedValueOnce(new Error("Database unavailable"));

    await expect(crawl()).rejects.toThrow("Database unavailable");

    expect(chromium.launch).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
  });
});
