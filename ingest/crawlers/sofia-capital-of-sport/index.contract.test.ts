import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@oboapp/source-sofia-capital-of-sport/metadata";
import { createBrowserMock, createSourceStore } from "@/__mocks__/source-contract";
import { getPackagedChromium } from "@/__mocks__/source-package-browser";
import { encodeDocumentId, encodeDocumentIdForLookup } from "@/crawlers/shared/firestore";
import { getDb } from "@/lib/db";
import { ingest } from "@/messageIngest/from-sources";
import { messageIngest } from "@/messageIngest/index";
import definition from "../../../shared/src/sources/sofia-capital-of-sport";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/messageIngest/index", () => ({ messageIngest: vi.fn() }));
vi.mock("@/geocoding/shared/boundary-utils", () => ({
  loadBoundaries: () => null,
  isWithinBoundaries: () => true,
}));

const identifier = "https://sofia2018.bg/sport%2fevent/?source=rss#news";
const xml = `<rss><channel><item><title>Пътно ограничение</title><link>${identifier}</link>
  <pubDate>Sun, 04 Oct 2026 06:31:18 +0000</pubDate></item></channel></rss>`;
const article = '<article class="post"><div class="entry-content"><nav>omit</nav><p>Маратон.</p></div></article>';
const chromium = getPackagedChromium("@oboapp/source-sofia-capital-of-sport");
let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;

async function scan(): Promise<void> {
  await Promise.all([crawl(), vi.runAllTimersAsync()]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-04T09:15:00Z"));
  vi.stubEnv("LOCALITY", "bg.sofia");
  vi.stubGlobal("fetch", async () => new Response(xml));
  store = createSourceStore();
  browser = createBrowserMock();
  browser.page.evaluate.mockImplementation(async (callback, arg) => callback(arg));
  vi.spyOn(chromium, "launch").mockResolvedValue(browser.instance);
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(messageIngest).mockResolvedValue({
    messages: [], totalCategorized: 0, totalRelevant: 0, totalIrrelevant: 0,
  });
  document.body.innerHTML = article;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Sofia Capital of Sport packaged source", () => {
  it("saves a complete article, keeps the literal identifier and ingests the RSS date", async () => {
    expect(metadata).toEqual(definition);
    await scan();
    const id = encodeDocumentId(identifier);
    expect(store.records.get(id)).toEqual({
      title: "Пътно ограничение", message: "Маратон.", datePublished: "2026-10-04T06:31:18.000Z",
      url: identifier, sourceType: metadata.id, locality: "bg.sofia", processed: false, crawledAt: expect.any(Date),
    });
    expect(await ingest({ sourceType: metadata.id })).toMatchObject({ ingested: 1, failed: 0 });
    expect(messageIngest).toHaveBeenCalledExactlyOnceWith("Маратон.", metadata.id,
      expect.objectContaining({ sourceDocumentId: id, datePublished: "2026-10-04T06:31:18.000Z" }));
    await scan();
    expect(chromium.launch).toHaveBeenCalledOnce();
    expect(browser.browser.close).toHaveBeenCalledOnce();
    expect(store.client.createOne).toHaveBeenCalledOnce();
  });

  it.each(encodeDocumentIdForLookup(identifier))("skips historical ID %s before launching Chromium", async (id) => {
    const historical = { url: identifier, processed: true, title: "Събитие" };
    store.records.set(id, historical);
    await scan();
    expect(store.records.get(id)).toBe(historical);
    expect(chromium.launch).not.toHaveBeenCalled();
    expect(store.client.createOne).not.toHaveBeenCalled();
  });

  it("closes a failed article and retries it on the next scan", async () => {
    document.body.innerHTML = "<h1>Incomplete page</h1>";
    await scan();
    expect(store.records.size).toBe(0);
    expect(browser.page.close).toHaveBeenCalledOnce();
    document.body.innerHTML = article;
    await scan();
    expect(store.records.size).toBe(1);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });
});
