import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// GCS mock
// ---------------------------------------------------------------------------
// Controls what the mocked GCS file returns each test.
let mockSnapshotData: HeatmapSnapshot | null = null;
let mockFileExists = true;
let mockGcsError: Error | null = null;

const mockDownload = vi.fn();
const mockExists = vi.fn();
const mockFile = vi.fn();
const mockBucket = vi.fn();

vi.mock("@google-cloud/storage", () => ({
  // Must use a regular function — arrow functions cannot be called with `new`
  Storage: vi.fn().mockImplementation(function () {
    return { bucket: mockBucket };
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FINALIZED_AT = "2024-01-01T00:00:00.000Z";

interface HeatmapMessage {
  id: string;
  source: string;
  categories: string[];
  cityWide: boolean;
  finalizedAt: string;
  points: [number, number][];
}

interface HeatmapSnapshot {
  generatedAt: string;
  messages: HeatmapMessage[];
}

/** Build a minimal snapshot with the given messages. */
function makeSnapshot(messages: HeatmapMessage[]): HeatmapSnapshot {
  return { generatedAt: FINALIZED_AT, messages };
}

/** Build a message with a single Point geometry pre-converted to heatmap points. */
function pointMsg(
  id: string,
  lat: number,
  lng: number,
  overrides: Partial<HeatmapMessage> = {},
): HeatmapMessage {
  return {
    id,
    source: "test-source",
    categories: [],
    cityWide: false,
    finalizedAt: FINALIZED_AT,
    points: [[lat, lng]],
    ...overrides,
  };
}

/** Helper: build a Request with optional query-string params */
function makeRequest(params?: Record<string, string>): Request {
  const url = new URL("http://localhost/api/messages/heatmap");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Wire up GCS mock before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshotData = null;
  mockFileExists = true;
  mockGcsError = null;

  mockDownload.mockImplementation(async () => {
    if (mockGcsError) throw mockGcsError;
    return [Buffer.from(JSON.stringify(mockSnapshotData))];
  });

  mockExists.mockResolvedValue([mockFileExists]);

  mockFile.mockReturnValue({ exists: mockExists, download: mockDownload });
  mockBucket.mockReturnValue({ file: mockFile });

  process.env.GCS_GENERIC_BUCKET = "test-bucket";
});

describe("GET /api/messages/heatmap", () => {
  it("returns 503 when GCS_GENERIC_BUCKET is not configured", async () => {
    delete process.env.GCS_GENERIC_BUCKET;
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
  });

  it("returns 404 when snapshot file does not exist yet", async () => {
    mockFileExists = false;
    mockExists.mockResolvedValue([false]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
  });

  it("returns 500 when GCS throws", async () => {
    mockGcsError = new Error("GCS connection failed");
    mockDownload.mockRejectedValue(mockGcsError);
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });

  it("returns 200 with empty points array when snapshot has no messages", async () => {
    mockSnapshotData = makeSnapshot([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ points: [], messageCount: 0, oldestDate: null });
  });

  it("sets Cache-Control header", async () => {
    mockSnapshotData = makeSnapshot([]);
    const res = await GET(makeRequest());
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });

  it("excludes city-wide messages", async () => {
    mockSnapshotData = makeSnapshot([
      pointMsg("city-wide", 42.69, 23.32, { cityWide: true }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.messageCount).toBe(0);
    expect(body.points).toHaveLength(0);
  });

  it("returns points and correct messageCount for a single message", async () => {
    mockSnapshotData = makeSnapshot([pointMsg("msg-1", 42.6977, 23.3219)]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.points).toEqual([[42.6977, 23.3219]]);
    expect(body.messageCount).toBe(1);
    expect(body.oldestDate).toBe(FINALIZED_AT);
  });

  it("accumulates points from multiple messages", async () => {
    mockSnapshotData = makeSnapshot([
      pointMsg("msg-1", 42.69, 23.3),
      {
        ...pointMsg("msg-2", 42.7, 23.31),
        points: [
          [42.7, 23.31],
          [42.71, 23.32],
        ],
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.points).toHaveLength(3);
    expect(body.messageCount).toBe(2);
  });

  it("reports oldestDate as the earliest finalizedAt among included messages", async () => {
    const older = "2023-06-01T00:00:00.000Z";
    const newer = "2024-01-01T00:00:00.000Z";
    mockSnapshotData = makeSnapshot([
      pointMsg("msg-newer", 42.69, 23.3, { finalizedAt: newer }),
      pointMsg("msg-older", 42.7, 23.31, { finalizedAt: older }),
      pointMsg("msg-citywide", 42.71, 23.32, {
        cityWide: true,
        finalizedAt: "2022-01-01T00:00:00.000Z",
      }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.messageCount).toBe(2);
    expect(body.oldestDate).toBe(older);
  });

  describe("category filtering", () => {
    beforeEach(() => {
      mockSnapshotData = makeSnapshot([
        pointMsg("water-msg", 42.69, 23.3, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
        pointMsg("electricity-msg", 42.7, 23.31, {
          categories: ["electricity"],
          source: "erm-zapad",
        }),
        pointMsg("uncategorized-msg", 42.71, 23.32, {
          categories: [],
          source: "sofia-bg",
        }),
      ]);
    });

    it("returns all messages when no category filter is applied", async () => {
      const res = await GET(makeRequest());
      expect((await res.json()).messageCount).toBe(3);
    });

    it("filters to only matching category", async () => {
      const res = await GET(makeRequest({ categories: "water" }));
      expect((await res.json()).messageCount).toBe(1);
    });

    it("filters to multiple categories (OR logic)", async () => {
      const res = await GET(makeRequest({ categories: "water,electricity" }));
      expect((await res.json()).messageCount).toBe(2);
    });

    it("filters to uncategorized messages", async () => {
      const res = await GET(makeRequest({ categories: "uncategorized" }));
      expect((await res.json()).messageCount).toBe(1);
    });

    it("combines real category and uncategorized in one filter", async () => {
      const res = await GET(makeRequest({ categories: "water,uncategorized" }));
      expect((await res.json()).messageCount).toBe(2);
    });
  });

  describe("source filtering", () => {
    beforeEach(() => {
      mockSnapshotData = makeSnapshot([
        pointMsg("msg-a", 42.69, 23.3, { source: "sofiyska-voda" }),
        pointMsg("msg-b", 42.7, 23.31, { source: "erm-zapad" }),
      ]);
    });

    it("returns all messages when no source filter is applied", async () => {
      expect((await (await GET(makeRequest())).json()).messageCount).toBe(2);
    });

    it("filters to only matching source", async () => {
      const res = await GET(makeRequest({ sources: "sofiyska-voda" }));
      expect((await res.json()).messageCount).toBe(1);
    });

    it("filters to multiple sources (OR logic)", async () => {
      const res = await GET(
        makeRequest({ sources: "sofiyska-voda,erm-zapad" }),
      );
      expect((await res.json()).messageCount).toBe(2);
    });

    it("returns empty result when source does not match", async () => {
      const res = await GET(makeRequest({ sources: "unknown-source" }));
      const body = await res.json();
      expect(body.messageCount).toBe(0);
      expect(body.points).toHaveLength(0);
    });
  });

  describe("combined category and source filtering", () => {
    it("applies both filters simultaneously", async () => {
      mockSnapshotData = makeSnapshot([
        pointMsg("match", 42.69, 23.3, {
          categories: ["water"],
          source: "sofiyska-voda",
        }),
        pointMsg("wrong-source", 42.7, 23.31, {
          categories: ["water"],
          source: "erm-zapad",
        }),
        pointMsg("wrong-category", 42.71, 23.32, {
          categories: ["electricity"],
          source: "sofiyska-voda",
        }),
      ]);
      const res = await GET(
        makeRequest({ categories: "water", sources: "sofiyska-voda" }),
      );
      expect((await res.json()).messageCount).toBe(1);
    });
  });
});
