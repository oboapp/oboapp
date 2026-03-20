import { describe, it, expect, vi } from "vitest";

// Mock Firebase-dependent imports to avoid initialization errors
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

import { hasHouseNumber, buildHouseNumberQuery } from "./router";

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

describe("geocodeIntersectionsForStreets", () => {
  it("should skip endpoints already in preGeocodedMap", async () => {
    const { geocodeIntersectionsForStreets } =
      await import("./router");
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
    const { geocodeIntersectionsForStreets } =
      await import("./router");
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
});
