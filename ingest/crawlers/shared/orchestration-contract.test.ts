import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { launchBrowser } from "./browser";
import { fetchFeedXml } from "./rss";
import { crawlFullRss, crawlHybridRss } from "./rss-crawler";
import { crawlWordpressPage, processWordpressPost } from "./webpage-crawlers";
import { encodeDocumentId } from "./firestore";
import { delay } from "@/lib/delay";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("./browser", () => ({ launchBrowser: vi.fn() }));
vi.mock("./rss", async (original) => ({ ...await original<typeof import("./rss")>(), fetchFeedXml: vi.fn() }));
vi.mock("@/lib/delay", () => ({ delay: vi.fn().mockResolvedValue(undefined) }));

let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
const item = (name: string) => ({ url: `https://example.com/${name}`, title: name, date: contractDate.toISOString(), contentHtml: `<p>${name}</p>` });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(contractDate);
  store = createSourceStore();
  browser = createBrowserMock();
  vi.mocked(getDb).mockResolvedValue(store.db);
  vi.mocked(launchBrowser).mockResolvedValue(browser.instance);
  vi.mocked(fetchFeedXml).mockReset().mockResolvedValue("feed");
});
afterEach(() => { vi.useRealTimers(); });

describe("RSS orchestration contracts", () => {
  const fullOptions = (items = [item("new")]) => ({ feedUrl: "https://example.com/feed", sourceType: "triaditsa-org", locality: "bg.sofia", extractItems: () => items });

  it("deduplicates a full feed and persists content without detail requests", async () => {
    const known = item("known");
    store.records.set(encodeDocumentId(known.url), { ...known, processed: true });
    await crawlFullRss(fullOptions([known, item("new"), item("new")]));
    expect(store.sources.setOne).toHaveBeenCalledExactlyOnceWith(encodeDocumentId(item("new").url), {
      url: item("new").url, title: "new", message: "new", datePublished: contractDate.toISOString(),
      crawledAt: contractDate, locality: "bg.sofia", sourceType: "triaditsa-org", processed: false,
    });
    expect(launchBrowser).not.toHaveBeenCalled();
    expect(fetchFeedXml).toHaveBeenCalledExactlyOnceWith("https://example.com/feed");
  });

  it("skips failed lookups and malformed items, and continues after a failed write", async () => {
    store.sources.findById.mockRejectedValueOnce(new Error("read failed"));
    store.sources.setOne.mockRejectedValueOnce(new Error("write failed"));
    await crawlFullRss(fullOptions([item("unknown"), { ...item("empty"), contentHtml: "" }, item("failed"), item("good")]));
    expect(store.sources.setOne.mock.calls.map(([, doc]) => doc.title)).toEqual(["failed", "good"]);
    expect([...store.records.values()]).toEqual([expect.objectContaining({ title: "good" })]);
  });

  it("propagates feed fetch and parse failures", async () => {
    vi.mocked(fetchFeedXml).mockRejectedValueOnce(new Error("network"));
    await expect(crawlFullRss(fullOptions())).rejects.toThrow("network");
    await expect(crawlHybridRss({ feedUrl: "feed", sourceType: "test", extractItems: () => { throw new Error("parse"); }, processPost: vi.fn() })).rejects.toThrow("parse");
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it.each(["empty", "known"])("does not launch a browser for %s feeds", async (kind) => {
    store.sources.findById.mockResolvedValue({ processed: true });
    const items = kind === "empty" ? [] : [item("known")];
    const processPost = vi.fn();
    await crawlHybridRss({ ...fullOptions(items), processPost });
    await crawlFullRss(fullOptions(items));
    expect(processPost).not.toHaveBeenCalled();
    expect(store.sources.setOne).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("reuses one browser and continues after an individual detail failure", async () => {
    const processPost = vi.fn().mockRejectedValueOnce(new Error("detail")).mockResolvedValue(undefined);
    await crawlHybridRss({ ...fullOptions([item("a"), item("a"), item("b")]), processPost });
    expect(processPost.mock.calls).toEqual([[browser.instance, item("a"), store.db], [browser.instance, item("b"), store.db]]);
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(browser.browser.close).toHaveBeenCalledTimes(1);
  });
});

describe("webpage orchestration contracts", () => {
  const options = (items = [item("new")]) => ({
    indexUrl: "https://example.com/news", sourceType: "nadezhda-org",
    extractPostLinks: vi.fn().mockResolvedValue(items), processPost: vi.fn().mockResolvedValue(undefined),
  });

  it("skips known and unreadable URLs and continues after a failed detail", async () => {
    const config = options([item("known"), item("unknown"), item("bad"), item("good")]);
    store.sources.findById.mockResolvedValueOnce({ processed: false }).mockRejectedValueOnce(new Error("lookup"));
    config.processPost.mockRejectedValueOnce(new Error("detail"));
    await crawlWordpressPage(config);
    expect(config.processPost.mock.calls.map(([, post]) => post.url)).toEqual([item("bad").url, item("good").url]);
    expect(browser.browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes an owned browser on discovery failure", async () => {
    const config = options();
    config.extractPostLinks.mockRejectedValueOnce(new Error("listing"));
    await expect(crawlWordpressPage(config)).rejects.toThrow("listing");
    expect(browser.browser.close).toHaveBeenCalledTimes(1);
    expect(config.processPost).not.toHaveBeenCalled();
  });

  it("does not close a provided browser on an empty listing", async () => {
    await crawlWordpressPage({ ...options([]), browser: browser.instance });
    expect(browser.page.close).toHaveBeenCalledTimes(1);
    expect(browser.browser.close).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("persists a detail document and applies the provider delay", async () => {
    await processWordpressPost(browser.instance, item("new"), store.db, "nadezhda-org", "bg.sofia", 2000,
      async () => ({ title: "Repair", dateText: "2026-10-04", contentHtml: "<p>Water <strong>repair</strong></p>" }), (date) => date);
    expect(store.sources.setOne).toHaveBeenCalledWith(encodeDocumentId(item("new").url), {
      url: item("new").url, title: "Repair", message: "Water **repair**", datePublished: "2026-10-04",
      sourceType: "nadezhda-org", locality: "bg.sofia", crawledAt: contractDate, processed: false,
    });
    expect(browser.page.close).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(2000);
  });

  it.each(["extract", "save"])("closes the detail page and propagates %s errors", async (stage) => {
    const extract = vi.fn().mockResolvedValue({ title: "Repair", dateText: "2026-10-04", contentHtml: "<p>Repair</p>" });
    if (stage === "extract") extract.mockRejectedValueOnce(new Error("failed"));
    else store.sources.setOne.mockRejectedValueOnce(new Error("failed"));
    await expect(processWordpressPost(browser.instance, item("new"), store.db, "test", "bg.sofia", 2000, extract, (date) => date)).rejects.toThrow("failed");
    expect(browser.page.close).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
