import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import { getDb } from "../lib/db";

vi.mock("../lib/db", () => ({
  getDb: vi.fn(),
}));

const { selectedSources } = vi.hoisted(() => {
  return { selectedSources: [] as import("@oboapp/shared").SourceDefinition[] };
});

vi.mock("@oboapp/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oboapp/shared")>();
  return { ...actual, SOURCES: selectedSources };
});

const endpoint = "/v1/sources/toplo-bg/snapshot";
const headers = { "X-Api-Key": "test-api-key" };
const observedAt = "2026-11-09T19:30:00.000Z";
const snapshot = {
  sourceType: "toplo-bg",
  locality: "bg.sofia",
  count: 99,
  observedAt,
};

const findLatest = vi.fn();
const incrementUsage = vi.fn();
const incrementRateLimit = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  selectedSources.splice(0, selectedSources.length, {
    id: "toplo-bg",
    name: "Топлофикация София",
    url: "https://toplo.bg/accidents-and-maintenance",
    localities: ["bg.sofia"],
    emergent: true,
  });
  vi.stubEnv("PUBLIC_API_KEYS", "test-api-key");
  vi.stubEnv("LOCALITY", "bg.sofia");
  vi.stubEnv("PUBLIC_API_RATE_LIMIT_PER_MINUTE", "");
  vi.spyOn(console, "error").mockImplementation(() => {});

  findLatest.mockResolvedValue(snapshot);
  incrementUsage.mockResolvedValue(undefined);
  incrementRateLimit.mockResolvedValue(1);
  vi.mocked(getDb).mockResolvedValue({
    sourceSnapshots: { findLatest },
    apiUsageHourly: { increment: incrementUsage },
    apiRateLimitsMinute: { incrementAndGetCount: incrementRateLimit },
    apiClients: { findByApiKey: vi.fn().mockResolvedValue(null) },
  } as unknown as Awaited<ReturnType<typeof getDb>>);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /v1/sources/:sourceId/snapshot", () => {
  it("requires an API key before reading snapshots", async () => {
    const response = await app.request(endpoint);

    expect(response.status).toBe(401);
    expect(findLatest).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key", async () => {
    const response = await app.request(endpoint, {
      headers: { "X-Api-Key": "invalid-snapshot-key" },
    });

    expect(response.status).toBe(401);
    expect(findLatest).not.toHaveBeenCalled();
  });

  it("returns the stored count and observation time with the configured source URL", async () => {
    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      snapshot: {
        ...snapshot,
        sourceUrl: "https://toplo.bg/accidents-and-maintenance",
      },
    });
    expect(findLatest).toHaveBeenCalledWith("toplo-bg", "bg.sofia");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(incrementUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint,
        method: "GET",
        statusClass: "2xx",
      }),
    );
  });

  it("returns a verified zero count", async () => {
    findLatest.mockResolvedValue({ ...snapshot, count: 0 });

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      snapshot: {
        ...snapshot,
        count: 0,
        sourceUrl: "https://toplo.bg/accidents-and-maintenance",
      },
    });
  });

  it("returns only the public count fields from a detailed capture", async () => {
    findLatest.mockResolvedValue({
      ...snapshot,
      incidents: [{ id: "internal-incident" }],
      internalNote: "stored metadata",
    });

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      snapshot: {
        ...snapshot,
        sourceUrl: "https://toplo.bg/accidents-and-maintenance",
      },
    });
  });

  it("distinguishes unavailable snapshots from zero", async () => {
    findLatest.mockResolvedValue(null);

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "No successful snapshot available for this source",
    });
  });

  it("rejects sources absent from the instance configuration", async () => {
    selectedSources.splice(0);

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Source not found" });
    expect(findLatest).not.toHaveBeenCalled();
  });

  it("rejects an unknown source", async () => {
    const response = await app.request("/v1/sources/unknown/snapshot", {
      headers,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Source not found" });
    expect(findLatest).not.toHaveBeenCalled();
  });

  it("rejects a source outside the configured locality", async () => {
    vi.stubEnv("LOCALITY", "bg.plovdiv");

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Source not found" });
    expect(findLatest).not.toHaveBeenCalled();
  });

  it("requires a configured locality", async () => {
    vi.stubEnv("LOCALITY", "");

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "LOCALITY environment variable is required but not set",
    });
    expect(findLatest).not.toHaveBeenCalled();
  });

  it("reports database failures without returning a count", async () => {
    findLatest.mockRejectedValue(new Error("Database unavailable"));

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to fetch source snapshot",
    });
  });

  it.each([
    { count: -1 },
    { count: 1.5 },
    { count: Number.NaN },
    { observedAt: "2026-11-09" },
    { observedAt: "2026-11-09T19:30:00" },
  ])("rejects malformed stored count fields: %j", async (fields) => {
    findLatest.mockResolvedValue({ ...snapshot, ...fields });

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to fetch source snapshot",
    });
  });

  it("applies the existing API rate limit", async () => {
    vi.stubEnv("PUBLIC_API_RATE_LIMIT_PER_MINUTE", "1");
    incrementRateLimit.mockResolvedValue(2);

    const response = await app.request(endpoint, { headers });

    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(response.headers.get("Retry-After")).not.toBeNull();
    expect(findLatest).not.toHaveBeenCalled();
  });
});
