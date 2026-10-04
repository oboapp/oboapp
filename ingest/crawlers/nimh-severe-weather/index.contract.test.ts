import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { weatherWarning } from "@/__mocks__/source-contract-fixtures";
import { getDb } from "@/lib/db";
import { launchBrowser } from "../shared/browser";
import { parseWeatherPage } from "./parser";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("../shared/browser", () => ({ launchBrowser: vi.fn() }));
vi.mock("./parser", async (original) => ({ ...await original<typeof import("./parser")>(), parseWeatherPage: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate);
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit 1"); });
  store = createSourceStore(); browser = createBrowserMock();
  vi.mocked(parseWeatherPage).mockReturnValue(weatherWarning);
  vi.mocked(getDb).mockResolvedValue(store.db); vi.mocked(launchBrowser).mockResolvedValue(browser.instance);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("NIMH crawl contract", () => {
  it("persists a city-wide warning once, ignoring prose-only updates", async () => {
    await crawl();
    vi.mocked(parseWeatherPage).mockReturnValue({ ...weatherWarning, recommendation: "Updated prose" });
    await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    expect([...store.records.values()][0]).toMatchObject({
      sourceType: "nimh-severe-weather", locality: "bg.sofia", cityWide: true, categories: ["weather"],
      geoJson: '{"type":"FeatureCollection","features":[]}', processed: false, isRelevant: true,
      datePublished: weatherWarning.issuedAt, crawledAt: contractDate,
    });
    expect([...store.records.values()][0].url).toBe("https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-10-04&h=c9d1456eab46");
    expect(browser.browser.close).toHaveBeenCalled();
  });
  it("does nothing when no warnings are active", async () => {
    vi.mocked(parseWeatherPage).mockReturnValue({ ...weatherWarning, recommendation: "", sofiaWarnings: [] });
    await crawl();
    expect(getDb).not.toHaveBeenCalled(); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
  it.each(["parse", "save", "fetch"])("reports fatal %s failure", async (stage) => {
    if (stage === "parse") vi.mocked(parseWeatherPage).mockReturnValue(null);
    if (stage === "save") store.sources.setOne.mockRejectedValue(new Error("write"));
    if (stage === "fetch") browser.page.goto.mockRejectedValue(new Error("network"));
    await expect(crawl()).rejects.toThrow("exit 1");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(browser.browser.close).toHaveBeenCalled();
  });
});
