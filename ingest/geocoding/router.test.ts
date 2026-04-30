import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firebase-dependent imports to avoid initialization errors
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./gtfs/geocoding-service", () => ({
  geocodeBusStops: vi.fn(),
}));

vi.mock("./google/service", () => ({
  geocodeAddresses: vi.fn(),
}));

vi.mock("./overpass/service", () => ({
  overpassGeocodeAddresses: vi.fn(),
  overpassGeocodeIntersections: vi.fn(),
}));

vi.mock("./cadastre/service", () => ({
  geocodeCadastralProperties: vi.fn(),
}));

vi.mock("./educational-facilities/geocoding-service", () => ({
  geocodeEducationalFacilities: vi.fn(),
}));

const DEFAULT_RESOLVERS = {
  "geocoding-resolvers": {
    pins: { provider: "google" as const },
    streets: { provider: "overpass" as const },
    "cadastral-properties": { provider: "cadastre" as const },
    "bus-stops": { provider: "gtfs" as const, url: "https://gtfs.example.com" },
    "educational-facilities": {
      provider: "educational-facilities" as const,
      "schools-url": "https://schools.example.com",
      "kindergartens-url": "https://kindergartens.example.com",
    },
  },
};

vi.mock("@/lib/locality-data-sources", () => ({
  getLocalityDataSources: vi.fn(() => DEFAULT_RESOLVERS),
}));

import { getLocalityDataSources } from "@/lib/locality-data-sources";
import {
  hasHouseNumber,
  buildHouseNumberQuery,
  geocodeAddresses,
  geocodeStreets,
  geocodeBusStops,
  geocodeEducationalFacilities,
  geocodeCadastralPropertiesFromIdentifiers,
} from "./router";
import { geocodeAddresses as googleService } from "./google/service";
import { overpassGeocodeAddresses } from "./overpass/service";
import { geocodeBusStops as gtfsService } from "./gtfs/geocoding-service";
import { geocodeEducationalFacilities as eduFacilitiesService } from "./educational-facilities/geocoding-service";
import { geocodeCadastralProperties as cadastreService } from "./cadastre/service";

describe("buildHouseNumberQuery", () => {
  it("prefixes street name when endpoint is just a number", () => {
    expect(buildHouseNumberQuery("ул. Оборище", "111")).toBe("ул. Оборище 111");
  });

  it("prefixes street name when endpoint is №-style number", () => {
    expect(buildHouseNumberQuery("ул. Оборище", "№111")).toBe(
      "ул. Оборище №111",
    );
  });

  it("does NOT prefix when endpoint already contains the street name", () => {
    expect(buildHouseNumberQuery("ул. Оборище", "ул. Оборище №111")).toBe(
      "ул. Оборище №111",
    );
  });

  it("does NOT prefix when endpoint contains the street name with extra context", () => {
    expect(
      buildHouseNumberQuery("ул. Оборище", "сградата на ул. Оборище №111"),
    ).toBe("сградата на ул. Оборище №111");
  });

  it("handles case-insensitive matching", () => {
    expect(buildHouseNumberQuery("Ул. Оборище", "ул. оборище №111")).toBe(
      "ул. оборище №111",
    );
  });

  it("trims whitespace from both inputs", () => {
    expect(buildHouseNumberQuery("  ул. Оборище  ", "  №111  ")).toBe(
      "ул. Оборище №111",
    );
  });

  it("prefixes when endpoint has a different street name", () => {
    expect(buildHouseNumberQuery("ул. Оборище", "ул. Граф Игнатиев №5")).toBe(
      "ул. Оборище ул. Граф Игнатиев №5",
    );
  });

  it("prefixes for бл.-style endpoint", () => {
    expect(buildHouseNumberQuery("ул. Витоша", "бл. 38")).toBe(
      "ул. Витоша бл. 38",
    );
  });
});

describe("hasHouseNumber", () => {
  describe("should detect house numbers with №", () => {
    it("detects number symbol with digits", () => {
      expect(hasHouseNumber("ул. Оборище №111")).toBe(true);
    });

    it("detects number symbol with space before digits", () => {
      expect(hasHouseNumber("сградата с № 65")).toBe(true);
    });

    it("detects number symbol without space", () => {
      expect(hasHouseNumber("№38")).toBe(true);
    });

    it("handles multiple spaces", () => {
      expect(hasHouseNumber("№  42")).toBe(true);
    });
  });

  describe("should detect building numbers with бл.", () => {
    it("detects бл. with space and number", () => {
      expect(hasHouseNumber("бл. №38")).toBe(true);
    });

    it("detects бл. without space before number", () => {
      expect(hasHouseNumber("бл.5")).toBe(true);
    });

    it("detects бл. with space before number", () => {
      expect(hasHouseNumber("бл. 12")).toBe(true);
    });
  });

  describe("should detect building references with 'сградата'", () => {
    it("detects сградата with number", () => {
      expect(hasHouseNumber("сградата с № 65")).toBe(true);
    });

    it("rejects СГРАДАТА without number", () => {
      expect(hasHouseNumber("СГРАДАТА")).toBe(false);
    });

    it("rejects сГрАдАтА without number", () => {
      expect(hasHouseNumber("сГрАдАтА")).toBe(false);
    });

    it("rejects сградата alone", () => {
      expect(hasHouseNumber("сградата")).toBe(false);
    });
  });

  describe("should handle case insensitivity for бл.", () => {
    it("detects БЛ. (uppercase)", () => {
      expect(hasHouseNumber("БЛ. №38")).toBe(true);
    });

    it("detects Бл. (title case)", () => {
      expect(hasHouseNumber("Бл. 15")).toBe(true);
    });
  });

  describe("should reject non-house-number endpoints", () => {
    it("rejects simple street name", () => {
      expect(hasHouseNumber("ул. Оборище")).toBe(false);
    });

    it("rejects neighborhood name", () => {
      expect(hasHouseNumber("кв. Лозенец")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(hasHouseNumber("")).toBe(false);
    });

    it("rejects cross street", () => {
      expect(hasHouseNumber("ул. Граф Игнатиев")).toBe(false);
    });

    it("rejects number symbol without digits", () => {
      expect(hasHouseNumber("№")).toBe(false);
    });

    it("rejects бл without digits", () => {
      expect(hasHouseNumber("бл.")).toBe(false);
    });

    it("rejects сграда (typo - missing 'та')", () => {
      expect(hasHouseNumber("сграда")).toBe(false);
    });
  });

  describe("should detect standalone numbers", () => {
    it("detects plain number", () => {
      expect(hasHouseNumber("14")).toBe(true);
    });

    it("detects number with Cyrillic letter suffix", () => {
      expect(hasHouseNumber("25Б")).toBe(true);
    });

    it("detects number with lowercase letter suffix", () => {
      expect(hasHouseNumber("3а")).toBe(true);
    });

    it("rejects number with Latin letter (not standalone address)", () => {
      expect(hasHouseNumber("14A")).toBe(false);
    });
  });

  describe("should detect 'номер' pattern", () => {
    it("detects номер with number", () => {
      expect(hasHouseNumber("номер 3")).toBe(true);
    });

    it("detects номер with larger number", () => {
      expect(hasHouseNumber("номер 15")).toBe(true);
    });

    it("detects НОМЕР (case insensitive)", () => {
      expect(hasHouseNumber("НОМЕР 7")).toBe(true);
    });

    it("rejects номер without number", () => {
      expect(hasHouseNumber("номер")).toBe(false);
    });
  });

  describe("should handle complex real-world examples", () => {
    it("detects in compound description", () => {
      expect(hasHouseNumber("ул. Граф Игнатиев №123")).toBe(true);
    });

    it("detects multiple indicators", () => {
      expect(hasHouseNumber("бл. 5 №123")).toBe(true);
    });

    it("rejects when number is part of street name", () => {
      expect(hasHouseNumber("ул. 6-ти септември")).toBe(false);
    });
  });
});

describe("provider dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLocalityDataSources).mockReturnValue(DEFAULT_RESOLVERS as any);
    vi.mocked(googleService).mockResolvedValue([]);
    vi.mocked(overpassGeocodeAddresses).mockResolvedValue([]);
    vi.mocked(gtfsService).mockResolvedValue([]);
    vi.mocked(eduFacilitiesService).mockResolvedValue([]);
  });

  describe("geocodeAddresses", () => {
    it("calls Google when pins provider is google", async () => {
      await geocodeAddresses(["ул. Test 1"]);
      expect(vi.mocked(googleService)).toHaveBeenCalledWith(["ул. Test 1"]);
      expect(vi.mocked(overpassGeocodeAddresses)).not.toHaveBeenCalled();
    });

    it("calls Overpass when pins provider is overpass", async () => {
      vi.mocked(getLocalityDataSources).mockReturnValue({
        ...DEFAULT_RESOLVERS,
        "geocoding-resolvers": {
          ...DEFAULT_RESOLVERS["geocoding-resolvers"],
          pins: { provider: "overpass" },
        },
      } as any);

      await geocodeAddresses(["ул. Test 1"]);
      expect(vi.mocked(overpassGeocodeAddresses)).toHaveBeenCalledWith(["ул. Test 1"]);
      expect(vi.mocked(googleService)).not.toHaveBeenCalled();
    });
  });

  describe("geocodeStreets", () => {
    const streets = [{ street: "ул. Test", from: "A", to: "B", timespans: [] }];

    it("calls Overpass when streets provider is overpass", async () => {
      await geocodeStreets(streets);
      expect(vi.mocked(overpassGeocodeAddresses)).toHaveBeenCalledWith(["A", "B"]);
      expect(vi.mocked(googleService)).not.toHaveBeenCalled();
    });

    it("calls Google when streets provider is google", async () => {
      vi.mocked(getLocalityDataSources).mockReturnValue({
        ...DEFAULT_RESOLVERS,
        "geocoding-resolvers": {
          ...DEFAULT_RESOLVERS["geocoding-resolvers"],
          streets: { provider: "google" },
        },
      } as any);

      await geocodeStreets(streets);
      expect(vi.mocked(googleService)).toHaveBeenCalledWith(["A", "B"]);
      expect(vi.mocked(overpassGeocodeAddresses)).not.toHaveBeenCalled();
    });
  });

  describe("geocodeBusStops", () => {
    it("returns [] immediately for empty input without calling any provider", async () => {
      const result = await geocodeBusStops([]);
      expect(result).toEqual([]);
      expect(vi.mocked(gtfsService)).not.toHaveBeenCalled();
    });

    it("calls GTFS service when provider is gtfs", async () => {
      await geocodeBusStops(["1234"]);
      expect(vi.mocked(gtfsService)).toHaveBeenCalledWith(["1234"]);
    });

    it("returns [] when provider is skip", async () => {
      vi.mocked(getLocalityDataSources).mockReturnValue({
        ...DEFAULT_RESOLVERS,
        "geocoding-resolvers": {
          ...DEFAULT_RESOLVERS["geocoding-resolvers"],
          "bus-stops": { provider: "skip" },
        },
      } as any);

      const result = await geocodeBusStops(["1234"]);
      expect(result).toEqual([]);
      expect(vi.mocked(gtfsService)).not.toHaveBeenCalled();
      expect(vi.mocked(googleService)).not.toHaveBeenCalled();
    });
  });

  describe("geocodeEducationalFacilities", () => {
    const facilities = [{ type: "school", number: "1" }];

    it("returns [] immediately for empty input without calling any provider", async () => {
      const result = await geocodeEducationalFacilities([]);
      expect(result).toEqual([]);
      expect(vi.mocked(eduFacilitiesService)).not.toHaveBeenCalled();
    });

    it("calls educational-facilities service when provider is educational-facilities", async () => {
      await geocodeEducationalFacilities(facilities as any);
      expect(vi.mocked(eduFacilitiesService)).toHaveBeenCalledWith(facilities, undefined);
    });

    it("returns [] when provider is skip", async () => {
      vi.mocked(getLocalityDataSources).mockReturnValue({
        ...DEFAULT_RESOLVERS,
        "geocoding-resolvers": {
          ...DEFAULT_RESOLVERS["geocoding-resolvers"],
          "educational-facilities": { provider: "skip" },
        },
      } as any);

      const result = await geocodeEducationalFacilities(facilities as any);
      expect(result).toEqual([]);
      expect(vi.mocked(eduFacilitiesService)).not.toHaveBeenCalled();
    });
  });

  describe("geocodeCadastralPropertiesFromIdentifiers", () => {
    beforeEach(() => {
      vi.mocked(cadastreService).mockResolvedValue(new Map());
    });

    it("returns an empty map immediately for empty input without calling any provider", async () => {
      const result = await geocodeCadastralPropertiesFromIdentifiers([]);
      expect(result).toEqual(new Map());
      expect(vi.mocked(cadastreService)).not.toHaveBeenCalled();
    });

    it("calls cadastre service when provider is cadastre", async () => {
      const mockResult = new Map([["12345", { type: "MultiPolygon", coordinates: [] }]]);
      vi.mocked(cadastreService).mockResolvedValue(mockResult as any);

      const result = await geocodeCadastralPropertiesFromIdentifiers(["12345"]);
      expect(vi.mocked(cadastreService)).toHaveBeenCalledWith(["12345"]);
      expect(result).toBe(mockResult);
    });

    it("returns an empty map and does not call cadastre service when provider is skip", async () => {
      vi.mocked(getLocalityDataSources).mockReturnValue({
        ...DEFAULT_RESOLVERS,
        "geocoding-resolvers": {
          ...DEFAULT_RESOLVERS["geocoding-resolvers"],
          "cadastral-properties": { provider: "skip" },
        },
      } as any);

      const result = await geocodeCadastralPropertiesFromIdentifiers(["12345"]);
      expect(result).toEqual(new Map());
      expect(vi.mocked(cadastreService)).not.toHaveBeenCalled();
    });
  });
});

describe("geocodeIntersectionsForStreets", () => {
  it("should skip endpoints already in preGeocodedMap", async () => {
    const { geocodeIntersectionsForStreets } = await import("./router");
    const { overpassGeocodeIntersections, overpassGeocodeAddresses } =
      await import("./overpass/service");

    // Mock the geocoding services to track calls
    const mockOverpassGeocodeIntersections = vi.mocked(
      overpassGeocodeIntersections,
    );
    const mockOverpassGeocodeAddresses = vi.mocked(overpassGeocodeAddresses);

    mockOverpassGeocodeIntersections.mockResolvedValue([
      {
        originalText: "ул. Main ∩ Cross B",
        formattedAddress: "ул. Main ∩ Cross B",
        coordinates: { lat: 42.7, lng: 23.3 },
        geoJson: { type: "Point", coordinates: [23.3, 42.7] },
      },
    ]);
    mockOverpassGeocodeAddresses.mockResolvedValue([]);

    const preGeocodedMap = new Map([["Cross A", { lat: 42.0, lng: 23.0 }]]);

    const streets = [
      {
        street: "ул. Main",
        from: "Cross A", // Already in preGeocodedMap, should be skipped
        to: "Cross B", // Not in map, should be geocoded
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const result = await geocodeIntersectionsForStreets(
      streets,
      preGeocodedMap,
    );

    // Should only call with Cross B intersection, not Cross A
    expect(mockOverpassGeocodeIntersections).toHaveBeenCalledWith([
      "ул. Main ∩ Cross B",
    ]);

    // Result should only contain newly geocoded endpoint (Cross B), not pre-geocoded (Cross A)
    expect(result.has("Cross B")).toBe(true);
    expect(result.has("Cross A")).toBe(false);
    expect(result.size).toBe(1);
  });

  it("should work without preGeocodedMap (backward compatibility)", async () => {
    const { geocodeIntersectionsForStreets } = await import("./router");
    const { overpassGeocodeIntersections, overpassGeocodeAddresses } =
      await import("./overpass/service");

    const mockOverpassGeocodeIntersections = vi.mocked(
      overpassGeocodeIntersections,
    );
    const mockOverpassGeocodeAddresses = vi.mocked(overpassGeocodeAddresses);

    mockOverpassGeocodeIntersections.mockResolvedValue([
      {
        originalText: "ул. Main ∩ Cross A",
        formattedAddress: "ул. Main ∩ Cross A",
        coordinates: { lat: 42.0, lng: 23.0 },
        geoJson: { type: "Point", coordinates: [23.0, 42.0] },
      },
      {
        originalText: "ул. Main ∩ Cross B",
        formattedAddress: "ул. Main ∩ Cross B",
        coordinates: { lat: 42.7, lng: 23.3 },
        geoJson: { type: "Point", coordinates: [23.3, 42.7] },
      },
    ]);
    mockOverpassGeocodeAddresses.mockResolvedValue([]);

    const streets = [
      {
        street: "ул. Main",
        from: "Cross A",
        to: "Cross B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    // Call without preGeocodedMap
    const result = await geocodeIntersectionsForStreets(streets);

    // Should call with both intersections
    expect(mockOverpassGeocodeIntersections).toHaveBeenCalledWith([
      "ул. Main ∩ Cross A",
      "ул. Main ∩ Cross B",
    ]);

    // Result should contain both geocoded endpoints
    expect(result.has("Cross A")).toBe(true);
    expect(result.has("Cross B")).toBe(true);
    expect(result.size).toBe(2);
    expect(result.get("Cross A")).toEqual({ lat: 42.0, lng: 23.0 });
    expect(result.get("Cross B")).toEqual({ lat: 42.7, lng: 23.3 });
  });

  it("should not call Overpass for empty or whitespace-only endpoints", async () => {
    const { geocodeIntersectionsForStreets } = await import("./router");
    const { overpassGeocodeIntersections, overpassGeocodeAddresses } =
      await import("./overpass/service");
    const { logger } = await import("@/lib/logger");

    const mockOverpassGeocodeIntersections = vi.mocked(
      overpassGeocodeIntersections,
    );
    const mockOverpassGeocodeAddresses = vi.mocked(overpassGeocodeAddresses);
    const mockWarn = vi.mocked(logger.warn);

    mockOverpassGeocodeIntersections.mockResolvedValue([]);
    mockOverpassGeocodeAddresses.mockResolvedValue([]);

    const streets = [
      {
        street: "ул. Main",
        from: "", // empty — must be skipped
        to: "Cross B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
      {
        street: "ул. Second",
        from: "Cross C",
        to: "   ", // whitespace-only — must be skipped
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    await geocodeIntersectionsForStreets(streets);

    // Valid endpoints still produce intersection queries; empty/blank ones do not
    expect(mockOverpassGeocodeIntersections).toHaveBeenCalledWith([
      "ул. Main ∩ Cross B",
      "ул. Second ∩ Cross C",
    ]);

    // A warn must be emitted for each skipped endpoint
    expect(mockWarn).toHaveBeenCalledWith(
      "Skipping empty endpoint in intersection geocoding",
      { street: "ул. Main", endpoint: "" },
    );
    expect(mockWarn).toHaveBeenCalledWith(
      "Skipping empty endpoint in intersection geocoding",
      { street: "ул. Second", endpoint: "   " },
    );
  });
});
