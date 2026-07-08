import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

let mockEventDocs: Record<string, unknown>[] = [];

vi.mock("@/lib/bounds-utils", () => ({
  getLocality: vi.fn(() => "bg.sofia"),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockImplementation(async () => ({
    events: {
      findMany: vi.fn().mockImplementation(async () => [...mockEventDocs]),
    },
  })),
}));

function createEventDoc(
  id: string,
  updatedAt: string,
): Record<string, unknown> {
  return {
    _id: id,
    plainText: `Event ${id}`,
    markdownText: undefined,
    geoJson: {
      type: "FeatureCollection",
      features: [],
    },
    geometryQuality: 1,
    timespanStart: updatedAt,
    timespanEnd: updatedAt,
    categories: ["traffic"],
    pins: [],
    streets: [],
    cadastralProperties: [],
    busStops: [],
    sources: ["sofia-bg"],
    messageCount: 1,
    confidence: 0.9,
    locality: "bg.sofia",
    cityWide: false,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("GET /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventDocs = [
      createEventDoc("event-1", "2026-07-08T09:00:00.000Z"),
      createEventDoc("event-2", "2026-07-08T08:00:00.000Z"),
    ];
  });

  it("sets Cache-Control for first page requests", async () => {
    const response = await GET(new Request("http://localhost/api/events"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=600",
    );
  });

  it("does not set Cache-Control for cursor requests", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/events?cursorUpdatedAt=2026-07-08T09:00:00.000Z&cursorId=event-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBeNull();
  });
});
