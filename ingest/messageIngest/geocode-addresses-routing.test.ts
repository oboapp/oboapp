/**
 * Integration tests for geocodeAddressesFromExtractedData routing.
 *
 * These tests verify that each ExtractedLocations input type routes to exactly
 * the correct leaf geocoding service, and that no other services are called.
 *
 * Architecture:
 *  - Leaf services are mocked so we can spy on their calls without real API calls.
 *  - @/geocoding/router and geocodeAddressesFromExtractedData itself are NOT mocked —
 *    both execute fully to exercise the real dispatch logic.
 *  - @/lib/locality-data-sources is mocked to control which provider is active per test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock infrastructure (hoisted above all imports) ─────────────────────────

vi.mock("@/lib/firebase-admin", () => ({ adminDb: vi.fn() }));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    geocodeCachePins: { findAll: vi.fn().mockResolvedValue([]) },
    geocodeCacheStreets: { findAll: vi.fn().mockResolvedValue([]) },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/delay", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/geocoding/cache", () => ({
  seedStreetCacheFromDb: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock leaf geocoding services ────────────────────────────────────────────

vi.mock("@/geocoding/google/service", () => ({
  geocodeAddresses: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/geocoding/overpass/service", () => ({
  overpassGeocodeAddresses: vi.fn().mockResolvedValue([]),
  overpassGeocodeIntersections: vi.fn().mockResolvedValue([]),
  preFetchStreetGeometries: vi.fn().mockResolvedValue(undefined),
  getStreetGeometryCached: vi.fn().mockReturnValue(null),
  getStreetGeometryFromOverpass: vi.fn().mockResolvedValue(null),
  hasStreetGeometryQueried: vi.fn().mockReturnValue(false),
  seedStreetGeometryCache: vi.fn(),
}));

vi.mock("@/geocoding/cadastre/service", () => ({
  geocodeCadastralProperties: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/geocoding/gtfs/geocoding-service", () => ({
  geocodeBusStops: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/geocoding/educational-facilities/geocoding-service", () => ({
  geocodeEducationalFacilities: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/locality-data-sources", () => ({
  getLocalityDataSources: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { getLocalityDataSources } from "@/lib/locality-data-sources";
import { geocodeAddressesFromExtractedData } from "./geocode-addresses";
import { geocodeAddresses as googleService } from "@/geocoding/google/service";
import {
  overpassGeocodeAddresses,
  overpassGeocodeIntersections,
} from "@/geocoding/overpass/service";
import { geocodeCadastralProperties as cadastreService } from "@/geocoding/cadastre/service";
import { geocodeBusStops as gtfsService } from "@/geocoding/gtfs/geocoding-service";
import { geocodeEducationalFacilities as educationalFacilitiesService } from "@/geocoding/educational-facilities/geocoding-service";
import type { ExtractedLocations, Address } from "@/lib/types";

// ─── Provider config helpers ──────────────────────────────────────────────────

/** Default resolvers matching the Sofia production configuration. */
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

/** Override specific resolver entries while keeping the rest at their defaults. */
function withResolvers(overrides: Record<string, unknown>): void {
  vi.mocked(getLocalityDataSources).mockReturnValue({
    ...DEFAULT_RESOLVERS,
    "geocoding-resolvers": {
      ...DEFAULT_RESOLVERS["geocoding-resolvers"],
      ...overrides,
    },
  } as ReturnType<typeof getLocalityDataSources>);
}

/** Baseline ExtractedLocations with all arrays empty. */
const EMPTY_LOCATIONS: ExtractedLocations = {
  withSpecificAddress: true,
  cityWide: false,
  pins: [],
  streets: [],
  busStops: [],
  cadastralProperties: [],
  educationalFacilities: [],
};

// ─── Mock data builders ───────────────────────────────────────────────────────

/** Create a minimal resolved Address for use in mock return values. */
function makeAddress(originalText: string, lat: number, lng: number): Address {
  return {
    originalText,
    formattedAddress: originalText,
    coordinates: { lat, lng },
    geoJson: { type: "Point", coordinates: [lng, lat] },
  };
}

/**
 * Build a pair of Address entries that represent successfully geocoded street
 * intersections in the format returned by overpassGeocodeIntersections.
 * The `formattedAddress` must contain the "∩" separator so the router can
 * extract the cross-street name and populate the geocoded-endpoints map.
 */
function makeIntersectionAddresses(
  mainStreet: string,
  ...crossStreets: Array<{ name: string; lat: number; lng: number }>
): Address[] {
  return crossStreets.map(({ name, lat, lng }) =>
    makeAddress(`${mainStreet} ∩ ${name}`, lat, lng),
  );
}

// ─── Shared beforeEach ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLocalityDataSources).mockReturnValue(
    DEFAULT_RESOLVERS as ReturnType<typeof getLocalityDataSources>,
  );
  vi.mocked(googleService).mockResolvedValue([]);
  vi.mocked(overpassGeocodeAddresses).mockResolvedValue([]);
  vi.mocked(overpassGeocodeIntersections).mockResolvedValue([]);
  vi.mocked(cadastreService).mockResolvedValue(new Map());
  vi.mocked(gtfsService).mockResolvedValue([]);
  vi.mocked(educationalFacilitiesService).mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Pins
// ─────────────────────────────────────────────────────────────────────────────

describe("pins routing", () => {
  it("routes to Google when pins provider is 'google'", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      pins: [{ address: "Оборище 152", timespans: [] }],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(googleService).toHaveBeenCalledWith(["Оборище 152"]);
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
  });

  it("routes to Overpass when pins provider is 'overpass'", async () => {
    withResolvers({ pins: { provider: "overpass" } });

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      pins: [{ address: "Оборище 152", timespans: [] }],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(overpassGeocodeAddresses).toHaveBeenCalledWith(["Оборище 152"]);
    expect(googleService).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
  });

  it("skips geocoding API for pin with valid geotagged coordinates", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      pins: [
        {
          address: "ул. Оборище 152",
          // Valid Sofia coordinates — pre-resolved, no API call needed
          coordinates: { lat: 42.699363, lng: 23.328635 },
          timespans: [],
        },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
  });

  it("falls through to Google for pin with out-of-bounds geotagged coordinates", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      pins: [
        {
          address: "Оборище 152",
          // Intentionally invalid coordinates (far outside any reasonable locality bounds)
          // to trigger the bounds-validation rejection and force geocoding fallback
          coordinates: { lat: 43.5, lng: 23.3 },
          timespans: [],
        },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(googleService).toHaveBeenCalledWith(["Оборище 152"]);
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Streets
// ─────────────────────────────────────────────────────────────────────────────

describe("streets routing", () => {
  it("routes cross-street intersections to Overpass when provider is 'overpass'", async () => {
    // Provide geocoded results so the fallback overpassGeocodeAddresses path is not triggered
    vi.mocked(overpassGeocodeIntersections).mockResolvedValue(
      makeIntersectionAddresses("ул. Оборище", 
        { name: "бул. Цар Освободител", lat: 42.690, lng: 23.320 },
        { name: "бул. Дондуков", lat: 42.693, lng: 23.345 },
      ),
    );

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      streets: [
        {
          street: "ул. Оборище",
          from: "бул. Цар Освободител",
          to: "бул. Дондуков",
          timespans: [],
        },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(overpassGeocodeIntersections).toHaveBeenCalledWith([
      "ул. Оборище ∩ бул. Цар Освободител",
      "ул. Оборище ∩ бул. Дондуков",
    ]);
    expect(googleService).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
    // No fallback — all endpoints resolved above
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
  });

  it("routes house-number endpoint to overpassGeocodeAddresses (not intersection geocoding)", async () => {
    // Cross-street endpoint: resolved through intersection geocoding
    vi.mocked(overpassGeocodeIntersections).mockResolvedValue(
      makeIntersectionAddresses("ул. Оборище",
        { name: "бул. Дондуков", lat: 42.693, lng: 23.345 },
      ),
    );
    // House-number endpoint: resolved through overpassGeocodeAddresses
    vi.mocked(overpassGeocodeAddresses).mockResolvedValue([
      makeAddress("ул. Оборище №15", 42.695, 23.350),
    ]);

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      streets: [
        {
          street: "ул. Оборище",
          from: "бул. Дондуков",
          to: "№15",
          timespans: [],
        },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Cross-street endpoint goes through intersection geocoding
    expect(overpassGeocodeIntersections).toHaveBeenCalledWith([
      "ул. Оборище ∩ бул. Дондуков",
    ]);
    // House-number endpoint uses address geocoding with street context prefix
    expect(overpassGeocodeAddresses).toHaveBeenCalledWith(["ул. Оборище №15"]);
    expect(googleService).not.toHaveBeenCalled();
  });

  it("routes street endpoints to Google when streets provider is 'google'", async () => {
    withResolvers({ streets: { provider: "google" } });

    // Provide results so no fallback (overpassGeocodeAddresses) fires
    vi.mocked(googleService).mockResolvedValue([
      makeAddress("ул. Оборище ∩ бул. Цар Освободител", 42.690, 23.320),
      makeAddress("ул. Оборище ∩ бул. Дондуков", 42.693, 23.345),
    ]);

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      streets: [
        {
          street: "ул. Оборище",
          from: "бул. Цар Освободител",
          to: "бул. Дондуков",
          timespans: [],
        },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Google receives the intersection queries (not bare endpoint names)
    expect(googleService).toHaveBeenCalledWith(
      expect.arrayContaining([
        "ул. Оборище ∩ бул. Цар Освободител",
        "ул. Оборище ∩ бул. Дондуков",
      ]),
    );
    expect(overpassGeocodeIntersections).not.toHaveBeenCalled();
  });

  it("skips all geocoding APIs for a street with fully geotagged endpoints", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      streets: [
        {
          street: "ул. Оборище",
          from: "бул. Дондуков",
          fromCoordinates: { lat: 42.693576, lng: 23.35161 }, // valid Sofia coords
          to: "ул. Г. С. Раковски",
          toCoordinates: { lat: 42.693259, lng: 23.354973 }, // valid Sofia coords
          timespans: [],
        },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Both endpoints pre-resolved from geotagged coordinates — no API calls at all
    expect(overpassGeocodeIntersections).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(googleService).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Educational facilities
// ─────────────────────────────────────────────────────────────────────────────

describe("educational facilities routing", () => {
  it("routes kindergarten to educational-facilities service", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      educationalFacilities: [{ type: "kindergarten", number: "151" }],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(educationalFacilitiesService).toHaveBeenCalledWith(
      [{ type: "kindergarten", number: "151" }],
      undefined,
    );
    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
  });

  it("routes school to educational-facilities service", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      educationalFacilities: [{ type: "school", number: "7" }],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(educationalFacilitiesService).toHaveBeenCalledWith(
      [{ type: "school", number: "7" }],
      undefined,
    );
    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
  });

  it("skips educational-facilities service when provider is 'skip'", async () => {
    withResolvers({ "educational-facilities": { provider: "skip" } });

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      educationalFacilities: [{ type: "kindergarten", number: "151" }],
    };

    const result = await geocodeAddressesFromExtractedData(locations);

    expect(educationalFacilitiesService).not.toHaveBeenCalled();
    expect(result.addresses).toHaveLength(0);
  });

  it("routes educational facilities to Google when provider is 'google'", async () => {
    withResolvers({ "educational-facilities": { provider: "google" } });

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      educationalFacilities: [{ type: "kindergarten", number: "151" }],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Router formats the query as "{type} {number}" before calling Google
    expect(googleService).toHaveBeenCalledWith(["kindergarten 151"]);
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Bus stops
// ─────────────────────────────────────────────────────────────────────────────

describe("bus stops routing", () => {
  it("routes to GTFS service when provider is 'gtfs'", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      busStops: ["1234"],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(gtfsService).toHaveBeenCalledWith(["1234"]);
    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
  });

  it("skips all services and returns no addresses when provider is 'skip'", async () => {
    withResolvers({ "bus-stops": { provider: "skip" } });

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      busStops: ["1234"],
    };

    const result = await geocodeAddressesFromExtractedData(locations);

    expect(gtfsService).not.toHaveBeenCalled();
    expect(googleService).not.toHaveBeenCalled();
    expect(result.addresses).toHaveLength(0);
  });

  it("routes to Google with 'Спирка' prefix when provider is 'google'", async () => {
    withResolvers({ "bus-stops": { provider: "google" } });

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      busStops: ["1234"],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Router prepends "Спирка " to the stop code before calling Google
    expect(googleService).toHaveBeenCalledWith(["Спирка 1234"]);
    expect(gtfsService).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Cadastral properties
// ─────────────────────────────────────────────────────────────────────────────

describe("cadastral properties routing", () => {
  it("routes to Cadastre service when provider is 'cadastre'", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      cadastralProperties: [
        { identifier: "67855.310.123", timespans: [] },
      ],
    };

    await geocodeAddressesFromExtractedData(locations);

    expect(cadastreService).toHaveBeenCalledWith(["67855.310.123"]);
    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
  });

  it("skips Cadastre service when provider is 'skip'", async () => {
    withResolvers({ "cadastral-properties": { provider: "skip" } });

    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      cadastralProperties: [
        { identifier: "67855.310.123", timespans: [] },
      ],
    };

    const result = await geocodeAddressesFromExtractedData(locations);

    expect(cadastreService).not.toHaveBeenCalled();
    // With 'skip', geocodeCadastralPropertiesFromIdentifiers returns an empty Map
    expect(result.cadastralGeometries).toEqual(new Map());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Mixed inputs — no cross-contamination
// ─────────────────────────────────────────────────────────────────────────────

describe("mixed inputs routing", () => {
  it("routes pin, educational facility, and bus stop to separate services without cross-contamination", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      pins: [{ address: "Оборище 152", timespans: [] }],
      educationalFacilities: [{ type: "kindergarten", number: "151" }],
      busStops: ["1234"],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Google called exactly once — for the pin only
    expect(googleService).toHaveBeenCalledTimes(1);
    expect(googleService).toHaveBeenCalledWith(["Оборище 152"]);

    // Educational facilities service called once for the kindergarten
    expect(educationalFacilitiesService).toHaveBeenCalledTimes(1);
    expect(educationalFacilitiesService).toHaveBeenCalledWith(
      [{ type: "kindergarten", number: "151" }],
      undefined,
    );

    // GTFS service called once for the bus stop
    expect(gtfsService).toHaveBeenCalledTimes(1);
    expect(gtfsService).toHaveBeenCalledWith(["1234"]);

    // No cadastral or overpass calls when those types are absent
    expect(cadastreService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(overpassGeocodeIntersections).not.toHaveBeenCalled();
  });

  it("routes all location types to their respective services exactly once", async () => {
    // Provide intersection results so the overpassGeocodeAddresses fallback is not triggered
    vi.mocked(overpassGeocodeIntersections).mockResolvedValue(
      makeIntersectionAddresses("ул. Оборище",
        { name: "бул. Цар Освободител", lat: 42.690, lng: 23.320 },
        { name: "бул. Дондуков", lat: 42.693, lng: 23.345 },
      ),
    );

    const locations: ExtractedLocations = {
      withSpecificAddress: true,
      cityWide: false,
      pins: [{ address: "Оборище 152", timespans: [] }],
      streets: [
        {
          street: "ул. Оборище",
          from: "бул. Цар Освободител",
          to: "бул. Дондуков",
          timespans: [],
        },
      ],
      educationalFacilities: [{ type: "school", number: "7" }],
      busStops: ["5678"],
      cadastralProperties: [{ identifier: "67855.310.123", timespans: [] }],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Each service called exactly once for its specific location type
    expect(googleService).toHaveBeenCalledTimes(1);
    expect(googleService).toHaveBeenCalledWith(["Оборище 152"]);

    expect(overpassGeocodeIntersections).toHaveBeenCalledTimes(1);
    expect(overpassGeocodeIntersections).toHaveBeenCalledWith([
      "ул. Оборище ∩ бул. Цар Освободител",
      "ул. Оборище ∩ бул. Дондуков",
    ]);

    expect(cadastreService).toHaveBeenCalledTimes(1);
    expect(cadastreService).toHaveBeenCalledWith(["67855.310.123"]);

    expect(gtfsService).toHaveBeenCalledTimes(1);
    expect(gtfsService).toHaveBeenCalledWith(["5678"]);

    expect(educationalFacilitiesService).toHaveBeenCalledTimes(1);
    expect(educationalFacilitiesService).toHaveBeenCalledWith(
      [{ type: "school", number: "7" }],
      undefined,
    );

    // No cross-contamination: Google called only for the pin
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty result for null extractedData without calling any service", async () => {
    const result = await geocodeAddressesFromExtractedData(null);

    expect(result.addresses).toHaveLength(0);
    expect(result.preGeocodedMap.size).toBe(0);
    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(overpassGeocodeIntersections).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
  });

  it("returns empty result for all-empty arrays without calling any service", async () => {
    const result = await geocodeAddressesFromExtractedData(EMPTY_LOCATIONS);

    expect(result.addresses).toHaveLength(0);
    expect(googleService).not.toHaveBeenCalled();
    expect(overpassGeocodeAddresses).not.toHaveBeenCalled();
    expect(overpassGeocodeIntersections).not.toHaveBeenCalled();
    expect(cadastreService).not.toHaveBeenCalled();
    expect(gtfsService).not.toHaveBeenCalled();
    expect(educationalFacilitiesService).not.toHaveBeenCalled();
  });

  it("passes empty string pin address to the configured service", async () => {
    const locations: ExtractedLocations = {
      ...EMPTY_LOCATIONS,
      pins: [{ address: "", timespans: [] }],
    };

    await geocodeAddressesFromExtractedData(locations);

    // Intentional: geocodeAddressesFromExtractedData does not filter empty address strings;
    // it forwards them to the configured service. Filtering empty inputs is the
    // responsibility of the caller (LLM extraction stage).
    expect(googleService).toHaveBeenCalledWith([""]);
  });
});
