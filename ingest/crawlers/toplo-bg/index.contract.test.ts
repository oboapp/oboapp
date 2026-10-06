import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { toploHtml, pointGeometry } from "@/__mocks__/source-contract-fixtures";
import { getDb } from "@/lib/db";
import { launchBrowser } from "../shared/browser";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("../shared/browser", () => ({ launchBrowser: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate);
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit 1"); });
  store = createSourceStore(); browser = createBrowserMock();
  browser.page.content.mockResolvedValue(toploHtml());
  vi.mocked(getDb).mockResolvedValue(store.db); vi.mocked(launchBrowser).mockResolvedValue(browser.instance);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Toplo crawl contract", () => {
  it("persists listing-only content with stable synthetic identity and skips it on repeat", async () => {
    await crawl(); await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    expect([...store.records.values()]).toEqual([expect.objectContaining({
      url: "https://toplo.bg/incidents/item-1", deepLinkUrl: "", sourceType: "toplo-bg", locality: "bg.sofia",
      geoJson: JSON.stringify(pointGeometry), categories: ["heating"], isRelevant: true, processed: false,
      crawledAt: contractDate, datePublished: "2026-10-04T08:00:00.000Z",
      timespanStart: new Date("2026-10-04T08:00:00.000Z"), timespanEnd: new Date("2026-10-04T08:00:00.000Z"),
    })]);
    expect(browser.page.goto).toHaveBeenCalledWith("https://toplo.bg/accidents-and-maintenance", { waitUntil: "networkidle" });
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });
  it("dry run does not initialize persistence", async () => {
    await crawl(true);
    expect(getDb).not.toHaveBeenCalled(); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
  it("continues after one write fails", async () => {
    browser.page.content.mockResolvedValue(toploHtml(["item-1", "item-2"]));
    store.sources.setOne.mockRejectedValueOnce(new Error("write"));
    await crawl();
    expect([...store.records.values()]).toEqual([expect.objectContaining({ url: "https://toplo.bg/incidents/item-2" })]);
    expect(process.exit).not.toHaveBeenCalled();
  });
  it.each(["empty", "all failed"])("exits on %s listing", async (kind) => {
    if (kind === "empty") browser.page.content.mockResolvedValue("<html></html>");
    else store.sources.setOne.mockRejectedValue(new Error("write"));
    await expect(crawl()).rejects.toThrow("exit 1");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
  it("falls back to the crawl time for an invalid start date", async () => {
    browser.page.content.mockResolvedValue(toploHtml(["item-1"], "invalid"));
    await crawl();
    expect([...store.records.values()][0]).toMatchObject({ timespanStart: contractDate, timespanEnd: contractDate });
  });
});
