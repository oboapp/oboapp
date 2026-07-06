import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";

// Hoist mocks so they are available inside vi.mock factory closures
const { mockReadFile, mockCalcAqi, mockGcsDownload } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockCalcAqi: vi.fn(() => 3.5),
  mockGcsDownload: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

// Mock GCS so tests work whether or not GCS_GENERIC_BUCKET is set in the environment.
// The route does: const [content] = await file.download(), then content.toString("utf-8").
// Must use a class (not an arrow function) because the route calls `new Storage(...)`.
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket() {
      return { file: () => ({ download: mockGcsDownload }) };
    }
  },
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

function gcsNotFound(): Error {
  return Object.assign(new Error("Not Found"), { code: 404 });
}

describe("GET /api/air-quality/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pin env vars so tests are hermetic regardless of the host environment.
    // Force the GCS path so mockGcsDownload controls data supply consistently.
    vi.stubEnv("GCS_GENERIC_BUCKET", "test-bucket");
    vi.stubEnv("NEXT_PUBLIC_LOCALITY", "bg.test-default");
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "");
    // Default: no data — GCS file not found
    mockGcsDownload.mockRejectedValue(gcsNotFound());
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    mockCalcAqi.mockReturnValue(3.5);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("locality validation", () => {
    it("returns 503 in production when GCS_GENERIC_BUCKET is not set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GCS_GENERIC_BUCKET", "");
      const res = await GET(makeRequest({ locality: "bg.sofia" }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toHaveProperty("error", "GCS_GENERIC_BUCKET is not configured");
    });

    it("returns 400 for an unknown locality", async () => {
      const res = await GET(makeRequest({ locality: "xx.unknown" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Unknown locality");
    });

    it("defaults to NEXT_PUBLIC_LOCALITY when no locality param is provided", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.locality).toBe("bg.test-default");
    });

    it("returns 500 when neither locality param nor NEXT_PUBLIC_LOCALITY is set", async () => {
      vi.stubEnv("NEXT_PUBLIC_LOCALITY", "");

      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty(
        "error",
        "NEXT_PUBLIC_LOCALITY environment variable is required but not set",
      );
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
    const readingsBuffer = Buffer.from(JSON.stringify(readings));

    beforeEach(() => {
      // Supply data via GCS path (GCS_GENERIC_BUCKET is pinned to "test-bucket" in the outer beforeEach)
      mockGcsDownload.mockResolvedValue([readingsBuffer]);
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
      // Two readings in distinct grid cells so calculateNowCastAqi is called once per cell.
      // (42.61, 23.21) → cell r0c0; (42.75, 23.45) → cell r4c5 (grid step ≈ lat 0.033, lng 0.043).
      const twoDistinctCellReadings = [
        { sensorId: 1, timestamp: recentIso, lat: 42.61, lng: 23.21, p1: 30, p2: 20 },
        { sensorId: 2, timestamp: recentIso, lat: 42.75, lng: 23.45, p1: 35, p2: 22 },
      ];
      const buf = Buffer.from(JSON.stringify(twoDistinctCellReadings));
      mockGcsDownload.mockResolvedValue([buf]);
      mockReadFile.mockResolvedValue(JSON.stringify(twoDistinctCellReadings));

      // First cell (r0c0, sensor 1) gets aqi=4.2; second cell (r4c5, sensor 2) gets aqi=null (0).
      mockCalcAqi.mockReturnValueOnce(4.2).mockReturnValueOnce(0);
      const res = await GET(makeRequest({ locality: freshLocality() }));
      const body = await res.json();
      expect(body.cells).toHaveLength(2);
      const aqis: (number | null)[] = body.cells.map(
        (c: { aqi: number | null }) => c.aqi,
      );
      expect(aqis[0]).toBe(4.2);
      expect(aqis[1]).toBeNull();
    });
  });
});
