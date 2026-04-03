import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

// Hoist mocks so they are available inside vi.mock factory closures
const { mockReadFile, mockCalcAqi } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockCalcAqi: vi.fn(() => 3.5),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

vi.mock("@oboapp/shared", () => ({
  getBoundsForLocality: vi.fn((locality: string) => {
    if (locality.startsWith("bg.")) {
      return { south: 42.6, north: 42.8, west: 23.2, east: 23.5 };
    }
    throw new Error(`Unknown locality: ${locality}`);
  }),
  calculateNowCastAqi: mockCalcAqi,
  getAqiLabel: vi.fn(() => "Умерено"),
  getAqiCategory: vi.fn(() => "moderate"),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    messages: { count: vi.fn().mockResolvedValue(10) },
    notificationMatches: { count: vi.fn().mockResolvedValue(3) },
  }),
}));

// Each test uses a unique locality to avoid module-level GCS cache hits
let localityCounter = 0;
function freshLocality(): string {
  return `bg.test${localityCounter++}`;
}

function makeRequest(params?: Record<string, string>): Request {
  const url = new URL("http://localhost/api/air-quality/status");
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

describe("GET /api/air-quality/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no local readings file
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    // Default: valid aqi
    mockCalcAqi.mockReturnValue(3.5);
  });

  describe("locality validation", () => {
    it("returns 400 for an unknown locality", async () => {
      const res = await GET(makeRequest({ locality: "xx.unknown" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Unknown locality");
    });

    it("defaults to bg.sofia when no locality param is provided", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.locality).toBe("bg.sofia");
    });
  });

  describe("no readings data", () => {
    it("returns 200 with empty cells and null maxAqi when the readings file is absent", async () => {
      const res = await GET(makeRequest({ locality: freshLocality() }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cells).toEqual([]);
      expect(body.maxAqi).toBeNull();
    });

    it("reports zero readings and marks data as stale when there is no file", async () => {
      const res = await GET(makeRequest({ locality: freshLocality() }));
      const body = await res.json();
      expect(body.readings.count).toBe(0);
      expect(body.readings.uniqueSensors).toBe(0);
      expect(body.readings.isStale).toBe(true);
      expect(body.readings.oldestAt).toBeNull();
      expect(body.readings.newestAt).toBeNull();
    });

    it("includes db stats even when there are no readings", async () => {
      const res = await GET(makeRequest({ locality: freshLocality() }));
      const body = await res.json();
      expect(body.stats).toMatchObject({ messageCount: 10, notificationCount: 3 });
    });
  });

  describe("with readings data", () => {
    const recentIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const readings = [
      { sensorId: 1, timestamp: recentIso, lat: 42.7, lng: 23.3, p1: 30, p2: 20 },
      { sensorId: 2, timestamp: recentIso, lat: 42.7, lng: 23.3, p1: 35, p2: 22 },
    ];

    beforeEach(() => {
      mockReadFile.mockResolvedValue(JSON.stringify(readings));
    });

    it("returns cells with the expected shape", async () => {
      const res = await GET(makeRequest({ locality: freshLocality() }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cells.length).toBeGreaterThan(0);
      const cell = body.cells[0];
      expect(cell).toMatchObject({
        id: expect.any(String),
        aqi: expect.any(Number),
        aqiLabel: expect.any(String),
        aqiCategory: expect.any(String),
        sensorCount: expect.any(Number),
      });
      expect(cell.bounds).not.toBeNull();
    });

    it("reflects reading freshness in the summary stats", async () => {
      const res = await GET(makeRequest({ locality: freshLocality() }));
      const body = await res.json();
      expect(body.readings.uniqueSensors).toBe(2);
      expect(body.readings.count).toBe(2);
      expect(body.readings.isStale).toBe(false);
      expect(body.readings.newestAt).not.toBeNull();
      expect(body.readings.oldestAt).not.toBeNull();
    });

    it("sets cell aqi/aqiLabel/aqiCategory to null when calculateNowCastAqi returns 0", async () => {
      mockCalcAqi.mockReturnValueOnce(0);
      const res = await GET(makeRequest({ locality: freshLocality() }));
      expect(res.status).toBe(200);
      const body = await res.json();
      const cell = body.cells[0];
      expect(cell.aqi).toBeNull();
      expect(cell.aqiLabel).toBeNull();
      expect(cell.aqiCategory).toBeNull();
    });

    it("returns null maxAqi when all cells have a zero/invalid aqi", async () => {
      mockCalcAqi.mockReturnValue(0);
      const res = await GET(makeRequest({ locality: freshLocality() }));
      const body = await res.json();
      expect(body.maxAqi).toBeNull();
    });

    it("sorts cells with null aqi after cells with a valid aqi", async () => {
      mockCalcAqi.mockReturnValueOnce(4.2).mockReturnValueOnce(0);
      const res = await GET(makeRequest({ locality: freshLocality() }));
      const body = await res.json();
      const aqis: (number | null)[] = body.cells.map(
        (c: { aqi: number | null }) => c.aqi,
      );
      const firstNull = aqis.indexOf(null);
      const lastNonNull = aqis.reduceRight(
        (acc: number, v: number | null, i: number) => (acc === -1 && v !== null ? i : acc),
        -1,
      );
      if (firstNull !== -1 && lastNonNull !== -1) {
        expect(firstNull).toBeGreaterThan(lastNonNull);
      }
    });
  });
});
