import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// validateLocality is a registry check against known localities (bg.sofia etc.).
// Test uses a synthetic "test.locality" that's not in the registry — mock it out.
vi.mock("@oboapp/shared", () => ({
  validateLocality: vi.fn(),
}));

const VALID_YAML = `
geocoding-resolvers:
  pins:
    provider: google
  streets:
    provider: overpass
  cadastral-properties:
    provider: cadastre
  bus-stops:
    provider: gtfs
    url: https://gtfs.example.com/api/v1/static
  educational-facilities:
    provider: educational-facilities
    schools-url: https://api.example.com/schools
    kindergartens-url: https://api.example.com/kindergartens
`.trim();

let tempDir: string;
let localitiesDir: string;

beforeEach(() => {
  // Reset module cache so the per-module singleton (cachedSources) starts null
  vi.resetModules();

  tempDir = mkdtempSync(join(tmpdir(), "locality-sources-test-"));
  localitiesDir = join(tempDir, "localities");
  mkdirSync(localitiesDir, { recursive: true });

  // Redirect process.cwd() so loadLocalityDataSources() resolves paths into tempDir
  vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  process.env.LOCALITY = "test.locality";
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.LOCALITY;
});

describe("getLocalityDataSources()", () => {
  it("loads and returns a valid config with all resolvers", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();

    expect(config["geocoding-resolvers"].pins).toEqual({ provider: "google" });
    expect(config["geocoding-resolvers"].streets).toEqual({
      provider: "overpass",
    });
    expect(config["geocoding-resolvers"]["cadastral-properties"]).toEqual({
      provider: "cadastre",
    });
    expect(config["geocoding-resolvers"]["bus-stops"]).toEqual({
      provider: "gtfs",
      url: "https://gtfs.example.com/api/v1/static",
    });
    expect(config["geocoding-resolvers"]["educational-facilities"]).toEqual({
      provider: "educational-facilities",
      "schools-url": "https://api.example.com/schools",
      "kindergartens-url": "https://api.example.com/kindergartens",
    });
  });

  it("returns the cached instance on subsequent calls", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), VALID_YAML);
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const first = getLocalityDataSources();
    const second = getLocalityDataSources();

    expect(first).toBe(second);
  });

  it("accepts skip for cadastral-properties", async () => {
    writeFileSync(
      join(localitiesDir, "test.locality.yaml"),
      VALID_YAML.replace("provider: cadastre", "provider: skip"),
    );
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();
    expect(config["geocoding-resolvers"]["cadastral-properties"]).toEqual({
      provider: "skip",
    });
  });

  it("accepts skip for bus-stops", async () => {
    writeFileSync(
      join(localitiesDir, "test.locality.yaml"),
      VALID_YAML.replace(
        "provider: gtfs\n    url: https://gtfs.example.com/api/v1/static",
        "provider: skip",
      ),
    );
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();
    expect(config["geocoding-resolvers"]["bus-stops"]).toEqual({
      provider: "skip",
    });
  });

  it("accepts skip for educational-facilities", async () => {
    const skipYaml = `
geocoding-resolvers:
  pins:
    provider: google
  streets:
    provider: overpass
  cadastral-properties:
    provider: skip
  bus-stops:
    provider: skip
  educational-facilities:
    provider: skip
`.trim();
    writeFileSync(join(localitiesDir, "test.locality.yaml"), skipYaml);
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();
    expect(config["geocoding-resolvers"]["educational-facilities"]).toEqual({
      provider: "skip",
    });
  });
});

describe("loadLocalityDataSources() error handling", () => {
  it("throws a file-not-found error for ENOENT — not a generic message", async () => {
    // Do NOT write the YAML file => real readFileSync throws ENOENT
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Locality data sources file not found for "test\.locality"/,
    );
  });

  it("includes hint to create the file in the ENOENT message", async () => {
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Create localities\/test\.locality\.yaml/,
    );
  });

  it("throws a distinct 'Invalid YAML' error for YAML parse failures", async () => {
    writeFileSync(
      join(localitiesDir, "test.locality.yaml"),
      "{ invalid yaml {{{",
    );
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(/Invalid YAML/);
  });

  it("throws a schema validation error when geocoding-resolvers is missing", async () => {
    writeFileSync(join(localitiesDir, "test.locality.yaml"), "other-key: val");
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Invalid locality data sources file/,
    );
  });

  it("throws when a required resolver (e.g. bus-stops) is missing", async () => {
    const missingBusStops = `
geocoding-resolvers:
  pins:
    provider: google
  streets:
    provider: overpass
  cadastral-properties:
    provider: skip
  educational-facilities:
    provider: skip
`.trim();
    writeFileSync(join(localitiesDir, "test.locality.yaml"), missingBusStops);
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Invalid locality data sources file/,
    );
  });

  it("throws when gtfs provider is missing required url field", async () => {
    const noUrl = VALID_YAML.replace(
      "provider: gtfs\n    url: https://gtfs.example.com/api/v1/static",
      "provider: gtfs",
    );
    writeFileSync(join(localitiesDir, "test.locality.yaml"), noUrl);
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Invalid locality data sources file/,
    );
  });
});
