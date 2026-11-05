import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { crawl as crawlOborishte } from "@/crawlers/rayon-oborishte-bg/index";
import { crawl as crawlSlatina } from "@/crawlers/so-slatina-org/index";
import { getDb } from "@/lib/db";
import { ingest } from "./from-sources";
import { messageIngest } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

const cases = [
  {
    sourceType: "rayon-oborishte-bg",
    crawl: crawlOborishte,
    url: "https://rayon-oborishte.bg/%d1%80%d0%b5%d0%bc%d0%be%d0%bd%d1%82/?id=1",
    itemId: "6513b033c4e69800675d8c7c11ab1f2f",
    legacyId: "aHR0cHM6Ly9yYXlvbi1vYm9yaXNodGUuYmcvJWQxJTgwJWQwJWI1JWQwJWJjJWQwJWJlJWQwJWJkJWQxJTgyLz9pZD0x",
    article: '<article><p>Road repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Navigation</nav></article>',
  },
  {
    sourceType: "so-slatina-org",
    crawl: crawlSlatina,
    url: "https://so-slatina.org/repair/?id=1",
    itemId: "367a4c14091b4d0cf63fcd7f777ec4c4",
    legacyId: "aHR0cHM6Ly9zby1zbGF0aW5hLm9yZy9yZXBhaXIvP2lkPTE_",
    article: '<div id="content"><article><div class="item-content"><p>Road repair <a href="https://example.com/plan.pdf">Plan</a></p><div class="post-views">Views</div></div></article></div>',
  },
];

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  store = createSourceStore();
  browser = createBrowserMock();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  browser.page.evaluate.mockImplementation(async (callback, argument) => callback(argument));
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [],
    totalCategorized: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe.each(cases)("$sourceType package handoff", ({ sourceType, crawl, url, itemId, legacyId, article }) => {
  beforeEach(() => {
    document.body.innerHTML = article;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<rss><channel>
      <item><title>Feed title</title><link>${url}</link>
      <pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate>
      <description><![CDATA[<p>Feed excerpt</p>]]></description></item>
    </channel></rss>`)));
  });

  it("passes the original URL, RSS date, page body and fallback title through ingestion once", async () => {
    await crawl();
    expect(store.records.get(itemId)).toMatchObject({
      url,
      sourceType,
      locality: "bg.sofia",
      title: "Feed title",
      datePublished: "2026-10-04T08:00:00.000Z",
      message: "Road repair [Plan](https://example.com/plan.pdf)",
      crawledAt: contractDate,
      processed: false,
    });
    expect(browser.page.goto).toHaveBeenCalledWith(url, { waitUntil: "domcontentloaded" });
    expect(browser.browser.close).toHaveBeenCalledOnce();
    expect(await ingest({ sourceType })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(
      "Road repair [Plan](https://example.com/plan.pdf)",
      sourceType,
      expect.objectContaining({
        sourceUrl: url,
        sourceDocumentId: itemId,
        locality: "bg.sofia",
        datePublished: "2026-10-04T08:00:00.000Z",
        crawledAt: contractDate,
      }),
    );

    await store.sources.updateOne(itemId, { processed: true });
    await crawl();
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.records.get(itemId)?.processed).toBe(true);
    expect((await ingest({ sourceType })).total).toBe(0);
  });

  it("skips existing historical base64 and MD5 documents without launching a browser", async () => {
    for (const id of [legacyId, itemId]) {
      store.records.clear();
      store.records.set(id, { url, processed: true });
      await crawl();
      expect(store.records.get(id)?.processed).toBe(true);
    }
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it("leaves a failed page eligible for the next scan", async () => {
    browser.page.goto.mockRejectedValueOnce(new Error("Page unavailable"));
    await crawl();
    expect(store.records.size).toBe(0);
    expect(browser.browser.close).toHaveBeenCalledOnce();

    await crawl();
    expect(store.records.get(itemId)?.processed).toBe(false);
  });
});
