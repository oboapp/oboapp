import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import {
  createBrowserMock,
  createSourceStore,
  contractDate,
} from "@/__mocks__/source-contract";
import { crawl as crawlOborishte } from "@/crawlers/rayon-oborishte-bg/index";
import { crawl as crawlSlatina } from "@/crawlers/so-slatina-org/index";
import { getDb } from "@/lib/db";
import { reportSourceWarning } from "@/lib/sentry";
import { ingest } from "./from-sources";
import { messageIngest } from "./index";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("@/messageIngest/index", () => ({
  messageIngest: vi.fn(),
}));
vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
}));
vi.mock("@/lib/sentry", () => ({
  reportSourceWarning: vi.fn(),
}));

const cases = [
  {
    sourceType: "rayon-oborishte-bg",
    crawl: crawlOborishte,
    feedUrl: "https://rayon-oborishte.bg/feed/",
    url: "https://rayon-oborishte.bg/%d1%80%d0%b5%d0%bc%d0%be%d0%bd%d1%82/?id=1",
    itemId: "6513b033c4e69800675d8c7c11ab1f2f",
    legacyId: "aHR0cHM6Ly9yYXlvbi1vYm9yaXNodGUuYmcvJWQxJTgwJWQwJWI1JWQwJWJjJWQwJWJlJWQwJWJkJWQxJTgyLz9pZD0x",
    article: '<article><p>Road repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Navigation</nav></article>',
  },
  {
    sourceType: "so-slatina-org",
    crawl: crawlSlatina,
    feedUrl: "https://so-slatina.org/feed/",
    url: "https://so-slatina.org/repair/?id=1",
    itemId: "367a4c14091b4d0cf63fcd7f777ec4c4",
    legacyId: "aHR0cHM6Ly9zby1zbGF0aW5hLm9yZy9yZXBhaXIvP2lkPTE_",
    article: '<div id="content"><article><div class="item-content"><p>Road repair <a href="https://example.com/plan.pdf">Plan</a></p><div class="post-views">Views</div></div></article></div>',
  },
];

const oborishtePostsUrl = "https://rayon-oborishte.bg/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc";
const oborishteRecoveryCases = [
  {
    failure: "HTTP 503",
    readRss() {
      return new Response("Service unavailable", { status: 503 });
    },
    historicalId: cases[0].legacyId,
    processed: false,
  },
  {
    failure: "a transport error",
    readRss() {
      throw new TypeError("RSS connection reset");
    },
    historicalId: cases[0].itemId,
    processed: false,
  },
  {
    failure: "a timeout",
    readRss() {
      throw new DOMException("RSS request timed out", "TimeoutError");
    },
    historicalId: cases[0].legacyId,
    processed: true,
  },
  {
    failure: "a non-RSS response",
    readRss() {
      return new Response("<html><body>Temporarily unavailable</body></html>");
    },
    historicalId: cases[0].itemId,
    processed: true,
  },
];

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
let fetchFeed: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  browser = createBrowserMock();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  browser.page.evaluate.mockImplementation(async (callback, argument) => {
    return callback(argument);
  });
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
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe.each(cases)("$sourceType package handoff", ({
  sourceType,
  crawl,
  feedUrl,
  url,
  itemId,
  legacyId,
  article,
}) => {
  beforeEach(() => {
    document.body.innerHTML = article;
    fetchFeed = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (input !== feedUrl) {
        return new Response("Unexpected discovery endpoint", { status: 404 });
      }
      return new Response(`<rss><channel>
        <item><title>Feed title</title><link>${url}</link>
        <pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate>
        <description><![CDATA[<p>Feed excerpt</p>]]></description></item>
      </channel></rss>`);
    });
    vi.stubGlobal("fetch", fetchFeed);
  });

  it("requests the published discovery endpoint with RSS headers and a timeout signal", async () => {
    await crawl();

    expect(fetchFeed).toHaveBeenCalledExactlyOnceWith(
      feedUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
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
      for (const processed of [false, true]) {
        const historical = { url, title: "Historical content", processed };
        store.records.clear();
        store.records.set(id, historical);

        await crawl();

        expect(store.records.size).toBe(1);
        expect(store.records.get(id)).toBe(historical);
      }
    }
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  if (sourceType === "so-slatina-org") {
    it("propagates a first-page HTTP 415 without fetching details or writing records", async () => {
      fetchFeed.mockResolvedValueOnce(new Response("Unsupported Media Type", { status: 415 }));

      await expect(crawl()).rejects.toThrow(`RSS feed returned 415 for ${feedUrl}`);

      expect(fetchFeed).toHaveBeenCalledOnce();
      expect(store.records.size).toBe(0);
      expect(store.client.createOne).not.toHaveBeenCalled();
      expect(store.sources.setOne).not.toHaveBeenCalled();
      expect(chromium.launch).not.toHaveBeenCalled();
    });
  }

  it("leaves a failed page eligible for the next scan", async () => {
    browser.page.goto.mockRejectedValueOnce(new Error("Page unavailable"));
    await crawl();
    expect(store.records.size).toBe(0);
    expect(browser.browser.close).toHaveBeenCalledOnce();

    await crawl();
    expect(store.records.get(itemId)?.processed).toBe(false);
  });
});

describe("Oborishte discovery coverage", () => {
  it.each([
    { discovery: "root RSS", rssFails: false },
    { discovery: "WordPress API after RSS HTTP 415", rssFails: true },
  ])("preserves an auction and a repair through $discovery ingestion and repeat scans", async ({ rssFails }) => {
    const scanDate = new Date("2026-11-16T10:00:00.000Z");
    vi.setSystemTime(scanDate);
    const repair = cases[0];
    const auctionUrl = "https://rayon-oborishte.bg/%d0%be%d0%b1%d1%8f%d0%b2%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-%d0%bd%d0%b0-%d0%bf%d1%83%d0%b1%d0%bb%d0%b8%d1%87%d0%bd%d0%be-%d0%be%d0%bf%d0%be%d0%b2%d0%b5%d1%81%d1%82%d0%b5%d0%bd-%d0%ba%d0%be%d0%bd%d0%ba/";
    const auctionId = "a61a32f5b45719367e6f4535d41b76d8";
    const auctionTitle = "Обявление на публично оповестен конкурс";
    const auctionMessage = "Условия на публично оповестения конкурс.";
    fetchFeed = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (input === oborishtePostsUrl && rssFails) {
        return new Response(JSON.stringify([
          {
            link: auctionUrl,
            title: { rendered: auctionTitle },
            date_gmt: "2026-11-10T12:34:07",
            categories: [21],
          },
          {
            link: repair.url,
            title: { rendered: "Feed title" },
            date_gmt: "2026-10-04T08:00:00",
            categories: [54],
          },
        ]));
      }
      if (input === repair.feedUrl) {
        if (rssFails) {
          return new Response("Unsupported Media Type", { status: 415 });
        }
        return new Response(`<rss><channel>
          <item><title>${auctionTitle}</title><link>${auctionUrl}</link>
            <pubDate>Tue, 10 Nov 2026 12:34:07 +0000</pubDate>
            <category><![CDATA[Търгове и конкурси]]></category>
          </item>
          <item><title>Feed title</title><link>${repair.url}</link>
            <pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate>
            <category><![CDATA[Уведомления за ремонти и СМР]]></category>
          </item>
        </channel></rss>`);
      }
      return new Response("Unexpected discovery endpoint", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFeed);
    browser.page.goto.mockImplementation(async (url: string) => {
      document.body.innerHTML = url === auctionUrl
        ? `<article><p>${auctionMessage}</p></article>`
        : repair.article;
      return null;
    });

    await crawlOborishte();

    expect(fetchFeed).toHaveBeenNthCalledWith(1, repair.feedUrl, expect.objectContaining({
      headers: expect.objectContaining({ Accept: "application/rss+xml, application/xml, text/xml, */*" }),
      signal: expect.any(AbortSignal),
    }));
    if (rssFails) {
      expect(fetchFeed).toHaveBeenCalledTimes(2);
      expect(fetchFeed).toHaveBeenNthCalledWith(2, oborishtePostsUrl, expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
        signal: expect.any(AbortSignal),
      }));
      expect(reportSourceWarning).toHaveBeenCalledOnce();
    } else {
      expect(fetchFeed).toHaveBeenCalledOnce();
      expect(reportSourceWarning).not.toHaveBeenCalled();
    }
    expect(store.records.size).toBe(2);
    expect(store.records.get(auctionId)).toEqual({
      url: auctionUrl,
      sourceType: "rayon-oborishte-bg",
      locality: "bg.sofia",
      title: auctionTitle,
      datePublished: "2026-11-10T12:34:07.000Z",
      message: auctionMessage,
      crawledAt: scanDate,
      processed: false,
    });
    expect(store.records.get(repair.itemId)).toEqual({
      url: repair.url,
      sourceType: "rayon-oborishte-bg",
      locality: "bg.sofia",
      title: "Feed title",
      datePublished: "2026-10-04T08:00:00.000Z",
      message: "Road repair [Plan](https://example.com/plan.pdf)",
      crawledAt: scanDate,
      processed: false,
    });
    expect(browser.page.goto).toHaveBeenCalledTimes(2);
    expect(await ingest({ sourceType: "rayon-oborishte-bg" })).toMatchObject({
      total: 2,
      ingested: 2,
      failed: 0,
    });
    expect(messageIngest).toHaveBeenCalledWith(
      auctionMessage,
      "rayon-oborishte-bg",
      expect.objectContaining({
        sourceUrl: auctionUrl,
        sourceDocumentId: auctionId,
        datePublished: "2026-11-10T12:34:07.000Z",
      }),
    );

    for (const id of [auctionId, repair.itemId]) {
      await store.sources.updateOne(id, { processed: true });
    }
    const historicalAuction = store.records.get(auctionId);
    const historicalRepair = store.records.get(repair.itemId);

    await crawlOborishte();

    expect(store.records.size).toBe(2);
    expect(store.records.get(auctionId)).toBe(historicalAuction);
    expect(store.records.get(repair.itemId)).toBe(historicalRepair);
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(browser.page.goto).toHaveBeenCalledTimes(2);
    expect(chromium.launch).toHaveBeenCalledOnce();
    expect(reportSourceWarning).toHaveBeenCalledTimes(rssFails ? 2 : 0);
    expect(fetchFeed.mock.calls.map(([input]) => input)).toEqual(rssFails
      ? [repair.feedUrl, oborishtePostsUrl, repair.feedUrl, oborishtePostsUrl]
      : [repair.feedUrl, repair.feedUrl]);
  });

  it.each(oborishteRecoveryCases)("recovers from $failure and preserves historical records", async ({
    readRss,
    historicalId,
    processed,
  }) => {
    const source = cases[0];
    const historical = { url: source.url, title: "Historical content", processed };
    store.records.set(historicalId, historical);
    fetchFeed = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (input === source.feedUrl) {
        return readRss();
      }
      if (input === oborishtePostsUrl) {
        return new Response(JSON.stringify([{
          link: source.url,
          title: { rendered: "Updated upstream title" },
          date_gmt: "2026-10-04T08:00:00",
        }]));
      }
      return new Response("Unexpected discovery endpoint", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchFeed);

    await crawlOborishte();

    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(fetchFeed).toHaveBeenNthCalledWith(1, source.feedUrl, expect.any(Object));
    expect(fetchFeed).toHaveBeenNthCalledWith(2, oborishtePostsUrl, expect.objectContaining({
      headers: expect.objectContaining({ Accept: "application/json" }),
      signal: expect.any(AbortSignal),
    }));
    expect(reportSourceWarning).toHaveBeenCalledExactlyOnceWith(
      "RSS discovery failed; trying WordPress posts API",
      expect.objectContaining({
        sourceType: "rayon-oborishte-bg",
        diagnosticCode: "rss-discovery-failure",
        feedUrl: source.feedUrl,
        fallback: "wordpress-posts-api",
        error: expect.anything(),
      }),
    );
    expect(store.records.size).toBe(1);
    expect(store.records.get(historicalId)).toBe(historical);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(browser.page.goto).not.toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it("reports both discovery failures before fetching details or writing records", async () => {
    const feedUrl = cases[0].feedUrl;
    fetchFeed = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response("Service unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchFeed);

    await expect(crawlOborishte()).rejects.toThrow(
      `RSS discovery failed for ${feedUrl}: RSS feed returned 503 for ${feedUrl}; WordPress fallback failed: WordPress posts API returned 503 for ${oborishtePostsUrl}`,
    );

    expect(fetchFeed.mock.calls.map(([input]) => input)).toEqual([feedUrl, oborishtePostsUrl]);
    expect(reportSourceWarning).toHaveBeenCalledOnce();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it("keeps an empty successful RSS scan complete without API recovery", async () => {
    fetchFeed = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response("<rss><channel></channel></rss>");
    });
    vi.stubGlobal("fetch", fetchFeed);

    await crawlOborishte();

    expect(fetchFeed).toHaveBeenCalledExactlyOnceWith(cases[0].feedUrl, expect.any(Object));
    expect(reportSourceWarning).not.toHaveBeenCalled();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
