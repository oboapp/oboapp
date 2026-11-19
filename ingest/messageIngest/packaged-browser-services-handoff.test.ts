import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  createBrowserMock,
  createSourceStore,
  contractDate,
} from "@/__mocks__/source-contract";
import { crawl as crawlInspectorat } from "@/crawlers/inspectorat-so-org/index";
import { crawl as crawlSdvr } from "@/crawlers/sdvr-mvr-bg/index";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ingest } from "./from-sources";
import { messageIngest } from "./index";

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
}));
vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
}));
vi.mock("./index", () => ({
  messageIngest: vi.fn(),
}));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Literal identifiers match the independently packaged collectors' fixtures.
const cases = [
  {
    sourceType: "inspectorat-so-org",
    crawl: crawlInspectorat,
    indexUrl: "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8",
    identifier: "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/?newsid=%D0%BC%D0%B8%D0%B5%D0%BD%D0%B5%2f%D0%BF%D0%BE%D0%B4%D0%BB%D0%B5%D0%B7&x=1#notice",
    secondIdentifier: "https://inspectorat-so.org/?newsid=second",
    itemId: "a7084cdff569bf77c0d35adede0d9fb7",
    legacyId: "aHR0cHM6Ly9pbnNwZWN0b3JhdC1zby5vcmcvJUQwJUJEJUQwJUJFJUQwJUIyJUQwJUI4JUQwJUJEJUQwJUI4Lz9uZXdzaWQ9JUQwJUJDJUQwJUI4JUQwJUI1JUQwJUJEJUQwJUI1JTJmJUQwJUJGJUQwJUJFJUQwJUI0JUQwJUJCJUQwJUI1JUQwJUI3Jng9MSNub3RpY2U_",
    listingCard: '<section class="newsContent"><a class="titleLink" href="IDENTIFIER"><h2>Listing title</h2></a><span class="dateCreated">04.10.2026</span></section>',
    article: '<section itemprop="articleBody"><div class="col-md-12"><time>DETAIL_DATE</time><h2>Detail title</h2><div style="font-size:14pt"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><script>noise</script><nav>noise</nav><div class="article-info">noise</div></div></div></section>',
    detailDate: "04.10.2026",
    publicationDate: () => {
      return "2026-10-03T22:00:00.000Z";
    },
  },
  {
    sourceType: "sdvr-mvr-bg",
    crawl: crawlSdvr,
    indexUrl: "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8",
    identifier: "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/90155",
    secondIdentifier: "https://www.mvr.bg/sdvr/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8/90207",
    itemId: "12d0881f15d33633f0db89093a550c8c",
    legacyId: "aHR0cHM6Ly93d3cubXZyLmJnL3NkdnIvJUQwJUI4JUQwJUJEJUQxJTg0JUQwJUJFJUQxJTgwJUQwJUJDJUQwJUIwJUQxJTg2JUQwJUI4JUQwJUJFJUQwJUJEJUQwJUI1JUQwJUJELSVEMSU4NiVEMCVCNSVEMCVCRCVEMSU4MiVEMSU4QSVEMSU4MC8lRDAlQkYlRDElODAlRDAlQjUlRDElODElRDElODYlRDAlQjUlRDAlQkQlRDElODIlRDElOEElRDElODAvJUQwJUJEJUQwJUJFJUQwJUIyJUQwJUI4JUQwJUJEJUQwJUI4LzkwMTU1",
    listingCard: '<div class="card"><a class="card__title" href="IDENTIFIER">Listing title</a><div class="card__meta">04 Октомври 2026</div></div>',
    article: '<header class="page-content__header"><small>DETAIL_DATE</small><h1 class="page-title">Detail title</h1></header><article class="page-content"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p><script>noise</script><nav>noise</nav><img src="photo.jpg" alt="noise"></article>',
    detailDate: "04 Октомври 2026",
    publicationDate: () => {
      return new Date(2026, 9, 4).toISOString();
    },
  },
];

const message = "Repair [Plan](https://example.com/plan.pdf)";
const consumerRequire = createRequire(import.meta.url);
const sourceRequire = createRequire(consumerRequire.resolve("@oboapp/source-inspectorat-so-org"));
const helperRequire = createRequire(sourceRequire.resolve("@oboapp/source-web-utils/browser"));
const { chromium } = helperRequire("playwright") as typeof import("playwright");
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

describe.each(cases)("$sourceType published browser-service handoff", (source) => {
  let listing: string;
  let article: string;
  let detailReadAt: string | undefined;
  let statuses: Map<string, number>;

  function card(identifier: string): string {
    return source.listingCard.replace("IDENTIFIER", identifier.replaceAll("&", "&amp;"));
  }

  async function scan(): Promise<void> {
    await Promise.all([source.crawl(), vi.runAllTimersAsync()]);
  }

  beforeEach(() => {
    listing = card(source.identifier);
    article = source.article.replace("DETAIL_DATE", source.detailDate);
    detailReadAt = undefined;
    statuses = new Map();
    browser.page.goto.mockImplementation(async (url: string) => {
      document.body.innerHTML = url === source.indexUrl ? listing : article;
      if (url !== source.indexUrl) {
        detailReadAt = new Date().toISOString();
      }
      const status = statuses.get(url) ?? 200;
      return {
        ok() {
          return status >= 200 && status < 300;
        },
        status() {
          return status;
        },
      };
    });
  });

  it("persists complete legacy-compatible content, ingests it and skips the next scan", async () => {
    await scan();
    expect([...store.records.keys()]).toEqual([source.itemId]);
    expect(store.records.get(source.itemId)).toEqual({
      url: source.identifier,
      sourceType: source.sourceType,
      locality: "bg.sofia",
      title: "Detail title",
      datePublished: source.publicationDate(),
      message,
      processed: false,
      crawledAt: expect.any(Date),
    });
    expect(browser.page.goto.mock.calls).toEqual([
      [source.indexUrl, { waitUntil: "domcontentloaded" }],
      [source.identifier, { waitUntil: "domcontentloaded" }],
    ]);
    expect(await ingest({ sourceType: source.sourceType })).toMatchObject({
      total: 1,
      ingested: 1,
      failed: 0,
    });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(
      message,
      source.sourceType,
      expect.objectContaining({
        sourceDocumentId: source.itemId,
        sourceUrl: source.identifier,
        locality: "bg.sofia",
        datePublished: source.publicationDate(),
      }),
    );

    // Completion belongs to the downstream pipeline beyond this handoff.
    await store.sources.updateOne(source.itemId, { processed: true });
    article = "Provider content changed";
    await scan();
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(source.itemId)?.processed).toBe(true);
    expect((await ingest({ sourceType: source.sourceType })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(browser.page.goto.mock.calls.map(([url]) => {
      return url;
    })).toEqual([source.indexUrl, source.identifier, source.indexUrl]);
    expect(browser.page.close).toHaveBeenCalledTimes(3);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("preserves both historical document IDs in either processing state", async () => {
    for (const id of [source.itemId, source.legacyId]) {
      for (const processed of [false, true]) {
        const record = {
          url: source.identifier,
          title: "Historical content",
          processed,
        };
        store.records.clear();
        store.records.set(id, record);
        await scan();
        expect(store.records.size).toBe(1);
        expect(store.records.get(id)).toBe(record);
      }
    }
    expect(browser.page.goto).toHaveBeenCalledTimes(4);
    expect(browser.page.close).toHaveBeenCalledTimes(4);
    expect(browser.browser.close).toHaveBeenCalledTimes(4);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
  });

  it("continues after an HTTP detail failure and retries it while skipping saved content", async () => {
    listing += card(source.secondIdentifier);
    statuses.set(source.identifier, 403);
    await scan();
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({
        url: source.secondIdentifier,
        message,
        processed: false,
      }),
    ]);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: source.sourceType,
      saved: 1,
      skipped: 0,
      failed: 1,
    });
    expect(browser.page.close).toHaveBeenCalledTimes(3);
    expect(browser.browser.close).toHaveBeenCalledOnce();

    statuses.delete(source.identifier);
    await scan();
    expect(store.records.size).toBe(2);
    expect(store.records.get(source.itemId)?.message).toBe(message);
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType: source.sourceType,
      saved: 1,
      skipped: 1,
      failed: 0,
    });
    expect(browser.page.goto.mock.calls.map(([url]) => {
      return url;
    })).toEqual([source.indexUrl, source.identifier, source.secondIdentifier, source.indexUrl, source.identifier]);
    expect(browser.page.close).toHaveBeenCalledTimes(5);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("propagates an HTTP listing failure and closes its session without persistence", async () => {
    statuses.set(source.indexUrl, 503);
    await expect(scan()).rejects.toThrow(`HTTP 503 while loading ${source.indexUrl}`);
    expect(browser.page.evaluate).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("retries invalid details later without writing incomplete raw records", async () => {
    article = article.replace("Detail title", "");
    await scan();
    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    article = source.article.replace("DETAIL_DATE", source.detailDate);
    await scan();
    expect(store.records.get(source.itemId)?.message).toBe(message);
    expect(browser.page.close).toHaveBeenCalledTimes(4);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("preserves scan-time fallback for an unreadable detail date", async () => {
    article = source.article.replace("DETAIL_DATE", "Unreadable date");
    await scan();
    expect(detailReadAt).toBeDefined();
    expect(store.records.get(source.itemId)?.datePublished).toBe(detailReadAt);
    expect(store.records.get(source.itemId)?.message).toBe(message);
  });

  if (source.sourceType === "inspectorat-so-org") {
    it("uses the listing date when the detail date is empty", async () => {
      article = source.article.replace("DETAIL_DATE", "");
      await scan();
      expect(store.records.get(source.itemId)?.datePublished).toBe("2026-10-03T22:00:00.000Z");
    });
  }
});
