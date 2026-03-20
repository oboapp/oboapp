import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findMissingStreetEndpoints,
  deduplicateAddresses,
  geocodeAddressesFromExtractedData,
  getValidPreResolvedCoordinates,
} from "./geocode-addresses";
import type { StreetSection, Address, ExtractedLocations } from "@/lib/types";
import { BOUNDS } from "@oboapp/shared";

// Set LOCALITY for tests
beforeEach(() => {
  process.env.LOCALITY = "bg.sofia";
});

const TEST_BOUNDS = BOUNDS[process.env.LOCALITY || "bg.sofia"];

// Mock firebase-admin to avoid requiring env vars
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: vi.fn(),
}));

// Mock geocoding services
vi.mock("@/geocoding/router", () => ({
  geocodeAddresses: vi.fn().mockResolvedValue([]),
  geocodeIntersectionsForStreets: vi.fn().mockResolvedValue(new Map()),
  geocodeCadastralPropertiesFromIdentifiers: vi
    .fn()
    .mockResolvedValue(new Map()),
  geocodeBusStops: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/geocoding/overpass/service", () => ({
  overpassGeocodeAddresses: vi.fn().mockResolvedValue([]),
}));

describe(findMissingStreetEndpoints, () => {
  it("should return empty array when all endpoints are geocoded", () => {
    const streets: StreetSection[] = [
      {
        street: "Main Street",
        from: "Corner A",
        to: "Corner B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const geocodedMap = new Map([
      ["Corner A", { lat: 42, lng: 23 }],
      ["Corner B", { lat: 42.1, lng: 23.1 }],
    ]);

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    expect(result).toEqual([]);
  });

  it("should return missing from endpoint", () => {
    const streets: StreetSection[] = [
      {
        street: "Main Street",
        from: "Corner A",
        to: "Corner B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const geocodedMap = new Map([["Corner B", { lat: 42.1, lng: 23.1 }]]);

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    expect(result).toEqual(["Corner A"]);
  });

  it("should return missing to endpoint", () => {
    const streets: StreetSection[] = [
      {
        street: "Main Street",
        from: "Corner A",
        to: "Corner B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const geocodedMap = new Map([["Corner A", { lat: 42, lng: 23 }]]);

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    expect(result).toEqual(["Corner B"]);
  });

  it("should return both missing endpoints", () => {
    const streets: StreetSection[] = [
      {
        street: "Main Street",
        from: "Corner A",
        to: "Corner B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const geocodedMap = new Map();

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    expect(result).toEqual(["Corner A", "Corner B"]);
  });

  it("should handle multiple streets", () => {
    const streets: StreetSection[] = [
      {
        street: "Main Street",
        from: "Corner A",
        to: "Corner B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
      {
        street: "Side Street",
        from: "Corner C",
        to: "Corner D",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const geocodedMap = new Map([
      ["Corner A", { lat: 42, lng: 23 }],
      ["Corner C", { lat: 42.2, lng: 23.2 }],
    ]);

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    expect(result).toEqual(["Corner B", "Corner D"]);
  });

  it("should handle empty streets array", () => {
    const streets: StreetSection[] = [];
    const geocodedMap = new Map();

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    expect(result).toEqual([]);
  });

  it("should handle streets with same endpoints", () => {
    const streets: StreetSection[] = [
      {
        street: "Main Street",
        from: "Corner A",
        to: "Corner B",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
      {
        street: "Side Street",
        from: "Corner A",
        to: "Corner C",
        timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
      },
    ];

    const geocodedMap = new Map([["Corner A", { lat: 42, lng: 23 }]]);

    const result = findMissingStreetEndpoints(streets, geocodedMap);
    // Should include duplicates as they're processed per street
    expect(result).toEqual(["Corner B", "Corner C"]);
  });
});

// Helper to create test addresses
function createAddress(text: string, lat: number, lng: number): Address {
  return {
    originalText: text,
    formattedAddress: text,
    coordinates: { lat, lng },
    geoJson: { type: "Point", coordinates: [lng, lat] },
  };
}

describe(deduplicateAddresses, () => {
  it("should return empty array for empty input", () => {
    const result = deduplicateAddresses([]);
    expect(result).toEqual([]);
  });

  it("should return single address unchanged", () => {
    const addresses = [createAddress("123 Main St", 42.0, 23.0)];
    const result = deduplicateAddresses(addresses);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe("123 Main St");
  });

  it("should remove exact text duplicates (case insensitive)", () => {
    const addresses = [
      createAddress("123 Main St", 42.0, 23.0),
      createAddress("123 MAIN ST", 42.1, 23.1),
      createAddress("123 main st", 42.2, 23.2),
    ];
    const result = deduplicateAddresses(addresses);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe("123 Main St");
  });

  it("should remove addresses within distance threshold (~50m)", () => {
    // ~0.0005 degrees is roughly 50m at Sofia's latitude
    const addresses = [
      createAddress("Address A", 42.7, 23.3),
      createAddress("Address B", 42.70004, 23.30004), // ~50m away
    ];
    const result = deduplicateAddresses(addresses);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe("Address A");
  });

  it("should keep addresses beyond distance threshold", () => {
    // ~0.001 degrees is roughly 100m at Sofia's latitude
    const addresses = [
      createAddress("Address A", 42.7, 23.3),
      createAddress("Address B", 42.701, 23.301), // ~100m away
    ];
    const result = deduplicateAddresses(addresses);
    expect(result).toHaveLength(2);
  });

  it("should handle mix of text and coordinate duplicates", () => {
    const addresses = [
      createAddress("Location 1", 42.7, 23.3),
      createAddress("LOCATION 1", 42.8, 23.4), // text duplicate
      createAddress("Location 2", 42.70003, 23.30003), // coordinate duplicate of Location 1
      createAddress("Location 3", 42.9, 23.5), // unique
    ];
    const result = deduplicateAddresses(addresses);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.originalText)).toContain("Location 1");
    expect(result.map((a) => a.originalText)).toContain("Location 3");
  });

  it("should trim whitespace when comparing text", () => {
    const addresses = [
      createAddress("  Main St  ", 42.0, 23.0),
      createAddress("Main St", 42.1, 23.1),
    ];
    const result = deduplicateAddresses(addresses);
    expect(result).toHaveLength(1);
  });
});

describe("geocodeAddressesFromExtractedData", () => {
  it("should skip geocoding for pins with pre-resolved coordinates", async () => {
    const extractedData: ExtractedLocations = {
      withSpecificAddress: true,
      cityWide: false,
      busStops: [],
      pins: [
        {
          address: "ул. Георги Бенковски №26",
          coordinates: { lat: 42.6993633, lng: 23.328635 },
          timespans: [{ start: "07.02.2026 08:00", end: "07.02.2026 18:00" }],
        },
      ],
      streets: [],
      cadastralProperties: [],
    };

    const result = await geocodeAddressesFromExtractedData(extractedData);

    // Should have the pre-resolved coordinates in the map (rounded to 6 decimals)
    expect(result.preGeocodedMap.has("ул. Георги Бенковски №26")).toBe(true);
    expect(result.preGeocodedMap.get("ул. Георги Бенковски №26")).toEqual({
      lat: 42.699363,
      lng: 23.328635,
    });

    // Should have created an address with the rounded coordinates
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0].originalText).toBe("ул. Георги Бенковски №26");
    expect(result.addresses[0].coordinates).toEqual({
      lat: 42.699363,
      lng: 23.328635,
    });
  });

  it("should skip geocoding for street endpoints with pre-resolved coordinates", async () => {
    const extractedData: ExtractedLocations = {
      withSpecificAddress: true,
      cityWide: false,
      busStops: [],
      pins: [],
      streets: [
        {
          street: "ул. Оборище",
          from: "Start Point",
          fromCoordinates: { lat: 42.693576, lng: 23.35161 },
          to: "End Point",
          toCoordinates: { lat: 42.693259, lng: 23.3549725 },
          timespans: [{ start: "05.02.2026 00:00", end: "09.03.2026 23:59" }],
        },
      ],
      cadastralProperties: [],
    };

    const result = await geocodeAddressesFromExtractedData(extractedData);

    // Should have both endpoints in the pre-geocoded map (rounded to 6 decimals)
    expect(result.preGeocodedMap.has("Start Point")).toBe(true);
    expect(result.preGeocodedMap.has("End Point")).toBe(true);
    expect(result.preGeocodedMap.get("Start Point")).toEqual({
      lat: 42.693576,
      lng: 23.35161,
    });
    expect(result.preGeocodedMap.get("End Point")).toEqual({
      lat: 42.693259,
      lng: 23.354973,
    });

    // Should have created addresses for both endpoints
    expect(result.addresses.length).toBeGreaterThanOrEqual(2);
  });

  it("should mix pre-resolved coordinates with geocoded addresses", async () => {
    // Import the mocked functions to verify they're not called for pre-resolved
    const { geocodeAddresses } = await import("@/geocoding/router");

    const extractedData: ExtractedLocations = {
      withSpecificAddress: true,
      cityWide: false,
      busStops: [],
      pins: [
        {
          address: "With coordinates",
          coordinates: { lat: 42.69, lng: 23.32 },
          timespans: [{ start: "01.02.2026 00:00", end: "02.02.2026 00:00" }],
        },
        {
          address: "Without coordinates",
          timespans: [{ start: "01.02.2026 00:00", end: "02.02.2026 00:00" }],
        },
      ],
      streets: [],
      cadastralProperties: [],
    };

    const result = await geocodeAddressesFromExtractedData(extractedData);

    // Should have pre-resolved coordinate in the map
    expect(result.preGeocodedMap.has("With coordinates")).toBe(true);

    // geocodeAddresses should be called only for the pin without coordinates
    expect(geocodeAddresses).toHaveBeenCalledWith(["Without coordinates"]);
  });
});

describe("getValidPreResolvedCoordinates", () => {
  it("should round coordinates to 6 decimal places", () => {
    const coords = { lat: 42.69936334567, lng: 23.32863534567 };
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).not.toBeNull();
    expect(result!.lat).toBe(42.699363);
    expect(result!.lng).toBe(23.328635);
  });

  it("should accept valid Sofia coordinates", () => {
    const coords = { lat: 42.6993633, lng: 23.328635 };
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).not.toBeNull();
    expect(result!.lat).toBe(42.699363);
    expect(result!.lng).toBe(23.328635);
  });

  it("should reject coordinates outside Sofia bounds (north)", () => {
    const coords = { lat: 43.0, lng: 23.3 }; // Too far north
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).toBeNull();
  });

  it("should reject coordinates outside Sofia bounds (south)", () => {
    const coords = { lat: 42.5, lng: 23.3 }; // Too far south
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).toBeNull();
  });

  it("should reject coordinates outside Sofia bounds (east)", () => {
    const coords = { lat: 42.7, lng: 23.6 }; // Too far east
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).toBeNull();
  });

  it("should reject coordinates outside Sofia bounds (west)", () => {
    const coords = { lat: 42.7, lng: 23.1 }; // Too far west
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).toBeNull();
  });

  it("should handle coordinates at Sofia boundary edges", () => {
    // Test at bounds edges (see @oboapp/shared bounds for actual values)
    const coordsNorth = { lat: TEST_BOUNDS.north, lng: 23.3 };
    const coordsSouth = { lat: TEST_BOUNDS.south, lng: 23.3 };
    const coordsEast = { lat: 42.7, lng: TEST_BOUNDS.east };
    const coordsWest = { lat: 42.7, lng: TEST_BOUNDS.west };

    expect(getValidPreResolvedCoordinates(coordsNorth, "test")).not.toBeNull();
    expect(getValidPreResolvedCoordinates(coordsSouth, "test")).not.toBeNull();
    expect(getValidPreResolvedCoordinates(coordsEast, "test")).not.toBeNull();
    expect(getValidPreResolvedCoordinates(coordsWest, "test")).not.toBeNull();
  });

  it("should handle coordinates with excessive precision", () => {
    // Micron-level precision (9 decimal places ~0.11mm)
    const coords = { lat: 42.123456789, lng: 23.987654321 };
    const result = getValidPreResolvedCoordinates(coords, "test");

    // Should round but reject if outside bounds
    expect(result).toBeNull(); // These coords are outside Sofia
  });

  it("should round coordinates near street section example from issue", () => {
    // Example from issue: 42.693576, 23.35161
    const coords = { lat: 42.693576, lng: 23.35161 };
    const result = getValidPreResolvedCoordinates(coords, "test");

    expect(result).not.toBeNull();
    expect(result!.lat).toBe(42.693576);
    expect(result!.lng).toBe(23.35161);
  });
});
