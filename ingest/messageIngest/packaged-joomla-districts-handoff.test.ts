import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import {
  createBrowserMock,
  createSourceStore,
  contractDate,
} from "@/__mocks__/source-contract";
import { crawl as crawlMladost } from "@/crawlers/mladost-bg/index";
import { crawl as crawlVrabnitsa } from "@/crawlers/vrabnitsa-org/index";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";

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
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const cases = [
  {
    sourceType: "mladost-bg",
    crawl: crawlMladost,
    indexUrl: "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti",
    identifier: "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti/Test%2fPost/?x=1&y=2",
    itemId: "fb461e86a63f48273a19b0e8416fb386",
    legacyId: "aHR0cHM6Ly9tbGFkb3N0LmJnL2dyYWRza2EtaS1va29sbmEtc3JlZGEvcGxhbm92aS1yZW1vbnRpL1Rlc3QlMmZQb3N0Lz94PTEmeT0y",
    listingCard: '<article class="blog-card"><h3 class="blog-card__title"><a href="IDENTIFIER">Listing title</a></h3><time>01 Януари 2000</time></article>',
    article: '<h1 class="article-title">Detail title</h1><time datetime="2020-01-01T10:00:00Z">03 Октомври 2026</time><div class="article-body"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Keep navigation</nav><script>noise</script><style>noise</style></div>',
    expectedMessage: "Repair [Plan](https://example.com/plan.pdf)\n\nKeep navigation",
    publicationDate: () => {
      return new Date(2026, 9, 3, 0, 0, 0, 0).toISOString();
    },
    unreadableDateArticle: '<h1 class="article-title">Detail title</h1><time datetime="2026-10-03T10:00:00Z">Unreadable date</time><div class="article-body"><p>Repair</p></div>',
    normalizedDateArticle: '<h1 class="article-title">Detail title</h1><time datetime="2020-01-01T10:00:00Z">03\nОктомври\t2026</time><div class="article-body"><p>Repair</p></div>',
    prefixedDateUsesFallback: true,
  },
  {
    sourceType: "vrabnitsa-org",
    crawl: crawlVrabnitsa,
    indexUrl: "https://vrabnitsa.sofia.bg/aktualno/news",
    identifier: "https://vrabnitsa.sofia.bg/aktualno/news/Test%2fPost/?x=1&y=2",
    itemId: "e0581dedf2919558fc2406beea137607",
    legacyId: "aHR0cHM6Ly92cmFibml0c2Euc29maWEuYmcvYWt0dWFsbm8vbmV3cy9UZXN0JTJmUG9zdC8_eD0xJnk9Mg__",
    listingCard: '<article class="blog-card so_article"><h3 class="blog-card__title"><a href="IDENTIFIER">Listing title</a></h3><time>01 Януари 2000</time></article>',
    article: '<h1 class="article-title">Detail title</h1><time datetime="2026-10-03T10:22:16+03:00">Публикувано: 01 Септември 2026</time><div class="article-body"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><div class="navigation">Remove navigation</div><script>noise</script><style>noise</style></div>',
    expectedMessage: "Repair [Plan](https://example.com/plan.pdf)",
    publicationDate: () => {
      return "2026-10-03T07:22:16.000Z";
    },
    unreadableDateArticle: '<h1 class="article-title">Detail title</h1><time datetime="invalid">Публикувано: 03 Октомври 2026</time><div class="article-body"><p>Repair</p></div>',
    normalizedDateArticle: '<h1 class="article-title">Detail title</h1><time datetime="  ">Публикувано:\n 03\tОктомври 2026</time><div class="article-body"><p>Repair</p></div>',
    prefixedDateUsesFallback: false,
  },
];

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  browser = createBrowserMock();
  browser.page.evaluate.mockImplementation(async (callback, argument) => {
    return callback(argument);
  });
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  vi.mocked(getDb).mockResolvedValue(store.db);
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
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe.each(cases)("$sourceType published Joomla package handoff", ({
  sourceType,
  crawl,
  indexUrl,
  identifier,
  itemId,
  legacyId,
  listingCard,
  article,
  expectedMessage,
  publicationDate,
  unreadableDateArticle,
  normalizedDateArticle,
  prefixedDateUsesFallback,
}) => {
  let listing: string;
  let detailHtml: string;
  let failedDetail: string | undefined;
  let detailReadAt: string | undefined;
  let navigationStatuses: Map<string, number>;

  function card(url: string): string {
    return listingCard.replace("IDENTIFIER", url.replaceAll("&", "&amp;"));
  }

  beforeEach(() => {
    listing = card(identifier);
    detailHtml = article;
    failedDetail = undefined;
    detailReadAt = undefined;
    navigationStatuses = new Map();
    browser.page.goto.mockImplementation(async (url: string) => {
      if (url === failedDetail) {
        throw new Error("Detail unavailable");
      }
      if (url === indexUrl) {
        document.body.innerHTML = listing;
      } else {
        detailReadAt = new Date().toISOString();
        document.body.innerHTML = detailHtml;
      }
      const httpStatus = navigationStatuses.get(url) ?? 200;
      return {
        ok() {
          return httpStatus >= 200 && httpStatus < 300;
        },
        status() {
          return httpStatus;
        },
      };
    });
  });

  async function scan(): Promise<void> {
    const completion = crawl();
    await Promise.all([completion, vi.runAllTimersAsync()]);
  }

  it("preserves fixed historical identity, complete raw fields and actual ingestion handoff", async () => {
    await scan();

    expect([...store.records.keys()]).toEqual([itemId]);
    expect(store.records.get(itemId)).toEqual({
      url: identifier,
      sourceType,
      locality: "bg.sofia",
      title: "Detail title",
      datePublished: publicationDate(),
      message: expectedMessage,
      processed: false,
      crawledAt: expect.any(Date),
    });
    expect(store.client.createOne).toHaveBeenCalledExactlyOnceWith(
      "sources",
      store.records.get(itemId),
      itemId,
    );
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(browser.page.goto.mock.calls).toEqual([
      [indexUrl, { waitUntil: "domcontentloaded" }],
      [identifier, { waitUntil: "domcontentloaded" }],
    ]);
    expect(browser.page.close).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledOnce();

    expect(await ingest({ sourceType })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(expectedMessage, sourceType, expect.objectContaining({
      sourceDocumentId: itemId,
      sourceUrl: identifier,
      locality: "bg.sofia",
      datePublished: publicationDate(),
      crawledAt: expect.any(Date),
    }));

    // The real downstream pipeline owns completion beyond this handoff boundary.
    await store.sources.updateOne(itemId, { processed: true });
    await scan();
    expect(store.records.get(itemId)?.processed).toBe(true);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect((await ingest({ sourceType })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(browser.page.goto.mock.calls.map(([url]) => {
      return url;
    })).toEqual([indexUrl, identifier, indexUrl]);
  });

  it("skips literal MD5 and sanitized base64 identifiers in both processing states", async () => {
    for (const historicalId of [itemId, legacyId]) {
      for (const processed of [false, true]) {
        const historical = {
          url: identifier,
          title: "Historical content",
          sourceType,
          locality: "bg.sofia",
          processed,
        };
        store.records.clear();
        store.records.set(historicalId, historical);

        await scan();
        expect(store.records.size).toBe(1);
        expect(store.records.get(historicalId)).toBe(historical);
      }
    }
    expect(browser.page.goto).toHaveBeenCalledTimes(4);
    for (const [url] of browser.page.goto.mock.calls) {
      expect(url).toBe(indexUrl);
    }
    expect(browser.page.close).toHaveBeenCalledTimes(4);
    expect(browser.browser.close).toHaveBeenCalledTimes(4);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
  });

  it("never refetches a known unprocessed identifier when provider content changes", async () => {
    await scan();
    const stored = store.records.get(itemId);
    detailHtml = "Provider changed or removed this article";

    await scan();
    expect(store.records.get(itemId)).toBe(stored);
    expect(store.records.get(itemId)?.processed).toBe(false);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(browser.page.goto.mock.calls.map(([url]) => {
      return url;
    })).toEqual([indexUrl, identifier, indexUrl]);
  });

  it("retries a failed detail on the next scan without writing incomplete content", async () => {
    failedDetail = identifier;
    await scan();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.page.close).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledOnce();

    failedDetail = undefined;
    await scan();
    expect(store.records.get(itemId)?.processed).toBe(false);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(browser.page.close).toHaveBeenCalledTimes(4);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("continues with another listing item after a detail failure", async () => {
    const secondIdentifier = `${identifier}&second=1`;
    listing += card(secondIdentifier);
    failedDetail = identifier;

    await scan();
    expect(store.records.has(itemId)).toBe(false);
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({ url: secondIdentifier, message: expectedMessage, processed: false }),
    ]);
    expect(browser.page.close).toHaveBeenCalledTimes(3);
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("propagates listing failures before details or raw persistence", async () => {
    browser.page.goto.mockRejectedValueOnce(new Error("Listing unavailable"));

    await expect(scan()).rejects.toThrow("Listing unavailable");
    expect(browser.page.goto).toHaveBeenCalledExactlyOnceWith(indexUrl, {
      waitUntil: "domcontentloaded",
    });
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  if (sourceType === "mladost-bg") {
    it("rejects an HTTP 403 listing before extraction or raw persistence", async () => {
      navigationStatuses.set(indexUrl, 403);

      await expect(scan()).rejects.toThrow(`HTTP 403 while loading ${indexUrl}`);

      expect(browser.page.goto).toHaveBeenCalledExactlyOnceWith(indexUrl, {
        waitUntil: "domcontentloaded",
      });
      expect(browser.page.evaluate).not.toHaveBeenCalled();
      expect(store.records.size).toBe(0);
      expect(store.client.createOne).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith("Crawl complete", expect.anything());
      expect(browser.page.close).toHaveBeenCalledOnce();
      expect(browser.browser.close).toHaveBeenCalledOnce();
    });

    it("continues after an HTTP 403 detail and retries it while skipping saved content", async () => {
      const secondIdentifier = `${identifier}&second=1`;
      listing += card(secondIdentifier);
      navigationStatuses.set(identifier, 403);

      await scan();

      expect(store.records.has(itemId)).toBe(false);
      expect([...store.records.values()]).toEqual([{
        url: secondIdentifier,
        sourceType,
        locality: "bg.sofia",
        title: "Detail title",
        datePublished: publicationDate(),
        message: expectedMessage,
        processed: false,
        crawledAt: expect.any(Date),
      }]);
      expect(store.client.createOne).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        "Source item failed; retry on the next scheduled scan",
        expect.objectContaining({
          sourceType,
          identifier,
          error: expect.objectContaining({ message: `HTTP 403 while loading ${identifier}` }),
        }),
      );
      expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
        sourceType,
        saved: 1,
        skipped: 0,
        failed: 1,
      });
      expect(browser.page.evaluate).toHaveBeenCalledTimes(2);
      expect(browser.page.close).toHaveBeenCalledTimes(3);
      expect(browser.browser.close).toHaveBeenCalledOnce();

      navigationStatuses.delete(identifier);
      await scan();

      expect(store.records.size).toBe(2);
      expect(store.records.get(itemId)).toEqual({
        url: identifier,
        sourceType,
        locality: "bg.sofia",
        title: "Detail title",
        datePublished: publicationDate(),
        message: expectedMessage,
        processed: false,
        crawledAt: expect.any(Date),
      });
      expect(store.client.createOne).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
        sourceType,
        saved: 1,
        skipped: 1,
        failed: 0,
      });
      expect(browser.page.goto.mock.calls.map(([url]) => {
        return url;
      })).toEqual([indexUrl, identifier, secondIdentifier, indexUrl, identifier]);
      expect(browser.page.evaluate).toHaveBeenCalledTimes(4);
      expect(browser.page.close).toHaveBeenCalledTimes(5);
      expect(browser.browser.close).toHaveBeenCalledTimes(2);
    });
  }

  it("does not persist details with missing title or content", async () => {
    detailHtml = article.replace("Detail title", "");
    await scan();
    expect(store.records.size).toBe(0);

    detailHtml = '<h1 class="article-title">Detail title</h1><time>03 Октомври 2026</time>';
    await scan();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("retains provider-specific unreadable-date fallback through raw persistence", async () => {
    detailHtml = unreadableDateArticle;

    await scan();
    expect(detailReadAt).toBeDefined();
    expect(store.records.get(itemId)?.datePublished).toBe(detailReadAt);
    expect(store.records.get(itemId)?.message).toBe("Repair");
  });

  it("retains visible Bulgarian month-date whitespace semantics", async () => {
    detailHtml = normalizedDateArticle;

    await scan();
    expect(store.records.get(itemId)?.datePublished).toBe(new Date(2026, 9, 3).toISOString());
  });

  it("preserves each provider's publication-prefix behavior through ingestion", async () => {
    detailHtml = '<h1 class="article-title">Detail title</h1><time>Публикувано: 03 Октомври 2026</time><div class="article-body"><p>Repair</p></div>';

    await scan();

    const expectedDate = prefixedDateUsesFallback
      ? detailReadAt
      : new Date(2026, 9, 3).toISOString();
    expect(expectedDate).toBeDefined();
    expect(store.records.get(itemId)?.datePublished).toBe(expectedDate);
    expect(await ingest({ sourceType })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith("Repair", sourceType, expect.objectContaining({
      datePublished: expectedDate,
    }));
  });

  it("closes an HTTP 200 empty listing without raw writes", async () => {
    listing = "<main>No current notices</main>";

    await scan();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType,
      saved: 0,
      skipped: 0,
      failed: 0,
    });
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });
});
