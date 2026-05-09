import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const VALID_GEOCODING_RESOLVERS = {
  pins: { provider: "google" as const },
  streets: { provider: "overpass" as const },
  "cadastral-properties": { provider: "cadastre" as const },
  "bus-stops": { provider: "gtfs" as const, url: "https://gtfs.example.com/api/v1/static" },
  "educational-facilities": {
    provider: "educational-facilities" as const,
    "schools-url": "https://api.example.com/schools",
    "kindergartens-url": "https://api.example.com/kindergartens",
  },
};

beforeEach(() => {
  // Reset module cache so the per-module singleton (cachedSources) starts null
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getLocalityDataSources()", () => {
  it("loads and returns a valid config with all resolvers", async () => {
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: VALID_GEOCODING_RESOLVERS,
    }));
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
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: VALID_GEOCODING_RESOLVERS,
    }));
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const first = getLocalityDataSources();
    const second = getLocalityDataSources();

    expect(first).toBe(second);
  });

  it("accepts skip for cadastral-properties", async () => {
    const resolversWithSkip = {
      ...VALID_GEOCODING_RESOLVERS,
      "cadastral-properties": { provider: "skip" as const },
    };
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: resolversWithSkip,
    }));
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();
    expect(config["geocoding-resolvers"]["cadastral-properties"]).toEqual({
      provider: "skip",
    });
  });

  it("accepts skip for bus-stops", async () => {
    const resolversWithSkip = {
      ...VALID_GEOCODING_RESOLVERS,
      "bus-stops": { provider: "skip" as const },
    };
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: resolversWithSkip,
    }));
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();
    expect(config["geocoding-resolvers"]["bus-stops"]).toEqual({
      provider: "skip",
    });
  });

  it("accepts skip for educational-facilities", async () => {
    const resolversWithSkip = {
      ...VALID_GEOCODING_RESOLVERS,
      "educational-facilities": { provider: "skip" as const },
    };
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: resolversWithSkip,
    }));
    const { getLocalityDataSources } = await import("./locality-data-sources");

    const config = getLocalityDataSources();
    expect(config["geocoding-resolvers"]["educational-facilities"]).toEqual({
      provider: "skip",
    });
  });
});

describe("loadLocalityDataSources() error handling", () => {
  it("throws when a required resolver (e.g. bus-stops) is missing", async () => {
    const incompleteResolvers = {
      pins: { provider: "google" as const },
      streets: { provider: "overpass" as const },
      "cadastral-properties": { provider: "skip" as const },
      "educational-facilities": { provider: "skip" as const },
      // missing "bus-stops"
    };
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: incompleteResolvers,
    }));
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Invalid GEOCODING_RESOLVERS export from @oboapp\/shared/,
    );
  });

  it("throws when gtfs provider is missing required url field", async () => {
    const badResolvers = {
      ...VALID_GEOCODING_RESOLVERS,
      "bus-stops": { provider: "gtfs" as const },
      // missing url
    };
    vi.doMock("@oboapp/shared", () => ({
      GEOCODING_RESOLVERS: badResolvers,
    }));
    const { getLocalityDataSources } = await import("./locality-data-sources");

    expect(() => getLocalityDataSources()).toThrow(
      /Invalid GEOCODING_RESOLVERS export from @oboapp\/shared/,
    );
  });
});
