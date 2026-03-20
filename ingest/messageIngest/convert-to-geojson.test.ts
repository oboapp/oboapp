import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateAllAddressesGeocoded,
  convertMessageGeocodingToGeoJson,
} from "./convert-to-geojson";
import type { ExtractedData } from "@/lib/types";

// Mock dependencies
vi.mock("@/geocoding/shared/geojson-service");
vi.mock("../crawlers/shared/geojson-validation");
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: vi.fn(),
}));

describe(validateAllAddressesGeocoded, () => {
  it("should return empty array when all addresses are geocoded", () => {
    const extractedData: ExtractedData = {
      pins: [
        {
          address: "Address 1",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
        {
          address: "Address 2",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
      streets: [
        {
          street: "Main Street",
          from: "Corner A",
          to: "Corner B",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
    };

    const geocodedMap = new Map([
      ["Address 1", { lat: 42, lng: 23 }],
      ["Address 2", { lat: 42.1, lng: 23.1 }],
      ["Corner A", { lat: 42.2, lng: 23.2 }],
      ["Corner B", { lat: 42.3, lng: 23.3 }],
    ]);

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual([]);
  });

  it("should return missing pin addresses", () => {
    const extractedData: ExtractedData = {
      pins: [
        {
          address: "Address 1",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
        {
          address: "Address 2",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
      streets: [],
    };

    const geocodedMap = new Map([["Address 1", { lat: 42, lng: 23 }]]);

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual(["Address 2"]);
  });

  it("should return missing street endpoints", () => {
    const extractedData: ExtractedData = {
      pins: [],
      streets: [
        {
          street: "Main Street",
          from: "Corner A",
          to: "Corner B",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
    };

    const geocodedMap = new Map([["Corner A", { lat: 42, lng: 23 }]]);

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual(["Main Street to: Corner B"]);
  });

  it("should return missing from endpoint with street name", () => {
    const extractedData: ExtractedData = {
      pins: [],
      streets: [
        {
          street: "Main Street",
          from: "Corner A",
          to: "Corner B",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
    };

    const geocodedMap = new Map([["Corner B", { lat: 42, lng: 23 }]]);

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual(["Main Street from: Corner A"]);
  });

  it("should return all missing addresses from both pins and streets", () => {
    const extractedData: ExtractedData = {
      pins: [
        {
          address: "Address 1",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
        {
          address: "Address 2",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
      streets: [
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
      ],
    };

    const geocodedMap = new Map([["Address 1", { lat: 42, lng: 23 }]]);

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual([
      "Address 2",
      "Main Street from: Corner A",
      "Main Street to: Corner B",
      "Side Street from: Corner C",
      "Side Street to: Corner D",
    ]);
  });

  it("should handle empty pins and streets", () => {
    const extractedData: ExtractedData = {
      pins: [],
      streets: [],
    };

    const geocodedMap = new Map();

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual([]);
  });

  it("should handle empty geocoded map", () => {
    const extractedData: ExtractedData = {
      pins: [
        {
          address: "Address 1",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
      streets: [
        {
          street: "Main Street",
          from: "Corner A",
          to: "Corner B",
          timespans: [{ start: "2024-01-01", end: "2024-01-02" }],
        },
      ],
    };

    const geocodedMap = new Map();

    const result = validateAllAddressesGeocoded(extractedData, geocodedMap);
    expect(result).toEqual([
      "Address 1",
      "Main Street from: Corner A",
      "Main Street to: Corner B",
    ]);
  });
});

describe("convertMessageGeocodingToGeoJson", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should succeed with partial geocoding if at least one feature is available", async () => {
    const { convertToGeoJSON } = await import("@/geocoding/shared/geojson-service");
    const { validateAndFixGeoJSON } =
      await import("../crawlers/shared/geojson-validation");

    const extractedData: ExtractedData = {
      pins: [
        { address: "Address 1", timespans: [] },
        { address: "Address 2", timespans: [] }, // Missing geocoding
      ],
      streets: [
        { street: "Main St", from: "A", to: "B", timespans: [] },
        { street: "Side St", from: "C", to: "D", timespans: [] }, // Missing D
      ],
    };

    const geocodedMap = new Map([
      ["Address 1", { lat: 42, lng: 23 }],
      ["A", { lat: 42.1, lng: 23.1 }],
      ["B", { lat: 42.2, lng: 23.2 }],
      ["C", { lat: 42.3, lng: 23.3 }],
    ]);

    const mockGeoJson = {
      type: "FeatureCollection" as const,
      features: [],
    };

    vi.mocked(convertToGeoJSON).mockResolvedValue(mockGeoJson);
    vi.mocked(validateAndFixGeoJSON).mockReturnValue({
      isValid: true,
      geoJson: mockGeoJson,
      errors: [],
      warnings: [],
      fixedCoordinates: false,
    });

    const result = await convertMessageGeocodingToGeoJson(
      extractedData,
      geocodedMap,
    );

    expect(result).toEqual(mockGeoJson);
    // Should only pass geocoded features
    expect(vi.mocked(convertToGeoJSON)).toHaveBeenCalledWith(
      expect.objectContaining({
        pins: [{ address: "Address 1", timespans: [] }],
        streets: [{ street: "Main St", from: "A", to: "B", timespans: [] }],
      }),
      geocodedMap,
    );
  });

  it("should throw error if no features can be geocoded", async () => {
    const extractedData: ExtractedData = {
      pins: [{ address: "Address 1", timespans: [] }],
      streets: [{ street: "Main St", from: "A", to: "B", timespans: [] }],
    };

    const geocodedMap = new Map(); // Empty - nothing geocoded

    await expect(
      convertMessageGeocodingToGeoJson(extractedData, geocodedMap),
    ).rejects.toThrow("Failed to geocode all addresses");
  });

  it("should handle all pins geocoded but streets missing endpoints", async () => {
    const { convertToGeoJSON } = await import("@/geocoding/shared/geojson-service");
    const { validateAndFixGeoJSON } =
      await import("../crawlers/shared/geojson-validation");

    const extractedData: ExtractedData = {
      pins: [{ address: "Address 1", timespans: [] }],
      streets: [{ street: "Main St", from: "A", to: "B", timespans: [] }],
    };

    const geocodedMap = new Map([
      ["Address 1", { lat: 42, lng: 23 }],
      ["A", { lat: 42.1, lng: 23.1 }],
      // Missing B
    ]);

    const mockGeoJson = {
      type: "FeatureCollection" as const,
      features: [],
    };

    vi.mocked(convertToGeoJSON).mockResolvedValue(mockGeoJson);
    vi.mocked(validateAndFixGeoJSON).mockReturnValue({
      isValid: true,
      geoJson: mockGeoJson,
      errors: [],
      warnings: [],
      fixedCoordinates: false,
    });

    const result = await convertMessageGeocodingToGeoJson(
      extractedData,
      geocodedMap,
    );

    expect(result).toEqual(mockGeoJson);
    // Should include pin but exclude street with missing endpoint
    expect(vi.mocked(convertToGeoJSON)).toHaveBeenCalledWith(
      expect.objectContaining({
        pins: [{ address: "Address 1", timespans: [] }],
        streets: [],
      }),
      geocodedMap,
    );
  });
});
