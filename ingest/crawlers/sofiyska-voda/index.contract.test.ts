import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { crawl } from "./index";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const feature = { attributes: { OBJECTID: 123, LOCATION: "ул. Тест", START_: Date.parse("2026-10-04T08:00:00Z"), ALERTEND: Date.parse("2026-10-04T12:00:00Z") }, geometry: { x: 23.32, y: 42.7 } };
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
let store: ReturnType<typeof createSourceStore>;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate);
  store = createSourceStore(); vi.mocked(getDb).mockResolvedValue(store.db);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async (url) => response({ features: String(url).includes("/2/query") ? [feature, feature] : [] }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Sofiyska Voda crawl contract", () => {
  it("persists provider geometry and times once across duplicate records and repeat crawls", async () => {
    await crawl(); await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    const doc = [...store.records.values()][0];
    expect(doc).toMatchObject({
      url: "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer/2/123",
      deepLinkUrl: "", locality: "bg.sofia", sourceType: "sofiyska-voda", categories: ["water"],
      processed: false, isRelevant: true, crawledAt: contractDate,
      timespanStart: new Date("2026-10-04T08:00:00Z"), timespanEnd: new Date("2026-10-04T12:00:00Z"),
    });
    expect(JSON.parse(String(doc.geoJson))).toMatchObject({ type: "FeatureCollection", features: [{ geometry: { type: "Point", coordinates: [23.32, 42.7] } }] });
  });
  it("reads subsequent ArcGIS pages before moving to the next layer", async () => {
    fetchMock.mockResolvedValueOnce(response({ features: [feature], exceededTransferLimit: true }))
      .mockResolvedValueOnce(response({ features: [{ ...feature, attributes: { ...feature.attributes, OBJECTID: 124 } }] }));
    await crawl();
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("resultOffset"))).toEqual(["0", "1000", "0"]);
    expect(store.sources.setOne).toHaveBeenCalledTimes(2);
  });
  it("ignores empty layers and features missing geometry or identity", async () => {
    fetchMock.mockResolvedValueOnce(response({ features: [{ attributes: { OBJECTID: 1 } }, { geometry: feature.geometry }] })).mockResolvedValueOnce(response({ features: [] }));
    await crawl(); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
  it.each(["http", "provider", "lookup", "write"])("propagates %s failures without claiming a successful crawl", async (stage) => {
    if (stage === "http") fetchMock.mockResolvedValueOnce(new Response("error", { status: 503 }));
    if (stage === "provider") fetchMock.mockResolvedValueOnce(response({ error: { message: "unavailable" } }));
    if (stage === "lookup") store.sources.findById.mockRejectedValueOnce(new Error("lookup"));
    if (stage === "write") store.sources.setOne.mockRejectedValueOnce(new Error("write"));
    await expect(crawl()).rejects.toThrow();
    expect(store.records.size).toBe(0);
  });
});
