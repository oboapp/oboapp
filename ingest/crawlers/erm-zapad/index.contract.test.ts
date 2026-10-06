import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserMock, createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { launchBrowser } from "../shared/browser";
import { delay } from "@/lib/delay";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("../shared/browser", () => ({ launchBrowser: vi.fn() }));
vi.mock("@/lib/delay", () => ({ delay: vi.fn().mockResolvedValue(undefined) }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const incident = { ceo: "SF_0001", typedist: "планирано", type_event: "1", city_name: "София", grid_id: "", cities: "", begin_event: "04.10.2026 10:00", end_event: "04.10.2026 12:00", lat: "42.7", lon: "23.32", points: { cnt: "0" } };
let store: ReturnType<typeof createSourceStore>;
let browser: ReturnType<typeof createBrowserMock>;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate);
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit 1"); });
  store = createSourceStore(); browser = createBrowserMock();
  browser.page.evaluate.mockResolvedValue([{ code: "SOF1", name: "София" }, { code: "SOF2", name: "София" }]);
  vi.mocked(getDb).mockResolvedValue(store.db); vi.mocked(launchBrowser).mockResolvedValue(browser.instance);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ a: { ...incident, ceo: "SF_0002" }, b: incident })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ERM Zapad crawl contract", () => {
  it("globally deduplicates pins to the lowest event ID and persists once", async () => {
    await crawl(); await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    const doc = [...store.records.values()][0];
    expect(doc).toMatchObject({ url: "https://info.ermzapad.bg/incidents/SF_0001", sourceType: "erm-zapad", locality: "bg.sofia", deepLinkUrl: "", categories: ["electricity"], isRelevant: true, processed: false, crawledAt: contractDate });
    expect(JSON.parse(String(doc.geoJson))).toMatchObject({ type: "FeatureCollection", features: [{ geometry: { type: "Point", coordinates: [23.32, 42.7] } }] });
    expect(delay).toHaveBeenCalledWith(2000);
    expect(browser.browser.close).toHaveBeenCalledTimes(2);
  });
  it("returns without DB access when no municipalities are discovered", async () => {
    browser.page.evaluate.mockResolvedValue([]);
    await crawl(); expect(getDb).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("skips incidents without usable coordinates", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ a: { ...incident, lat: "invalid", lon: "invalid" } })));
    await crawl(); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
  it("continues after a failed incident write", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ a: incident, b: { ...incident, ceo: "SF_0003", lat: "42.71" } })));
    store.sources.setOne.mockRejectedValueOnce(new Error("write"));
    await crawl();
    expect([...store.records.values()]).toEqual([expect.objectContaining({ url: "https://info.ermzapad.bg/incidents/SF_0003" })]);
  });
  it.each(["discovery", "provider", "all writes"])("signals a fatal %s failure", async (stage) => {
    if (stage === "discovery") browser.page.goto.mockRejectedValueOnce(new Error("browser"));
    if (stage === "provider") fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    if (stage === "all writes") store.sources.setOne.mockRejectedValue(new Error("write"));
    await expect(crawl()).rejects.toThrow("exit 1");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(browser.browser.close).toHaveBeenCalled();
  });
});
