import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceStore, contractDate } from "@/__mocks__/source-contract";
import { getDb } from "@/lib/db";
import { crawl } from "./index";
import type { ParsedReading } from "@/lib/air-quality/parse-sensor-response";

const mocks = vi.hoisted(() => ({ readings: vi.fn(), aqi: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/air-quality/readings-store", () => ({ createReadingsStore: () => ({ getReadingsInRange: mocks.readings }) }));
vi.mock("@/lib/air-quality/aqi", async (original) => ({ ...await original<typeof import("@/lib/air-quality/aqi")>(), calculateNowCastAqi: mocks.aqi }));
vi.mock("@/lib/air-quality/grid", () => {
  const cells = ["r0c0", "r0c1"].map((id) => ({ id, geoJson: { type: "FeatureCollection", features: [] } }));
  return { buildGrid: () => cells, assignToGridCell: (_grid: unknown, _lat: number, lng: number) => cells[lng === 23.32 ? 0 : 1] };
});

let store: ReturnType<typeof createSourceStore>;
function readings(minutesAgo = 5, lng = 23.32): ParsedReading[] {
  return [1, 2, 3].map((sensorId) => ({ sensorId, sensorType: "SDS011", lat: 42.7, lng, p1: 100, p2: 80, timestamp: new Date(contractDate.getTime() - minutesAgo * 60_000) }));
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(contractDate); vi.stubEnv("LOCALITY", "bg.sofia");
  store = createSourceStore(); vi.mocked(getDb).mockResolvedValue(store.db);
  mocks.readings.mockResolvedValue(readings()); mocks.aqi.mockReturnValue(5);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Sensor Community crawl contract", () => {
  it("persists a window-specific alert once using configured locality", async () => {
    await crawl(); await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(1);
    expect([...store.records.values()][0]).toMatchObject({
      url: "sensor-community://bg.sofia/r0c0/1791104400000", sourceType: "sensor-community", locality: "bg.sofia",
      deepLinkUrl: "", categories: ["air-quality"], processed: false, isRelevant: true,
      timespanStart: new Date("2026-10-04T07:15:00Z"), timespanEnd: contractDate,
    });
    expect(mocks.readings).toHaveBeenCalledWith("bg.sofia", new Date("2026-10-04T05:15:00Z"), contractDate);
  });
  it.each(["empty", "insufficient", "stale", "below threshold"])("does not alert on %s readings", async (kind) => {
    if (kind === "empty") mocks.readings.mockResolvedValue([]);
    if (kind === "insufficient") mocks.readings.mockResolvedValue(readings().slice(0, 2));
    if (kind === "stale") mocks.readings.mockResolvedValue(readings(60));
    if (kind === "below threshold") mocks.aqi.mockReturnValue(3);
    await crawl(); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
  it.each([3, 4])("requires both halves for a sustained alert (previous AQI %i)", async (previous) => {
    mocks.readings.mockResolvedValue([...readings(), ...readings(150)]);
    mocks.aqi.mockReturnValueOnce(4).mockReturnValueOnce(previous);
    await crawl();
    expect(store.sources.setOne).toHaveBeenCalledTimes(previous === 4 ? 1 : 0);
    if (previous === 4) expect([...store.records.values()][0].message).toContain("Продължително");
  });
  it("continues to other cells after a persistence failure", async () => {
    mocks.readings.mockResolvedValue([...readings(), ...readings(5, 23.4)]);
    store.sources.setOne.mockRejectedValueOnce(new Error("write"));
    await crawl();
    expect([...store.records.values()]).toEqual([expect.objectContaining({ url: "sensor-community://bg.sofia/r0c1/1791104400000" })]);
  });
  it("propagates a readings-store failure", async () => {
    mocks.readings.mockRejectedValueOnce(new Error("storage"));
    await expect(crawl()).rejects.toThrow("storage"); expect(store.sources.setOne).not.toHaveBeenCalled();
  });
});
