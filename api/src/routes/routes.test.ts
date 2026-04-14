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

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
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

  it("includes Deprecation header", async () => {
    const res = await app.request("/v1/sources", { headers: API_KEY_HEADER });
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBeTruthy();
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
    mockedGetDb.mockResolvedValue({
      messages: {
        findMany: vi.fn().mockResolvedValue([
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
    expect(body).toHaveProperty("messages");
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0]).toHaveProperty("id", "msg1");
    expect(body.messages[0]).toHaveProperty("text", "Test message");
    expect(body.messages[0]).toHaveProperty("geoJson");
  });

  it("returns empty messages when categories param is empty", async () => {
    const res = await app.request("/v1/messages?categories=", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.messages).toEqual([]);
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

  it("contains deprecation banner linking to /v2/docs", async () => {
    const res = await app.request("/v1/docs");
    const html = await res.text();
    expect(html).toContain("/v2/docs");
    expect(html).toContain("deprecated");
  });
});

describe("GET /v2/sources", () => {
  it("returns 401 without API key", async () => {
    const res = await app.request("/v2/sources");
    expect(res.status).toBe(401);
  });

  it("returns sources with valid API key", async () => {
    const res = await app.request("/v2/sources", {
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

  it("does NOT include Deprecation header", async () => {
    const res = await app.request("/v2/sources", {
      headers: API_KEY_HEADER,
    });
    expect(res.headers.get("Deprecation")).toBeNull();
  });
});

describe("GET /v2/messages", () => {
  it("returns 401 without API key", async () => {
    const res = await app.request("/v2/messages");
    expect(res.status).toBe(401);
  });

  it("returns messages without pipeline-internal fields", async () => {
    const { getDb } = await import("@/lib/db");
    const mockedGetDb = vi.mocked(getDb);
    mockedGetDb.mockResolvedValue({
      messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            _id: "msg2",
            text: "Test v2 message",
            createdAt: new Date("2025-01-01"),
            locality: "bg.sofia",
            source: "sofia-bg",
            geoJson: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [23.32, 42.69] },
                  properties: {},
                },
              ],
            },
            timespanEnd: new Date("2099-12-31"),
            addresses: [
              {
                originalText: "some street",
                formattedAddress: "Some Street 1",
                coordinates: { lat: 42.69, lng: 23.32 },
              },
            ],
            pins: [{ address: "pin", timespans: [] }],
            streets: [{ street: "Main St", from: "A", to: "B", timespans: [] }],
            cadastralProperties: [{ identifier: "12345", timespans: [] }],
            busStops: ["Stop 1"],
          },
        ]),
        findById: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: { findByApiKey: vi.fn() },
    } as any);

    const res = await app.request("/v2/messages", { headers: API_KEY_HEADER });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("messages");
    const msg = body.messages[0];
    expect(msg).toHaveProperty("id", "msg2");
    expect(msg).toHaveProperty("text", "Test v2 message");
    expect(msg).toHaveProperty("geoJson");
    // Pipeline-internal fields must be absent
    expect(msg).not.toHaveProperty("addresses");
    expect(msg).not.toHaveProperty("pins");
    expect(msg).not.toHaveProperty("streets");
    expect(msg).not.toHaveProperty("cadastralProperties");
    expect(msg).not.toHaveProperty("busStops");
  });

  it("does NOT include Deprecation header", async () => {
    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockResolvedValue({
      messages: { findMany: vi.fn().mockResolvedValue([]) },
      apiClients: { findByApiKey: vi.fn() },
    } as any);

    const res = await app.request("/v2/messages", { headers: API_KEY_HEADER });
    expect(res.headers.get("Deprecation")).toBeNull();
  });
});

describe("GET /v2/messages/by-id", () => {
  it("returns 401 without API key", async () => {
    const res = await app.request("/v2/messages/by-id?id=abc123");
    expect(res.status).toBe(401);
  });

  it("returns 400 without id parameter", async () => {
    const res = await app.request("/v2/messages/by-id", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/Missing id/i);
  });

  it("returns v2 message without pipeline-internal fields", async () => {
    const { getDb } = await import("@/lib/db");
    vi.mocked(getDb).mockResolvedValue({
      messages: {
        findById: vi.fn().mockResolvedValue({
          _id: "abcd1234",
          text: "Found v2 message",
          createdAt: new Date("2025-01-01"),
          locality: "bg.sofia",
          addresses: [
            {
              originalText: "addr",
              formattedAddress: "Addr 1",
              coordinates: { lat: 42, lng: 23 },
            },
          ],
          pins: [{ address: "pin", timespans: [] }],
        }),
        findMany: vi.fn(),
        findBySourceDocumentIds: vi.fn(),
      },
      apiClients: { findByApiKey: vi.fn() },
    } as any);

    const res = await app.request("/v2/messages/by-id?id=abcd1234", {
      headers: API_KEY_HEADER,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.message).toHaveProperty("id", "abcd1234");
    expect(body.message).not.toHaveProperty("addresses");
    expect(body.message).not.toHaveProperty("pins");
    expect(body.message).not.toHaveProperty("streets");
    expect(body.message).not.toHaveProperty("cadastralProperties");
    expect(body.message).not.toHaveProperty("busStops");
  });
});

describe("GET /v2/openapi", () => {
  it("returns OpenAPI spec without auth", async () => {
    const res = await app.request("/v2/openapi");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("openapi", "3.0.0");
    expect(body?.info?.version).toBe("2.0.0");
    expect(body?.info?.title).toContain("OboApp");
    expect(body).toHaveProperty("paths");
    expect(body.paths).toHaveProperty("/v2/sources");
    expect(body.paths).toHaveProperty("/v2/messages");
    expect(body.paths).toHaveProperty("/v2/messages/by-id");
  });

  it("does not contain v1 paths", async () => {
    const res = await app.request("/v2/openapi");
    const body: any = await res.json();
    expect(body.paths).not.toHaveProperty("/v1/sources");
    expect(body.paths).not.toHaveProperty("/v1/messages");
  });
});

describe("GET /v2/docs", () => {
  it("returns HTML page without auth", async () => {
    const res = await app.request("/v2/docs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("api-reference");
    expect(html).toContain("/v2/openapi");
  });

  it("does NOT contain a deprecation banner", async () => {
    const res = await app.request("/v2/docs");
    const html = await res.text();
    expect(html).not.toContain("deprecated");
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
