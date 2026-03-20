import { describe, it, expect, beforeEach } from "vitest";
import {
  getLocalityBounds,
  getLocalityCenter,
  getLocalityBbox,
  isCenterFallback,
  isGenericCityAddress,
} from "./utils";
import { BOUNDS, CENTERS } from "@oboapp/shared";

// Set LOCALITY for tests
beforeEach(() => {
  process.env.LOCALITY = "bg.sofia";
});

describe("geocoding-utils", () => {
  describe("getLocality functions", () => {
    it("should get correct bounds for Sofia", () => {
      expect(getLocalityBounds()).toEqual(BOUNDS["bg.sofia"]);
    });

    it("should get correct center for Sofia", () => {
      expect(getLocalityCenter()).toEqual(CENTERS["bg.sofia"]);
    });

    it("should format bbox correctly for Sofia", () => {
      expect(getLocalityBbox()).toBe("42.605,23.188,42.83,23.528");
    });
  });

  describe("isCenterFallback", () => {
    const SOFIA_CENTER = CENTERS["bg.sofia"];

    it("should return true for exact Sofia center coordinates", () => {
      expect(isCenterFallback(SOFIA_CENTER.lat, SOFIA_CENTER.lng)).toBe(
        true
      );
    });

    it("should return true for coordinates that round to Sofia center", () => {
      // Coordinates within rounding precision (4 decimal places)
      expect(isCenterFallback(42.69771, 23.32191)).toBe(true);
      expect(isCenterFallback(42.69769, 23.32189)).toBe(true);
    });

    it("should return false for coordinates that don't round to center", () => {
      // Just outside rounding range
      expect(isCenterFallback(42.69775, 23.32195)).toBe(false);
      expect(isCenterFallback(42.6976, 23.3218)).toBe(false);

      // NDK is far away
      expect(isCenterFallback(42.6847, 23.3188)).toBe(false);

      // Oborishte district
      expect(isCenterFallback(42.6995, 23.3219)).toBe(false);
    });

    it("should detect the exact problematic coordinates from the bug report", () => {
      // These coordinates (42.697708, 23.321867) round to Sofia center
      expect(isCenterFallback(42.697708, 23.321867)).toBe(true);
    });
  });

  describe("isGenericCityAddress", () => {
    it("should be disabled (always returns false) until locality-aware implementation", () => {
      // Function is currently disabled to avoid Sofia-specific hardcoding
      // TODO: Re-enable when locality-aware implementation is added
      expect(isGenericCityAddress("Sofia, Bulgaria")).toBe(false);
      expect(isGenericCityAddress("София, България")).toBe(false);
      expect(isGenericCityAddress("Plovdiv, Bulgaria")).toBe(false);
      expect(isGenericCityAddress("ул. Врабча 1, София, България")).toBe(false);
      expect(isGenericCityAddress("NDK, Sofia, Bulgaria")).toBe(false);
    });
  });
});

