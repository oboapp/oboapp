// @vitest-environment node

import { resolve } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  default: { readFile: readFileMock },
}));

const ring = [
  [23.2, 42.6],
  [23.4, 42.6],
  [23.4, 42.8],
  [23.2, 42.6],
];
const polygonBoundary = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {},
  }],
};

function requestBoundary(locality = "bg.sofia") {
  return GET(new Request("http://localhost/api/localities/test/boundary"), {
    params: Promise.resolve({ locality }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readFileMock.mockResolvedValue(JSON.stringify(polygonBoundary));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/localities/[locality]/boundary", () => {
  it("returns the canonical locality boundary with public cache headers", async () => {
    const response = await requestBoundary();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(polygonBoundary);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    );
    expect(readFileMock).toHaveBeenCalledWith(
      resolve(process.cwd(), "..", "ingest", "localities", "bg.sofia.geojson"),
      "utf-8",
    );
  });

  it("preserves MultiPolygon boundaries and polygon holes", async () => {
    const hole = [
      [23.25, 42.65],
      [23.3, 42.65],
      [23.3, 42.7],
      [23.25, 42.65],
    ];
    const multiPolygonBoundary = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates: [[ring, hole], [ring]] },
        properties: { name: "Boundary" },
      }],
    };
    readFileMock.mockResolvedValue(JSON.stringify(multiPolygonBoundary));

    const response = await requestBoundary();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(multiPolygonBoundary);
  });

  it.each(["unknown", "../secret", "..\\secret", "%2e%2e%2fsecret", "__proto__", "constructor"])(
    "rejects unregistered locality %s before reading a file",
    async (locality) => {
      const response = await requestBoundary(locality);

      expect(response.status).toBe(404);
      expect(readFileMock).not.toHaveBeenCalled();
    },
  );

  it("returns 404 when a registered locality has no boundary file", async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error("Missing"), { code: "ENOENT" }));

    const response = await requestBoundary();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Locality boundary unavailable" });
    expect(response.headers.has("Cache-Control")).toBe(false);
  });

  it.each([
    "invalid JSON",
    JSON.stringify({ type: "FeatureCollection", features: [] }),
    JSON.stringify({
      ...polygonBoundary,
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [23.3, 42.7] } }],
    }),
    JSON.stringify({
      ...polygonBoundary,
      features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[23.3, 42.7]] } }],
    }),
    JSON.stringify({
      ...polygonBoundary,
      features: [{
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...ring.slice(0, 3), [23.25, 42.65]]] },
      }],
    }),
  ])("returns 500 for malformed boundary data", async (content) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readFileMock.mockResolvedValue(content);

    const response = await requestBoundary();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load locality boundary" });
    expect(response.headers.has("Cache-Control")).toBe(false);
  });

  it("reports file errors without exposing the filesystem path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readFileMock.mockRejectedValue(new Error("Access denied to private filesystem path"));

    const response = await requestBoundary();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load locality boundary" });
  });
});
