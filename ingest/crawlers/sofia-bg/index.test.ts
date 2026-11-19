import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-sofia-bg/metadata";
import { createBrowserMock, createSourceStore } from "@/__mocks__/source-contract";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import { getDb } from "@/lib/db";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import sourceDefinition from "../../../shared/src/sources/sofia-bg";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));

const require = createRequire(import.meta.url);
const provider = createRequire(require.resolve("@oboapp/source-sofia-bg"));
const { chromium } = provider("playwright") as typeof import("playwright");
const listed = "https://www.sofia.bg/bg/web/guest/w/7983928";
const rssAlias = "https://www.sofia.bg/news/content/id/123";
const repairs = "https://www.sofia.bg/bg/repairs-and-traffic-changes";
const title = "Ремонт на улица";
const listing = `<main id="main-content"><a href="${listed}?tracking=1#body">
  <small class="date">02.10.2026</small><div class="news-title">${title}</div></a></main>`;
const detail = `<h1 class="asset-title">Подробности</h1><div class="asset-content"><p>Затворена улица</p></div>`;
const xml = `<rss><channel><item><title>${title}</title><link>${rssAlias}</link>
  <dc:date>2026-10-02T08:00:00Z</dc:date></item></channel></rss>`;
let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
let listingStatus: number;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-04T09:15:00Z"));
  vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore();
  browser = createBrowserMock();
  listingStatus = 200;
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0,
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(xml)));
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  browser.page.goto.mockImplementation(async (url: string) => {
    document.body.innerHTML = url === repairs ? listing : detail;
    const status = url === repairs ? listingStatus : 200;
    return { ok: () => status === 200, status: () => status };
  });
  browser.page.evaluate.mockImplementation(async (fn, arg) => fn(arg));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function scan(): Promise<void> {
  await Promise.all([crawl(), vi.runAllTimersAsync()]);
}

describe("Sofia source package handoff", () => {
  it("retains the listing identity and suppresses a same-title RSS alias after a successful save", async () => {
    expect(metadata).toEqual(sourceDefinition);
    await scan();
    const id = encodeDocumentId(listed);
    expect([...store.records.keys()]).toEqual([id]);
    expect(store.records.get(id)).toEqual({
      sourceType: metadata.id, locality: "bg.sofia", url: listed, title: "Подробности", listingTitle: title,
      datePublished: "2026-10-02T00:00:00.000Z", message: "Затворена улица",
      processed: false, crawledAt: expect.any(Date),
    });
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith(
      "Затворена улица", metadata.id, expect.objectContaining({ sourceDocumentId: id, sourceUrl: listed }),
    );
    await scan();
    expect(store.client.createOne).toHaveBeenCalledOnce();
    expect(store.sources.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.arrayContaining(["listingTitle"]),
    }));
    listingStatus = 503;
    await expect(scan()).rejects.toThrow("Sofia article discovery failed");
    expect([...store.records.keys()]).toEqual([id]);
    expect(browser.page.goto.mock.calls.map(([url]) => url)).toEqual([repairs, listed, repairs, repairs]);
  });

  it("uses the stored title directly when the article heading matches the listing", async () => {
    browser.page.goto.mockImplementation(async (url: string) => {
      document.body.innerHTML = url === repairs ? listing : detail.replace("Подробности", title);
      return { ok: () => true, status: () => 200 };
    });
    await scan();
    const saved = store.records.get(encodeDocumentId(listed));
    expect(saved?.title).toBe(title);
    expect(saved).not.toHaveProperty("listingTitle");
    await scan();
    expect(store.client.createOne).toHaveBeenCalledOnce();
  });

  it("keeps changed listing titles on skipped records from suppressing fresh articles", async () => {
    const old = { url: listed, title: "Old title", sourceType: metadata.id, processed: true };
    store.records.set(encodeDocumentId(listed), old);
    await scan();
    expect(store.records.get(encodeDocumentId(listed))).toBe(old);
    expect(store.records.has(encodeDocumentId(rssAlias))).toBe(true);
  });

  it.each([
    { title: " Ремонт\u00a0на\n улица ", url: rssAlias },
    { title, url: "https://www.sofia.bg/w/7983928" },
  ])("skips older URL and title variants before requesting details", async (data) => {
    const record = { ...data, sourceType: metadata.id, processed: true };
    store.records.set("historical", record);
    await scan();
    expect(browser.page.goto.mock.calls.map(([url]) => url)).toEqual([repairs]);
    expect(store.records.get("historical")).toBe(record);
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it.each(encodeDocumentIdForLookup(listed))("honors historical document ID %s with missing metadata", async (id) => {
    vi.stubGlobal("fetch", async () => new Response("<rss/>"));
    const record = { processed: false };
    store.records.set(id, record);
    await scan();
    expect(store.records.get(id)).toBe(record);
    expect(store.client.createOne).not.toHaveBeenCalled();
    expect(browser.page.goto).toHaveBeenCalledTimes(1);
  });

  it("keeps the surviving alias eligible after an earlier write failure", async () => {
    store.client.createOne.mockRejectedValueOnce(new Error("temporary write failure"));
    await scan();
    expect([...store.records.keys()]).toEqual([encodeDocumentId(rssAlias)]);
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("processes news before reporting failed repairs discovery", async () => {
    listingStatus = 503;
    await expect(scan()).rejects.toThrow("Sofia article discovery failed");
    expect(store.records.get(encodeDocumentId(rssAlias))).toMatchObject({
      url: rssAlias, datePublished: "2026-10-02T08:00:00.000Z", processed: false,
    });
    expect(browser.browser.close).toHaveBeenCalledOnce();
  });

  it("reports point lookup failures after processing the healthy items", async () => {
    store.sources.findById.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(scan()).rejects.toThrow("Sofia deduplication failed");
    expect([...store.records.keys()]).toEqual([encodeDocumentId(rssAlias)]);
  });

  it("stops before discovery on a historical query failure", async () => {
    store.sources.findMany.mockRejectedValueOnce(new Error("history unavailable"));
    await expect(crawl()).rejects.toThrow("history unavailable");
    expect(chromium.launch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
  });
});
