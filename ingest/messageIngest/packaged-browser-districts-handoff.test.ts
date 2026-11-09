import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { crawl as crawlIlinden } from "@/crawlers/rayon-ilinden-bg/index";
import { crawl as crawlNadezhda } from "@/crawlers/nadezhda-org/index";
import { crawl as crawlIskar } from "@/crawlers/raioniskar-bg/index";
import { getDb } from "@/lib/db";
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
    sourceType: "rayon-ilinden-bg",
    crawl: crawlIlinden,
    indexUrl: "https://ilinden.sofia.bg/category/%d0%be%d0%b1%d1%89%d0%b8%d0%bd%d0%b0/",
    identifier: "https://ilinden.sofia.bg/Test%2fPost/?x=1&y=2",
    itemId: "b84891643e7f197daa9a3fdde8e419de",
    legacyId: "aHR0cHM6Ly9pbGluZGVuLnNvZmlhLmJnL1Rlc3QlMmZQb3N0Lz94PTEmeT0y",
    listingCard: '<article><h2><a href="IDENTIFIER">Listing title</a></h2><time>01.01.2000</time></article>',
    article: '<h1>Detail title</h1><time>03.10.2026</time><article><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Navigation</nav><style>noise</style></article>',
  },
  {
    sourceType: "nadezhda-org",
    crawl: crawlNadezhda,
    indexUrl: "https://nadezhda.sofia.bg/%D0%BE%D0%B1%D1%8F%D0%B2%D0%B8-%D0%B8-%D1%81%D1%8A%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D1%8F",
    identifier: "https://nadezhda.sofia.bg/news/Test%2fPost/?x=1&y=2",
    itemId: "2fd02fa4c199db22dc6a5dff03d0e032",
    legacyId: "aHR0cHM6Ly9uYWRlemhkYS5zb2ZpYS5iZy9uZXdzL1Rlc3QlMmZQb3N0Lz94PTEmeT0y",
    listingCard: '<li class="shadow-sm"><a href="IDENTIFIER">Listing title</a><small>01.01.2000</small></li>',
    article: '<div class="justify-content-center"><div><h1 class="pl-2">Detail title</h1><div class="bg-white mt-2"><small class="pl-2">03.10.2026</small><div class="p-2"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Navigation</nav><style>noise</style></div></div></div></div>',
  },
  {
    sourceType: "raioniskar-bg",
    crawl: crawlIskar,
    indexUrl: "https://raioniskar.bg/?c=pages/static&template=home&lang=bg",
    identifier: "https://raioniskar.bg/?c=important_messages/show/123&lang=bg",
    itemId: "11a94600f3c8abb8a04fce7bc7999bc5",
    legacyId: "aHR0cHM6Ly9yYWlvbmlza2FyLmJnLz9jPWltcG9ydGFudF9tZXNzYWdlcy9zaG93LzEyMyZsYW5nPWJn",
    listingCard: '<div class="articles list type-important_messages"><div class="article"><h2 class="title"><a href="IDENTIFIER">Listing title</a></h2><div class="date-and-category">01.01.2000</div></div></div>',
    article: '<h1 class="title">Detail title</h1><div class="date-and-category">03.10.2026</div><div class="articles view"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Navigation</nav><style>noise</style></div>',
  },
];

const message = "Repair [Plan](https://example.com/plan.pdf)";
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

describe.each(cases)("$sourceType browser package handoff", ({
  sourceType,
  crawl,
  indexUrl,
  identifier,
  itemId,
  legacyId,
  listingCard,
  article,
}) => {
  let listing: string;
  let detailHtml: string;
  let failedDetail: string | undefined;
  let detailReadAt: string | undefined;

  function card(url: string): string {
    return listingCard.replace("IDENTIFIER", url.replaceAll("&", "&amp;"));
  }

  beforeEach(() => {
    listing = card(identifier);
    detailHtml = article;
    failedDetail = undefined;
    detailReadAt = undefined;
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
      return null;
    });
  });

  async function scan(): Promise<void> {
    const completion = crawl();
    await Promise.all([completion, vi.runAllTimersAsync()]);
  }

  it("preserves literal identity and detail content through ingestion and repeat scans", async () => {
    await scan();

    expect(store.records.get(itemId)).toEqual({
      url: identifier,
      sourceType,
      locality: "bg.sofia",
      title: "Detail title",
      datePublished: "2026-10-03T00:00:00.000Z",
      message,
      processed: false,
      crawledAt: expect.any(Date),
    });
    expect(browser.page.goto.mock.calls).toEqual([
      [indexUrl, { waitUntil: "domcontentloaded" }],
      [identifier, { waitUntil: "domcontentloaded" }],
    ]);
    expect(browser.page.close).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledOnce();
    expect(await ingest({ sourceType })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(message, sourceType, expect.objectContaining({
      sourceDocumentId: itemId,
      sourceUrl: identifier,
      locality: "bg.sofia",
      datePublished: "2026-10-03T00:00:00.000Z",
    }));

    // The downstream pipeline owns completion beyond this handoff boundary.
    await store.sources.updateOne(itemId, { processed: true });
    await scan();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(itemId)?.processed).toBe(true);
    expect((await ingest({ sourceType })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(browser.page.goto.mock.calls.map(([url]) => {
      return url;
    })).toEqual([indexUrl, identifier, indexUrl]);
    expect(browser.page.close).toHaveBeenCalledTimes(3);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("preserves historical MD5 and base64 records in either processing state without fetching details", async () => {
    for (const historicalId of [itemId, legacyId]) {
      for (const processed of [false, true]) {
        const historical = {
          url: identifier,
          title: "Historical content",
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

  it("closes failed detail pages and retries absent records on a later scan", async () => {
    failedDetail = identifier;

    await scan();

    expect(store.records.size).toBe(0);
    expect(browser.page.close).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledOnce();

    failedDetail = undefined;
    await scan();

    expect(store.records.get(itemId)?.processed).toBe(false);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(browser.page.close).toHaveBeenCalledTimes(4);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("continues with another candidate after an individual detail failure", async () => {
    const secondIdentifier = `${identifier}&second=1`;
    listing += card(secondIdentifier);
    failedDetail = identifier;

    await scan();

    expect(store.records.has(itemId)).toBe(false);
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({ url: secondIdentifier, message, processed: false }),
    ]);
    expect(browser.page.close).toHaveBeenCalledTimes(3);
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("propagates listing failures before fetching details or writing records", async () => {
    browser.page.goto.mockRejectedValueOnce(new Error("Listing unavailable"));

    const failure = expect(crawl()).rejects.toThrow("Listing unavailable");
    await vi.runAllTimersAsync();
    await failure;

    expect(browser.page.goto).toHaveBeenCalledExactlyOnceWith(indexUrl, {
      waitUntil: "domcontentloaded",
    });
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("requires a detail title even when the listing supplies a title", async () => {
    detailHtml = article.replace("Detail title", "");

    await scan();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it("uses scan time for an unreadable detail date even when the listing supplies a date", async () => {
    detailHtml = article.replace("03.10.2026", "Unreadable date");

    await scan();

    expect(detailReadAt).toBeDefined();
    expect(store.records.get(itemId)?.datePublished).toBe(detailReadAt);
    expect(store.records.get(itemId)?.message).toBe(message);
  });

  it("leaves an empty listing without raw records and closes its browser", async () => {
    listing = "<main>No current notices</main>";

    await scan();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.page.goto).toHaveBeenCalledExactlyOnceWith(indexUrl, {
      waitUntil: "domcontentloaded",
    });
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });
});
