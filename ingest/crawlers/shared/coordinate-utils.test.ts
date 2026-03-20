import { describe, it, expect } from "vitest";
import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";

describe("roundCoordinate", () => {
  it("should round to 6 decimal places by default", () => {
    expect(roundCoordinate(42.7013091079358)).toBe(42.701309);
    expect(roundCoordinate(23.3229612178934)).toBe(23.322961);
  });

  it("should handle rounding up", () => {
    expect(roundCoordinate(42.7006349)).toBe(42.700635);
    expect(roundCoordinate(23.3226669)).toBe(23.322667);
  });

  it("should handle rounding down", () => {
    expect(roundCoordinate(42.7006341)).toBe(42.700634);
    expect(roundCoordinate(23.3226661)).toBe(23.322666);
  });

  it("should handle coordinates with fewer decimal places", () => {
    expect(roundCoordinate(42.7)).toBe(42.7);
    expect(roundCoordinate(23.32)).toBe(23.32);
  });

  it("should handle negative coordinates", () => {
    expect(roundCoordinate(-42.7013091079358)).toBe(-42.701309);
    expect(roundCoordinate(-23.3229612178934)).toBe(-23.322961);
  });

  it("should handle zero", () => {
    expect(roundCoordinate(0)).toBe(0);
    expect(roundCoordinate(0.0000001)).toBe(0);
  });

  it("should respect custom decimal places", () => {
    expect(roundCoordinate(42.7013091079358, 4)).toBe(42.7013);
    expect(roundCoordinate(42.7013091079358, 7)).toBe(42.7013091);
    expect(roundCoordinate(42.7013091079358, 2)).toBe(42.7);
  });

  it("should deduplicate near-duplicate coordinates from ERM data", () => {
    // Example from tmp/erm/incident-129-customer-points.json
    // These differ by only 0.0000001-0.0000004° and should round to the same value
    const lat1 = Number.parseFloat("42.7009321");
    const lat2 = Number.parseFloat("42.7009324");
    const lon1 = Number.parseFloat("23.3234211");
    const lon2 = Number.parseFloat("23.3234214");

    expect(roundCoordinate(lat1)).toBe(roundCoordinate(lat2));
    expect(roundCoordinate(lat1)).toBe(42.700932);
    expect(roundCoordinate(lon1)).toBe(roundCoordinate(lon2));
    expect(roundCoordinate(lon1)).toBe(23.323421);
  });

  it("should handle edge case coordinates differing by ~11cm", () => {
    // Points 6-7 from incident-129-customer-points.json differ by 0.000001° (~11cm)
    const coord1 = 42.700932;
    const coord2 = 42.700933;

    expect(roundCoordinate(coord1)).toBe(42.700932);
    expect(roundCoordinate(coord2)).toBe(42.700933);
  });
});
