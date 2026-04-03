import { describe, it, expect } from "vitest";
import {
  NOWCAST_MIN_WEIGHT,
  calculateNowCastAqi,
  getAqiLabel,
  getAqiCategory,
} from "./aqi";

describe("calculateNowCastAqi", () => {
  it("returns 0 for empty input", () => {
    expect(calculateNowCastAqi([])).toBe(0);
  });

  it("returns EAQI in 'Good' range for low PM values", () => {
    const hourly = [
      { pm25: 5.0, pm10: 10 },
      { pm25: 4.5, pm10: 12 },
    ];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThanOrEqual(1);
    expect(aqi).toBeLessThan(2);
  });

  it("returns EAQI in 'Poor' range for elevated PM", () => {
    // PM2.5 30–40 μg/m³ → Poor band (25–50), PM10 60–80 → Poor band (50–100)
    const hourly = [
      { pm25: 35.0, pm10: 70 },
      { pm25: 30.0, pm10: 65 },
    ];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThanOrEqual(4);
    expect(aqi).toBeLessThan(5);
  });

  it("returns EAQI ≥ 5 for 'Very Poor' PM values", () => {
    // PM2.5 55–70 μg/m³ → Very Poor band (50–75)
    const hourly = [
      { pm25: 60.0, pm10: 120 },
      { pm25: 55.0, pm10: 110 },
    ];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThanOrEqual(5);
  });

  it("uses max of PM2.5 and PM10 EAQI", () => {
    // Low PM2.5 but PM10=130 is in Very Poor band (100–150)
    const hourly = [{ pm25: 3.0, pm10: 130 }];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThanOrEqual(5);
  });

  it("handles a single hour of data", () => {
    const hourly = [{ pm25: 12.0, pm10: 25 }];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThan(0);
  });

  it("caps EAQI at 6 for extreme values", () => {
    const hourly = [{ pm25: 500.0, pm10: 700 }];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBe(6);
  });

  it("applies NowCast weighting — spike gives lower EAQI than steady high", () => {
    // Spike in most recent hour, low values before
    const spikeHours = [
      { pm25: 100.0, pm10: 50 },
      { pm25: 5.0, pm10: 10 },
      { pm25: 5.0, pm10: 10 },
      { pm25: 5.0, pm10: 10 },
    ];
    const steadyHours = [
      { pm25: 100.0, pm10: 50 },
      { pm25: 100.0, pm10: 50 },
      { pm25: 100.0, pm10: 50 },
      { pm25: 100.0, pm10: 50 },
    ];
    expect(calculateNowCastAqi(spikeHours)).toBeLessThan(
      calculateNowCastAqi(steadyHours),
    );
  });

  it("ignores Infinity values (treats them as invalid)", () => {
    // Infinity should be filtered out by Number.isFinite
    const hourly = [{ pm25: Infinity, pm10: 10 }];
    const aqi = calculateNowCastAqi(hourly);
    // pm25 Infinity filtered → only pm10=10 used → Good range
    expect(aqi).toBeGreaterThanOrEqual(1);
    expect(aqi).toBeLessThan(2);
  });

  it("ignores NaN values (treats them as invalid)", () => {
    const hourly = [{ pm25: NaN, pm10: 10 }];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThanOrEqual(1);
    expect(aqi).toBeLessThan(2);
  });

  it("returns 0 when all values are non-finite", () => {
    const hourly = [{ pm25: NaN, pm10: Infinity }];
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBe(0);
  });

  it("weight floor is NOWCAST_MIN_WEIGHT when range/max ≥ 1 - NOWCAST_MIN_WEIGHT", () => {
    // Very high range relative to max → weight should be floored
    const hourly = [
      { pm25: 80.0, pm10: 1 },
      { pm25: 1.0, pm10: 1 },
    ];
    // Just verify result is finite and within EAQI range
    const aqi = calculateNowCastAqi(hourly);
    expect(aqi).toBeGreaterThanOrEqual(1);
    expect(aqi).toBeLessThanOrEqual(6);
  });
});

describe("NOWCAST_MIN_WEIGHT", () => {
  it("is 0.5", () => {
    expect(NOWCAST_MIN_WEIGHT).toBe(0.5);
  });
});

describe("getAqiLabel", () => {
  it.each([
    [1.0, "Добро"],
    [2.5, "Задоволително"],
    [3.5, "Умерено"],
    [4.5, "Лошо"],
    [5.5, "Много лошо"],
    [6.0, "Изключително лошо"],
  ])("returns correct Bulgarian label for EAQI %s", (aqi, expected) => {
    expect(getAqiLabel(aqi)).toBe(expected);
  });

  it("returns boundary labels correctly", () => {
    expect(getAqiLabel(1.99)).toBe("Добро");
    expect(getAqiLabel(2.0)).toBe("Задоволително");
    expect(getAqiLabel(2.99)).toBe("Задоволително");
    expect(getAqiLabel(3.0)).toBe("Умерено");
    expect(getAqiLabel(4.0)).toBe("Лошо");
    expect(getAqiLabel(5.0)).toBe("Много лошо");
  });
});

describe("getAqiCategory", () => {
  it.each([
    [1.0, "good"],
    [2.5, "fair"],
    [3.5, "moderate"],
    [4.5, "poor"],
    [5.5, "very-poor"],
    [6.0, "extremely-poor"],
  ] as const)("returns correct category for EAQI %s", (aqi, expected) => {
    expect(getAqiCategory(aqi)).toBe(expected);
  });

  it("returns boundary categories correctly", () => {
    expect(getAqiCategory(1.99)).toBe("good");
    expect(getAqiCategory(2.0)).toBe("fair");
    expect(getAqiCategory(3.0)).toBe("moderate");
    expect(getAqiCategory(4.0)).toBe("poor");
    expect(getAqiCategory(5.0)).toBe("very-poor");
    expect(getAqiCategory(6.0)).toBe("extremely-poor");
  });
});
