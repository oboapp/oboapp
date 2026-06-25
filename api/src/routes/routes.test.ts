import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../index";

// Mock the DB module
vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
}));

// Set an env-based API key for tests
process.env.PUBLIC_API_KEYS = "test-api-key";
process.env.LOCALITY = "bg.sofia";

const API_KEY_HEADER = { "x-api-key": "test-api-key" };

beforeEach(async () => {
  const { getDb } = await import("@/lib/db");
  vi.mocked(getDb).mockReset();
  delete process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE;
});

function createRateLimitMocks(counts: number[]) {
  let index = 0;
  const apiRateLimitsMinute = {
    incrementAndGetCount: vi.fn().mockImplementation(async () => {
      const value = counts[Math.min(index, counts.length - 1)];
      index += 1;
      return value;
    }),
  };

  const apiUsageHourly = {
    increment: vi.fn().mockResolvedValue(undefined),
  };

  return { apiRateLimitsMinute, apiUsageHourly };
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

describe("rate limit headers", () => {
  beforeEach(async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const { apiRateLimitsMinute, apiUsageHourly } = createRateLimitMocks([1]);

    mockedGetDb.mockResolvedValue({
      apiRateLimitsMinute,
      apiUsageHourly,
    } as any);
    process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE = "60";
  });

  it("returns X-RateLimit headers on protected 2xx responses", async () => {
    const res = await app.request("/v1/sources", {
      headers: API_KEY_HEADER,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("60");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("59");
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("does not return rate-limit headers on non-429 4xx", async () => {
    const res = await app.request("/v1/messages/by-id", {
      headers: API_KEY_HEADER,
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("x-ratelimit-limit")).toBeNull();
    expect(res.headers.get("x-ratelimit-remaining")).toBeNull();
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("returns 429 with X-RateLimit headers and Retry-After", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const { apiRateLimitsMinute, apiUsageHourly } = createRateLimitMocks([
      1, 2,
    ]);

    mockedGetDb.mockResolvedValue({
      apiRateLimitsMinute,
      apiUsageHourly,
    } as any);
    process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE = "1";

    const first = await app.request("/v1/sources", {
      headers: API_KEY_HEADER,
    });
    expect(first.status).toBe(200);

    const second = await app.request("/v1/sources", {
      headers: API_KEY_HEADER,
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("x-ratelimit-limit")).toBe("1");
    expect(second.headers.get("x-ratelimit-remaining")).toBe("0");

    const retryAfter = second.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter ?? "0", 10)).toBeGreaterThan(0);
  });

  it("disables rate limiting when env var is missing", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const { apiRateLimitsMinute, apiUsageHourly } = createRateLimitMocks([999]);

    mockedGetDb.mockResolvedValue({
      apiRateLimitsMinute,
      apiUsageHourly,
    } as any);
    delete process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE;

    const res = await app.request("/v1/sources", {
      headers: API_KEY_HEADER,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBeNull();
    expect(res.headers.get("x-ratelimit-remaining")).toBeNull();
    expect(res.headers.get("retry-after")).toBeNull();
    expect(apiRateLimitsMinute.incrementAndGetCount).not.toHaveBeenCalled();
  });
});

describe("GET /v1/sources", () => {
  it("returns 401 without API key", async () => {
    const res = await app.request("/v1/sources");
    expect(res.status).toBe(401);
  });

  it("returns sources with valid API key", async () => {
    const res = await app.request("/v1/sources", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("sources");
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBeGreaterThan(0);
    const source = body.sources[0];
    expect(source).toHaveProperty("id");
    expect(source).toHaveProperty("name");
    expect(source).toHaveProperty("url");
    expect(source).toHaveProperty("logoUrl");
  });

  it("returns 500 when LOCALITY is missing", async () => {
    const previousLocality = process.env.LOCALITY;
    delete process.env.LOCALITY;

    try {
      const res = await app.request("/v1/sources", {
        headers: API_KEY_HEADER,
      });

      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body).toEqual({
        error: "LOCALITY environment variable is required but not set",
      });
    } finally {
      if (previousLocality === undefined) {
        delete process.env.LOCALITY;
      } else {
        process.env.LOCALITY = previousLocality;
      }
    }
  });
});

describe("GET /v1/messages", () => {
  it("returns 401 without API key", async () => {
    const res = await app.request("/v1/messages");
    expect(res.status).toBe(401);
  });

  it("returns messages with valid API key", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const findMany = vi.fn().mockResolvedValue([
      {
        _id: "msg1",
        text: "Test message",
        createdAt: new Date("2025-01-01"),
        locality: "bg.sofia",
        source: "sofia-bg",
        geoJson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [23.32, 42.69],
              },
              properties: {},
            },
          ],
        },
        timespanEnd: new Date("2099-12-31"),
      },
    ]);
    mockedGetDb.mockResolvedValue({
      messages: {
        findMany,
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("messages");
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0]).toHaveProperty("id", "msg1");
    expect(body.messages[0]).toHaveProperty("text", "Test message");
    expect(body.messages[0]).toHaveProperty("geoJson");
    expect(findMany).toHaveBeenCalledWith({
      where: [
        { field: "timespanEnd", op: ">=", value: expect.any(Date) },
        { field: "locality", op: "==", value: "bg.sofia" },
      ],
      orderBy: [{ field: "timespanEnd", direction: "desc" }],
      limit: 200,
    });
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=300",
    );
  });

  it("sets aggressive Cache-Control for unbound requests", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const findMany = vi.fn().mockResolvedValue([
      {
        _id: "msg-cache-1",
        text: "Cached message",
        createdAt: new Date("2025-01-01"),
        locality: "bg.sofia",
        source: "sofia-bg",
        geoJson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [23.32, 42.69],
              },
              properties: {},
            },
          ],
        },
        timespanEnd: new Date("2099-12-31"),
      },
    ]);

    mockedGetDb.mockResolvedValue({
      messages: {
        findMany,
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const first = await app.request("/v1/messages", {
      headers: API_KEY_HEADER,
    });
    const second = await app.request("/v1/messages", {
      headers: API_KEY_HEADER,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(first.headers.get("cache-control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=300",
    );
    expect(second.headers.get("cache-control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=300",
    );
  });

  it("uses provided limit query parameter", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const findMany = vi.fn().mockResolvedValue([
      {
        _id: "msg-limit",
        text: "Limited message",
        createdAt: new Date("2025-01-01"),
        locality: "bg.sofia",
        source: "sofia-bg",
        geoJson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [23.32, 42.69],
              },
              properties: {},
            },
          ],
        },
        timespanEnd: new Date("2099-12-31"),
      },
    ]);

    mockedGetDb.mockResolvedValue({
      messages: {
        findMany,
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages?limit=25", {
      headers: API_KEY_HEADER,
    });

    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      where: [
        { field: "timespanEnd", op: ">=", value: expect.any(Date) },
        { field: "locality", op: "==", value: "bg.sofia" },
      ],
      orderBy: [{ field: "timespanEnd", direction: "desc" }],
      limit: 25,
    });
  });

  it("does not apply DB limit before viewport filtering for category queries", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const findMany = vi.fn().mockResolvedValue([
      {
        _id: "outside",
        text: "Outside viewport",
        createdAt: new Date("2025-01-01"),
        locality: "bg.sofia",
        source: "sofia-bg",
        categories: ["traffic"],
        geoJson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [10, 10],
              },
              properties: {},
            },
          ],
        },
        timespanEnd: new Date("2099-12-31"),
      },
      {
        _id: "inside",
        text: "Inside viewport",
        createdAt: new Date("2025-01-01"),
        locality: "bg.sofia",
        source: "sofia-bg",
        categories: ["traffic"],
        geoJson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [23.32, 42.69],
              },
              properties: {},
            },
          ],
        },
        timespanEnd: new Date("2099-12-31"),
      },
    ]);

    mockedGetDb.mockResolvedValue({
      messages: {
        findMany,
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request(
      "/v1/messages?categories=traffic&north=43&south=42&east=24&west=23&limit=1",
      {
        headers: API_KEY_HEADER,
      },
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toHaveProperty("id", "inside");
    expect(findMany).toHaveBeenCalledWith({
      where: [
        {
          field: "categories",
          op: "array-contains-any",
          value: ["traffic"],
        },
        { field: "timespanEnd", op: ">=", value: expect.any(Date) },
        { field: "locality", op: "==", value: "bg.sofia" },
      ],
      orderBy: [{ field: "timespanEnd", direction: "desc" }],
      limit: undefined,
    });
  });

  it("returns 500 when LOCALITY is missing", async () => {
    const previousLocality = process.env.LOCALITY;
    delete process.env.LOCALITY;

    try {
      const res = await app.request("/v1/messages", {
        headers: API_KEY_HEADER,
      });

      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body).toEqual({
        error: "LOCALITY environment variable is required but not set",
      });
    } finally {
      if (previousLocality === undefined) {
        delete process.env.LOCALITY;
      } else {
        process.env.LOCALITY = previousLocality;
      }
    }
  });

  it("returns empty messages when categories param is empty", async () => {
    const res = await app.request("/v1/messages?categories=", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.messages).toEqual([]);
  });

  it("backfills missing timespanStart from timespanEnd", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const endDate = new Date("2026-04-20T10:00:00.000Z");

    mockedGetDb.mockResolvedValue({
      messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            _id: "msg-timespan-end-only",
            text: "Timespan fallback message",
            createdAt: new Date("2026-04-15T10:00:00.000Z"),
            locality: "bg.sofia",
            source: "sofia-bg",
            geoJson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [23.32, 42.69],
                  },
                  properties: {},
                },
              ],
            },
            timespanEnd: endDate,
          },
        ]),
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages", {
      headers: API_KEY_HEADER,
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toHaveProperty(
      "timespanStart",
      endDate.toISOString(),
    );
    expect(body.messages[0]).toHaveProperty(
      "timespanEnd",
      endDate.toISOString(),
    );
  });

  it("backfills missing timespanStart and timespanEnd from finalizedAt", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    const finalizedAt = new Date("2026-04-21T12:30:00.000Z");

    mockedGetDb.mockResolvedValue({
      messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            _id: "msg-timespan-missing",
            text: "Timespan fully missing",
            createdAt: new Date("2026-04-15T10:00:00.000Z"),
            finalizedAt,
            locality: "bg.sofia",
            source: "sofia-bg",
            geoJson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [23.32, 42.69],
                  },
                  properties: {},
                },
              ],
            },
          },
        ]),
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages", {
      headers: API_KEY_HEADER,
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toHaveProperty(
      "timespanStart",
      finalizedAt.toISOString(),
    );
    expect(body.messages[0]).toHaveProperty(
      "timespanEnd",
      finalizedAt.toISOString(),
    );
  });

  it("skips malformed records instead of failing the whole response", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    mockedGetDb.mockResolvedValue({
      messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            _id: "broken-message",
            text: "Broken",
            createdAt: null,
            locality: "bg.sofia",
            source: "sofia-bg",
            geoJson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [23.32, 42.69],
                  },
                  properties: {},
                },
              ],
            },
            timespanEnd: new Date("2099-12-31"),
          },
          {
            _id: "valid-message",
            text: "Valid message",
            createdAt: new Date("2025-01-01"),
            locality: "bg.sofia",
            source: "sofia-bg",
            geoJson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [23.33, 42.7],
                  },
                  properties: {},
                },
              ],
            },
            timespanEnd: new Date("2099-12-31"),
          },
        ]),
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toHaveProperty("id", "valid-message");
  });
});

describe("GET /v1/messages/by-id", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 without API key", async () => {
    const res = await app.request("/v1/messages/by-id?id=abc123");
    expect(res.status).toBe(401);
  });

  it("returns 400 without id parameter", async () => {
    const res = await app.request("/v1/messages/by-id", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/Missing id/i);
  });

  it("returns message by 8-char ID", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    mockedGetDb.mockResolvedValue({
      messages: {
        findById: vi.fn().mockResolvedValue({
          _id: "abcd1234",
          text: "Found message",
          createdAt: new Date("2025-01-01"),
          locality: "bg.sofia",
        }),
        findMany: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages/by-id?id=abcd1234", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.message).toHaveProperty("id", "abcd1234");
  });

  it("returns 404 when message not found", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    mockedGetDb.mockResolvedValue({
      messages: {
        findById: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
        findBySourceDocumentIds: vi.fn().mockResolvedValue([]),
      },
      apiClients: {
        findByApiKey: vi.fn(),
      },
    } as any);

    const res = await app.request("/v1/messages/by-id?id=notfound", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/openapi", () => {
  it("returns OpenAPI spec without auth", async () => {
    const res = await app.request("/v1/openapi");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("openapi", "3.0.0");
    expect(body?.info?.title).toContain("OboApp");
    expect(body).toHaveProperty("paths");
    expect(body.paths).toHaveProperty("/v1/sources");
    expect(body.paths).toHaveProperty("/v1/messages");
    expect(body.paths).toHaveProperty("/v1/messages/by-id");
    const limitParam = body.paths["/v1/messages"]?.get?.parameters?.find(
      (parameter: any) =>
        parameter?.name === "limit" && parameter?.in === "query",
    );
    const limitSchema = limitParam?.schema;
    expect(limitSchema?.type).toBe("integer");
    expect(limitSchema?.minimum).toBe(1);
    expect(typeof limitSchema?.maximum).toBe("number");
  });
});

describe("GET /v1/docs", () => {
  it("returns HTML page without auth", async () => {
    const res = await app.request("/v1/docs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("api-reference");
  });
});

describe("GET /", () => {
  it("redirects to docs", async () => {
    const res = await app.request(
      new Request("http://localhost/", { redirect: "manual" }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/v1/docs");
  });
});

describe("404 handler", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });
});
