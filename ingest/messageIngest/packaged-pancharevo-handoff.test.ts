import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contractDate,
  createBrowserMock,
  createSourceStore,
} from "@/__mocks__/source-contract";
import { crawl } from "@/crawlers/rayon-pancharevo-bg/index";
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

const sourceType = "rayon-pancharevo-bg";
const feedUrl = "https://www.pancharevo.org/gradska-i-okolna-sreda/planovi-remonti?format=feed&type=rss";
const identifier = "https://www.pancharevo.org/gradska-i-okolna-sreda/planovi-remonti/2488-repair%2fnotice?x=1&y=2#notice";
const itemId = "c86a4fe0cf005ec87a279da01fdd3914";
const secondIdentifier = "https://www.pancharevo.org/gradska-i-okolna-sreda/planovi-remonti/2489-repair";
const legacyIdentifier = "https://www.pancharevo.org/%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82%D0%B8-%D0%B8-%D0%B8%D0%BD%D1%84%D1%80%D0%B0%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0/2300-%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82?x=1&y=2#notice";
const historicalItemId = "1e23f217ab37761f809533824b52dada";
const historicalBase64Id = "aHR0cHM6Ly93d3cucGFuY2hhcmV2by5vcmcvJUQxJTgwJUQwJUI1JUQwJUJDJUQwJUJFJUQwJUJEJUQxJTgyJUQwJUI4LSVEMCVCOC0lRDAlQjglRDAlQkQlRDElODQlRDElODAlRDAlQjAlRDElODElRDElODIlRDElODAlRDElODMlRDAlQkElRDElODIlRDElODMlRDElODAlRDAlQjAvMjMwMC0lRDElODAlRDAlQjUlRDAlQkMlRDAlQkUlRDAlQkQlRDElODI_eD0xJnk9MiNub3RpY2U_";
const message = "Repair [Plan](https://example.com/plan.pdf)";
const publicationDate = "2026-10-04T09:34:56.000Z";
const currentArticle = `
  <header>Outside article noise</header>
  <article id="article_view_news">
    <h1 class="article-title">Detail title</h1>
    <time datetime="2026-10-04T12:34:56+03:00">Publication date</time>
    <div class="article-body">
      <p>Repair <a href="https://example.com/plan.pdf">Plan</a></p>
      <nav>Navigation noise</nav><script>Script noise</script>
    </div>
  </article>
`;

const consumerRequire = createRequire(import.meta.url);
const sourceRequire = createRequire(consumerRequire.resolve("@oboapp/source-rayon-pancharevo-bg"));
const helperRequire = createRequire(sourceRequire.resolve("@oboapp/source-web-utils/browser"));
const { chromium } = helperRequire("playwright") as typeof import("playwright");

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
let identifiers: string[];
let article: string;
let detailReadAt: string | undefined;
let statuses: Map<string, number>;
let fetchFeed: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(contractDate);
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  browser = createBrowserMock();
  identifiers = [identifier];
  article = currentArticle;
  detailReadAt = undefined;
  statuses = new Map();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [],
    totalCategorized: 0,
    totalRelevant: 0,
    totalIrrelevant: 0,
  });
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  browser.page.evaluate.mockImplementation(async (callback, argument) => {
    return callback(argument);
  });
  browser.page.goto.mockImplementation(async (url: string) => {
    detailReadAt = new Date().toISOString();
    document.body.innerHTML = article;
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
  fetchFeed = vi.fn<typeof fetch>(async () => {
    const items = identifiers.map((url) => {
      return `<item><title>Listing title</title><link><![CDATA[${url}]]></link>
        <pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate></item>`;
    });
    return new Response(`<rss><channel>${items.join("")}</channel></rss>`);
  });
  vi.stubGlobal("fetch", fetchFeed);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

async function scan(): Promise<void> {
  await Promise.all([crawl(), vi.runAllTimersAsync()]);
}

describe("published Pancharevo RSS package handoff", () => {
  it("stores current article content and publication time, ingests it and skips the next scan", async () => {
    await scan();

    expect([...store.records.keys()]).toEqual([itemId]);
    expect(store.records.get(itemId)).toEqual({
      url: identifier,
      sourceType,
      locality: "bg.sofia",
      title: "Detail title",
      datePublished: publicationDate,
      message,
      processed: false,
      crawledAt: expect.any(Date),
    });
    expect(fetchFeed).toHaveBeenCalledWith(feedUrl, expect.any(Object));
    expect(browser.page.goto.mock.calls).toEqual([
      [identifier, { waitUntil: "domcontentloaded" }],
    ]);
    expect(await ingest({ sourceType })).toMatchObject({
      total: 1,
      ingested: 1,
      failed: 0,
    });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(message, sourceType, expect.objectContaining({
      sourceDocumentId: itemId,
      sourceUrl: identifier,
      locality: "bg.sofia",
      datePublished: publicationDate,
    }));

    await store.sources.updateOne(itemId, { processed: true });
    article = "Provider content changed";
    await scan();

    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.get(itemId)?.processed).toBe(true);
    expect((await ingest({ sourceType })).total).toBe(0);
    expect(messageIngest).toHaveBeenCalledOnce();
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(chromium.launch).toHaveBeenCalledOnce();
    expect(browser.page.close).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("preserves historical MD5 and base64 records in either processing state without opening Chromium", async () => {
    identifiers = [legacyIdentifier];
    for (const id of [historicalItemId, historicalBase64Id]) {
      for (const processed of [false, true]) {
        const record = { url: legacyIdentifier, title: "Historical content", processed };
        store.records.clear();
        store.records.set(id, record);

        await scan();

        expect(store.records.size).toBe(1);
        expect(store.records.get(id)).toBe(record);
      }
    }

    expect(fetchFeed).toHaveBeenCalledTimes(4);
    expect(chromium.launch).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
  });

  it.each([403, 503])("propagates an HTTP %s feed failure without opening Chromium or persisting records", async (status) => {
    fetchFeed.mockResolvedValueOnce(new Response("Unavailable", { status }));

    await expect(scan()).rejects.toThrow(String(status));

    expect(chromium.launch).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(store.records.size).toBe(0);
  });

  it("retries a denied feed on the next scan without creating incomplete records", async () => {
    fetchFeed.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    await expect(scan()).rejects.toThrow("403");
    expect(store.records.size).toBe(0);

    await scan();

    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.records.get(itemId)).toMatchObject({
      url: identifier,
      datePublished: publicationDate,
      message,
      processed: false,
    });
  });

  it("retries an HTTP detail failure on the next scan while skipping saved content", async () => {
    identifiers = [identifier, secondIdentifier];
    statuses.set(identifier, 403);

    await scan();

    expect([...store.records.values()]).toEqual([
      expect.objectContaining({ url: secondIdentifier, message, processed: false }),
    ]);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType,
      saved: 1,
      skipped: 0,
      failed: 1,
    });
    statuses.delete(identifier);

    await scan();

    expect(store.records.size).toBe(2);
    expect(store.records.get(itemId)?.message).toBe(message);
    expect(store.client.createOne).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType,
      saved: 1,
      skipped: 1,
      failed: 0,
    });
    expect(browser.page.goto.mock.calls.map(([url]) => {
      return url;
    })).toEqual([identifier, secondIdentifier, identifier]);
    expect(browser.page.close).toHaveBeenCalledTimes(3);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });

  it("leaves an invalid current publication timestamp eligible for a later scan", async () => {
    article = currentArticle.replace("2026-10-04T12:34:56+03:00", "invalid");

    await scan();

    expect(store.records.size).toBe(0);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith("Crawl complete", {
      sourceType,
      saved: 0,
      skipped: 0,
      failed: 1,
    });
    article = currentArticle;

    await scan();

    expect(store.records.get(itemId)?.datePublished).toBe(publicationDate);
    expect(store.client.createOne).toHaveBeenCalledOnce();
  });

  it("keeps the legacy scan-time fallback for an unreadable article date", async () => {
    identifiers = [legacyIdentifier];
    article = '<time>Unreadable date</time><h1>Detail title</h1><div itemprop="articleBody"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p></div>';

    await scan();

    expect(detailReadAt).toBeDefined();
    expect(store.records.get(historicalItemId)).toMatchObject({
      url: legacyIdentifier,
      datePublished: detailReadAt,
      message,
    });
  });

  it("keeps the legacy dated-title fallback when the article date is empty", async () => {
    identifiers = [legacyIdentifier];
    article = '<time></time><h1>Repair 04.10.2026</h1><div itemprop="articleBody"><p>Repair <a href="https://example.com/plan.pdf">Plan</a></p></div>';

    await scan();

    expect(store.records.get(historicalItemId)).toMatchObject({
      url: legacyIdentifier,
      datePublished: new Date(2026, 9, 4).toISOString(),
      message,
    });
  });
});
