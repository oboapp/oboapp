import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, createSourceStore, contractDate, rawSource } from "@/__mocks__/source-contract";
import { toploHtml, weatherWarning, pointGeometry } from "@/__mocks__/source-contract-fixtures";
import { getDb } from "@/lib/db";
import { launchBrowser } from "@/crawlers/shared/browser";
import { fetchFeedXml } from "@/crawlers/shared/rss";
import { encodeDocumentId, saveSourceDocument } from "@/crawlers/shared/firestore";
import { crawl as crawlToplo } from "@/crawlers/toplo-bg/index";
import { crawl as crawlNimh } from "@/crawlers/nimh-severe-weather/index";
import { crawl as crawlFeed } from "@/crawlers/triaditsa-org/index";
import { crawl as crawlWebsite } from "@/crawlers/nadezhda-org/index";
import { messageIngest } from "./index";
import { ingest } from "./from-sources";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/crawlers/shared/browser", () => ({ launchBrowser: vi.fn() }));
vi.mock("@/crawlers/shared/rss", async (original) => ({ ...await original<typeof import("@/crawlers/shared/rss")>(), fetchFeedXml: vi.fn() }));
vi.mock("@/crawlers/nimh-severe-weather/parser", async (original) => ({ ...await original<typeof import("@/crawlers/nimh-severe-weather/parser")>(), parseWeatherPage: () => weatherWarning }));
vi.mock("@/crawlers/nadezhda-org/extractors", () => ({
  extractPostLinks: async () => [{ url: "https://nadezhda.sofia.bg/news/repair", title: "Repair", date: "04.10.2026" }],
  extractPostDetails: async () => ({ title: "Repair", dateText: "04.10.2026", contentHtml: "<p>Water repair</p>" }),
}));
vi.mock("@/geocoding/shared/boundary-utils", () => ({ loadBoundaries: () => null, isWithinBoundaries: () => true }));
vi.mock("@/lib/delay", () => ({ delay: vi.fn().mockResolvedValue(undefined) }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("./index", () => ({ messageIngest: vi.fn() }));

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
const result = { messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0 };
// Independent persisted contracts: missing crawler assignments must fail even
// when the consumer faithfully forwards the incomplete raw document.
const expectedContent: Record<string, Record<string, unknown>> = {
  "nadezhda-org": {
    title: "Repair", message: "Water repair", datePublished: "2026-10-04T00:00:00.000Z",
  },
  "triaditsa-org": {
    title: "Repair", message: "Water repair", datePublished: "2026-10-04T08:00:00.000Z",
  },
  "toplo-bg": {
    title: "Ремонт", message: expect.stringContaining("Ремонт"), markdownText: expect.stringContaining("ул. Тест"),
    datePublished: "2026-10-04T08:00:00.000Z", deepLinkUrl: "", geoJson: JSON.stringify(pointGeometry),
    categories: ["heating"], isRelevant: true,
    timespanStart: new Date("2026-10-04T08:00:00.000Z"), timespanEnd: new Date("2026-10-04T08:00:00.000Z"),
  },
  "nimh-severe-weather": {
    title: "Предупреждение за опасно време - 4 октомври 2026",
    message: "Жълт код за опасно време за 04.10.2026 (неделя)\n\nСилен вятър\n\nСилен вятър",
    markdownText: "**Жълт код за опасно време за 04.10.2026 (неделя)**\n\nСилен вятър\n\n**Жълт код за вятър**\n- Силен вятър",
    datePublished: "2026-10-04T08:00:00.000Z", geoJson: '{"type":"FeatureCollection","features":[]}',
    categories: ["weather"], isRelevant: true, cityWide: true,
    // Current builder uses a fixed +02:00 offset; changing timezone semantics is separate work.
    timespanStart: new Date("2026-10-03T22:00:00.000Z"), timespanEnd: new Date("2026-10-04T21:59:59.000Z"),
  },
};
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate);
  store = createSourceStore(); browser = createBrowserMock();
  browser.page.content.mockResolvedValue(toploHtml());
  vi.mocked(getDb).mockResolvedValue(store.db); vi.mocked(launchBrowser).mockResolvedValue(browser.instance);
  vi.mocked(messageIngest).mockReset().mockResolvedValue(result);
  vi.mocked(fetchFeedXml).mockResolvedValue(`<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Repair</title><link>https://triaditza.org/repair/</link><pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Water repair</p>]]></content:encoded></item></channel></rss>`);
});
afterEach(() => { vi.useRealTimers(); });

describe("crawler raw document to ingest contract", () => {
  it.each([
    { name: "website", crawl: crawlWebsite, url: "https://nadezhda.sofia.bg/news/repair", sourceType: "nadezhda-org" },
    { name: "full feed", crawl: crawlFeed, url: "https://triaditza.org/repair/", sourceType: "triaditsa-org" },
    { name: "synthetic listing", crawl: crawlToplo, url: "https://toplo.bg/incidents/item-1", sourceType: "toplo-bg" },
    { name: "city-wide listing", crawl: crawlNimh, url: "https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-10-04&h=c9d1456eab46", sourceType: "nimh-severe-weather" },
  ])("passes the persisted $name document through the actual ingest entrypoint", async ({ crawl, url, sourceType }) => {
    await crawl();
    const raw = store.records.get(encodeDocumentId(url));
    const expected = expectedContent[sourceType];
    expect(raw).toBeDefined();
    expect(raw).toMatchObject({ ...expected, url, sourceType, locality: "bg.sofia", processed: false, crawledAt: contractDate });
    const summary = await ingest({ sourceType, limit: 10 });
    expect(summary).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(store.sources.findMany).toHaveBeenCalledWith({ where: [{ field: "processed", op: "==", value: false }, { field: "sourceType", op: "==", value: sourceType }], limit: 10 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(expected.message, sourceType, {
      precomputedGeoJson: expected.geoJson ? JSON.parse(String(expected.geoJson)) : null,
      sourceUrl: expected.deepLinkUrl === "" ? undefined : url,
      sourceDocumentId: encodeDocumentId(url), boundaryFilter: undefined,
      crawledAt: contractDate, datePublished: expected.datePublished, markdownText: expected.markdownText,
      categories: expected.categories, isRelevant: expected.isRelevant, timespanStart: expected.timespanStart,
      timespanEnd: expected.timespanEnd, cityWide: expected.cityWide, locality: "bg.sofia",
    });
    if (sourceType === "triaditsa-org") expect(launchBrowser).not.toHaveBeenCalled();
    // Seed the downstream-owned completion state; this suite stops at messageIngest.
    await store.sources.updateOne(encodeDocumentId(url), { processed: true });
    vi.mocked(messageIngest).mockClear();
    await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    expect((await ingest()).total).toBe(0);
    expect(messageIngest).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "https://example.com/public"])("keeps identity independent of deepLinkUrl=%s", async (deepLinkUrl) => {
    await saveSourceDocument(rawSource({ deepLinkUrl, geoJson: pointGeometry, categories: ["water"] }), store.db);
    await ingest();
    expect(messageIngest).toHaveBeenCalledWith("Water repair", "sofiyska-voda", expect.objectContaining({
      sourceDocumentId: encodeDocumentId("https://example.com/item"),
      sourceUrl: deepLinkUrl === undefined ? "https://example.com/item" : deepLinkUrl || undefined,
      precomputedGeoJson: pointGeometry,
    }));
  });

  it("leaves a failed record retryable and continues with later sources", async () => {
    await saveSourceDocument(rawSource(), store.db);
    await saveSourceDocument(rawSource({ url: "https://example.com/second" }), store.db);
    vi.mocked(messageIngest).mockRejectedValueOnce(new Error("downstream unavailable"));
    expect(await ingest()).toMatchObject({ total: 2, ingested: 1, failed: 1 });
    expect(store.records.get(encodeDocumentId("https://example.com/item"))?.processed).toBe(false);
    expect(messageIngest).toHaveBeenCalledTimes(2);
    vi.mocked(messageIngest).mockClear();
    await store.sources.updateOne(encodeDocumentId("https://example.com/second"), { processed: true });
    expect(await ingest()).toMatchObject({ total: 1, ingested: 1, failed: 0 });
  });

  it.each([
    { field: "locality", value: undefined }, { field: "geoJson", value: "{invalid json" },
  ])("reports malformed persisted $field without marking it done", async ({ field, value }) => {
    store.records.set(encodeDocumentId("https://example.com/item"), { ...rawSource(), processed: false, [field]: value });
    expect(await ingest()).toMatchObject({ failed: 1, ingested: 0 });
    expect(messageIngest).not.toHaveBeenCalled(); expect(store.sources.updateOne).not.toHaveBeenCalled();
  });

  it("marks an empty text-only source done without sending it to AI", async () => {
    await saveSourceDocument(rawSource({ message: "  " }), store.db);
    await ingest();
    expect(messageIngest).not.toHaveBeenCalled();
    expect(store.sources.updateOne).toHaveBeenCalledWith(encodeDocumentId("https://example.com/item"), { processed: true });
  });
});
