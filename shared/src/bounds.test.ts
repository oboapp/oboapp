import { describe, it, expect } from "vitest";
import {
  BOUNDS,
  CENTERS,
  LOCALITY_METADATA,
  getBoundsForLocality,
  getCenterForLocality,
  getLocalityMetadata,
  getLocalityName,
  getLocalityDescription,
  getBboxForLocality,
  isWithinBounds,
  validateLocality,
  assertLocalityRegistriesInSync,
} from "./bounds";

describe("bounds", () => {
  describe("BOUNDS registry", () => {
    it("should have Sofia boundaries", () => {
      expect(BOUNDS["bg.sofia"]).toEqual({
        south: 42.605,
        west: 23.188,
        north: 42.83,
        east: 23.528,
      });
    });
  });

  describe("CENTERS registry", () => {
    it("should have Sofia center", () => {
      expect(CENTERS["bg.sofia"]).toEqual({
        lat: 42.6977,
        lng: 23.3219,
      });
    });
  });

  describe("LOCALITY_METADATA registry", () => {
    it("should have Sofia metadata", () => {
      expect(LOCALITY_METADATA["bg.sofia"]).toMatchObject({
        name: "София",
        description: "Следи събитията в София",
      });
    });
  });

  describe("getLocalityMetadata", () => {
    it("should return metadata for Sofia", () => {
      const metadata = getLocalityMetadata("bg.sofia");
      expect(metadata.name).toBe("София");
    });

    it("should throw for unknown locality", () => {
      expect(() => getLocalityMetadata("invalid")).toThrow("Unknown locality");
    });
  });

  describe("getLocalityName", () => {
    it("should return display name for Sofia", () => {
      expect(getLocalityName("bg.sofia")).toBe("София");
    });

    it("should throw for unknown locality", () => {
      expect(() => getLocalityName("invalid")).toThrow("Unknown locality");
    });
  });

  describe("getLocalityDescription", () => {
    it("should return description for Sofia", () => {
      expect(getLocalityDescription("bg.sofia")).toBe(
        "Следи събитията в София",
      );
    });

    it("should fall back to name-based description when description is not defined", () => {
      LOCALITY_METADATA["test.fallback"] = { name: "Тест" };
      try {
        expect(getLocalityDescription("test.fallback")).toBe(
          "Следи събитията в Тест",
        );
      } finally {
        delete LOCALITY_METADATA["test.fallback"];
      }
    });

    it("should throw for unknown locality", () => {
      expect(() => getLocalityDescription("invalid")).toThrow(
        "Unknown locality",
      );
    });
  });

  describe("getBoundsForLocality", () => {
    it("should return bounds for Sofia", () => {
      expect(getBoundsForLocality("bg.sofia")).toEqual(BOUNDS["bg.sofia"]);
    });

    it("should throw for unknown locality", () => {
      expect(() => getBoundsForLocality("invalid")).toThrow("Unknown locality");
    });
  });

  describe("getCenterForLocality", () => {
    it("should return center for Sofia", () => {
      expect(getCenterForLocality("bg.sofia")).toEqual(CENTERS["bg.sofia"]);
    });

    it("should throw for unknown locality", () => {
      expect(() => getCenterForLocality("invalid")).toThrow("Unknown locality");
    });
  });

  describe("getBboxForLocality", () => {
    it("should format bounds as bbox string for Sofia", () => {
      expect(getBboxForLocality("bg.sofia")).toBe("42.605,23.188,42.83,23.528");
    });

    it("should throw for unknown locality", () => {
      expect(() => getBboxForLocality("invalid")).toThrow("Unknown locality");
    });
  });

  describe("isWithinBounds", () => {
    it("should return true for coordinates within Sofia", () => {
      expect(isWithinBounds("bg.sofia", 42.6977, 23.3219)).toBe(true);
      expect(isWithinBounds("bg.sofia", 42.7, 23.3)).toBe(true);
    });

    it("should return true for coordinates on boundary edges (inclusive)", () => {
      const sofia = BOUNDS["bg.sofia"];
      // All four corners
      expect(isWithinBounds("bg.sofia", sofia.south, sofia.west)).toBe(true);
      expect(isWithinBounds("bg.sofia", sofia.south, sofia.east)).toBe(true);
      expect(isWithinBounds("bg.sofia", sofia.north, sofia.west)).toBe(true);
      expect(isWithinBounds("bg.sofia", sofia.north, sofia.east)).toBe(true);
      // Mid-edge points
      expect(isWithinBounds("bg.sofia", sofia.south, 23.35)).toBe(true);
      expect(isWithinBounds("bg.sofia", sofia.north, 23.35)).toBe(true);
      expect(isWithinBounds("bg.sofia", 42.7, sofia.west)).toBe(true);
      expect(isWithinBounds("bg.sofia", 42.7, sofia.east)).toBe(true);
    });

    it("should return false for coordinates outside Sofia", () => {
      expect(isWithinBounds("bg.sofia", 45.0, 25.0)).toBe(false);
      expect(isWithinBounds("bg.sofia", 0, 0)).toBe(false);
    });

    it("should throw for unknown locality", () => {
      expect(() => isWithinBounds("invalid", 42.7, 23.3)).toThrow(
        "Unknown locality",
      );
    });
  });

  describe("validateLocality", () => {
    it("should not throw for valid locality", () => {
      expect(() => validateLocality("bg.sofia")).not.toThrow();
    });

    it("should throw for invalid locality", () => {
      expect(() => validateLocality("invalid")).toThrow("Invalid locality");
    });
  });

  describe("registry consistency", () => {
    it("should have matching keys across BOUNDS, CENTERS, and LOCALITY_METADATA", () => {
      const boundsKeys = Object.keys(BOUNDS).sort();
      const centerKeys = Object.keys(CENTERS).sort();
      const metadataKeys = Object.keys(LOCALITY_METADATA).sort();

      expect(centerKeys).toEqual(boundsKeys);
      expect(metadataKeys).toEqual(boundsKeys);
    });

    it("should throw when registries are out of sync (simulated)", () => {
      const fakeBounds = { "x.one": {}, "y.two": {} } as Record<
        string,
        unknown
      >;
      const fakeCenters = { "x.one": {} } as Record<string, unknown>;
      const fakeMetadata = {
        "x.one": {},
        "y.two": {},
        "z.three": {},
      } as Record<string, unknown>;

      expect(() =>
        assertLocalityRegistriesInSync(fakeBounds, fakeCenters, fakeMetadata),
      ).toThrow(
        "Locality registry mismatch detected. Missing from BOUNDS: z.three Missing from CENTERS: y.two, z.three",
      );
    });
  });
});
