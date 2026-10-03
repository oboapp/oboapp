import { describe, expect, it } from "vitest";
import { INTEREST_METERS_PER_DEGREE } from "@oboapp/shared";
import { offsetInterestLocation, validateJitterSecret } from "./jitter";
const secret = "test-only-stable-key-with-at-least-32-bytes";

describe("stable private spatial offsets", () => {
  it("reproduces offsets for a person but changes them for other people and keys", () => {
    const offset = (user: string, key = secret) => offsetInterestLocation(user, "bg.sofia", 42.7, 23.3, key);
    expect(offset("one")).toEqual(offset("one"));
    expect(offset("one")).not.toEqual(offset("two"));
    expect(offset("one")).not.toEqual(offset("one", secret + "different"));
  });
  it("keeps shifts within 200 meters and uses the same displacement for a person's circles", () => {
    for (let i = 0; i < 100; i++) {
      const point = offsetInterestLocation(`user-${i}`, "bg.sofia", 42.7, 23.3, secret);
      const north = (point.lat - 42.7) * INTEREST_METERS_PER_DEGREE;
      const east = (point.lng - 23.3) * INTEREST_METERS_PER_DEGREE * Math.cos(42.7 * Math.PI / 180);
      expect(Math.hypot(north, east)).toBeLessThanOrEqual(200);
      const other = offsetInterestLocation(`user-${i}`, "bg.sofia", 42.7, 23.4, secret);
      expect(other.lat).toBe(point.lat);
      expect(other.lng - point.lng).toBeCloseTo(0.1, 10);
    }
  });
  it("rejects missing or short keys instead of using a public fallback seed", () => {
    expect(() => validateJitterSecret("")).toThrow();
    expect(() => validateJitterSecret("short")).toThrow();
    expect(() => validateJitterSecret(secret)).not.toThrow();
  });
});
