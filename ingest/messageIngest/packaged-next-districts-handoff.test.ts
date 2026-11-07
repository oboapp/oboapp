import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { crawl as crawlLozenets } from "@/crawlers/lozenets-sofia-bg/index";
import { crawl as crawlStudentski } from "@/crawlers/studentski-bg/index";
import { crawl as crawlSredets } from "@/crawlers/sredec-sofia-org/index";
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
    sourceType: "lozenets-sofia-bg",
    hostname: "lozenets.sofia.bg",
    crawl: crawlLozenets,
    itemId: "49cade97da4a079256a6b227d74e42b0",
    legacyId: "aHR0cHM6Ly9sb3plbmV0cy5zb2ZpYS5iZy9UZXN0JTJmUG9zdC8_eD0xJnk9Mg__",
    article: '<h1 class="single-post-title">Page title</h1><div class="single-blog-content entry"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><nav>Navigation</nav></div>',
    message: "Repair [Plan](https://example.com/plan.pdf)",
  },
  {
    sourceType: "studentski-bg",
    hostname: "studentski.bg",
    crawl: crawlStudentski,
    itemId: "92f1c07e317b7de95fa502968401e1ae",
    legacyId: "aHR0cHM6Ly9zdHVkZW50c2tpLmJnL1Rlc3QlMmZQb3N0Lz94PTEmeT0y",
    article: '<h1 class="single-post-title">Page title</h1><div class="entry-content"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><div class="comments">Comments</div></div>',
    message: "Repair [Plan](https://example.com/plan.pdf)",
  },
  {
    sourceType: "sredec-sofia-org",
    hostname: "sredec-sofia.org",
    crawl: crawlSredets,
    itemId: "327c61748a844d180792236f6804dd33",
    legacyId: "aHR0cHM6Ly9zcmVkZWMtc29maWEub3JnL1Rlc3QlMmZQb3N0Lz94PTEmeT0y",
    article: '<h1 class="single-post-title">Page title</h1><div class="single-blog-content entry"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><script>noise</script><style>noise</style><nav>Navigation</nav></div>',
    message: "Repair [Plan](https://example.com/plan.pdf)\n\nNavigation",
  },
];

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
let fetchFeed: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe.each(cases)("$sourceType published package handoff", ({
  sourceType,
  hostname,
  crawl,
  itemId,
  legacyId,
  article,
  message,
}) => {
  const identifier = `https://${hostname}/Test%2fPost/?x=1&y=2`;

  beforeEach(() => {
    document.body.innerHTML = article;
    fetchFeed = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (sourceType === "sredec-sofia-org"
          && (url.searchParams.has("paged")
            || !decodeURIComponent(url.pathname).includes("/полезна-информация/"))) {
        return new Response("<rss><channel></channel></rss>");
      }
      return new Response(`<rss><channel><item><title>RSS fallback</title>
        <link>${identifier.replaceAll("&", "&amp;")}</link>
        <pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate>
        </item></channel></rss>`);
    });
    vi.stubGlobal("fetch", fetchFeed);
  });

  async function scan() {
    const completion = crawl();
    await Promise.all([completion, vi.runAllTimersAsync()]);
  }

  it("preserves literal identity and complete content through ingestion and repeat scans", async () => {
    await scan();

    expect(store.records.get(itemId)).toEqual({
      url: identifier,
      sourceType,
      locality: "bg.sofia",
      title: "Page title",
      datePublished: "2026-10-01T08:00:00.000Z",
      message,
      processed: false,
      crawledAt: expect.any(Date),
    });
    expect(browser.page.goto).toHaveBeenCalledExactlyOnceWith(identifier, {
      waitUntil: "domcontentloaded",
    });
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
    expect(await ingest({ sourceType })).toMatchObject({ total: 1, ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(message, sourceType, expect.objectContaining({
      sourceDocumentId: itemId,
      sourceUrl: identifier,
      locality: "bg.sofia",
      datePublished: "2026-10-01T08:00:00.000Z",
    }));

    // Completion belongs to the downstream pipeline, where this handoff test stops.
    await store.sources.updateOne(itemId, { processed: true });
    await scan();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(itemId)?.processed).toBe(true);
    expect((await ingest({ sourceType })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(chromium.launch).toHaveBeenCalledOnce();
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
    expect(chromium.launch).not.toHaveBeenCalled();
    expect(browser.page.goto).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
  });

  it("closes a failed detail session and retries the absent item on the next scan", async () => {
    browser.page.goto.mockRejectedValueOnce(new Error("Provider unavailable"));

    await scan();

    expect(store.records.size).toBe(0);
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();

    await scan();

    expect(store.records.get(itemId)?.processed).toBe(false);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(browser.page.close).toHaveBeenCalledTimes(2);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("propagates a missing first feed before fetching details or writing records", async () => {
    fetchFeed.mockResolvedValueOnce(new Response("Feed unavailable", { status: 404 }));

    const failure = expect(crawl()).rejects.toThrow("RSS feed returned 404");
    await vi.runAllTimersAsync();
    await failure;

    expect(fetchFeed).toHaveBeenCalledOnce();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
