import { describe, it, expect } from "vitest";
import {
  parseBulgarianDate,
  validateTimespanRange,
  extractTimespanRangeFromExtractedLocations,
} from "./timespan-utils";
import type { ExtractedLocations } from "./types";

describe("parseBulgarianDate", () => {
  it("should parse valid Bulgarian date format", () => {
    const result = parseBulgarianDate("23.01.2026 14:30");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(0); // January (0-indexed)
    expect(result?.getDate()).toBe(23);
    expect(result?.getHours()).toBe(14);
    expect(result?.getMinutes()).toBe(30);
  });

  it("should parse date with single-digit day/month", () => {
    const result = parseBulgarianDate("05.03.2026 09:05");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getDate()).toBe(5);
    expect(result?.getMonth()).toBe(2); // March
  });

  it("should return null for invalid format", () => {
    expect(parseBulgarianDate("2026-01-23 14:30")).toBeNull(); // ISO format
    expect(parseBulgarianDate("23/01/2026 14:30")).toBeNull(); // Wrong separator
    expect(parseBulgarianDate("23.01.2026")).toBeNull(); // Missing time
    expect(parseBulgarianDate("14:30")).toBeNull(); // Only time
  });

  it("should return null for invalid dates", () => {
    expect(parseBulgarianDate("31.02.2026 14:30")).toBeNull(); // Feb 31
    expect(parseBulgarianDate("00.01.2026 14:30")).toBeNull(); // Day 0
    expect(parseBulgarianDate("23.13.2026 14:30")).toBeNull(); // Month 13
  });

  it("should return null for null/undefined input", () => {
    expect(parseBulgarianDate("")).toBeNull();
    expect(parseBulgarianDate(null as any)).toBeNull();
    expect(parseBulgarianDate(undefined as any)).toBeNull();
  });

  it("should handle leap years correctly", () => {
    const result = parseBulgarianDate("29.02.2024 10:00");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getDate()).toBe(29);

    const invalid = parseBulgarianDate("29.02.2025 10:00"); // Not leap year
    expect(invalid).toBeNull();
  });

  it("should trim whitespace", () => {
    const result = parseBulgarianDate("  23.01.2026 14:30  ");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2026);
  });
});

describe("validateTimespanRange", () => {
  it("should accept dates within valid range (2025-2027)", () => {
    expect(validateTimespanRange(new Date("2025-01-01T00:00:00Z"))).toBe(true);
    expect(validateTimespanRange(new Date("2026-06-15T12:00:00Z"))).toBe(true);
    expect(validateTimespanRange(new Date("2027-01-01T23:59:59Z"))).toBe(true);
  });

  it("should reject dates before 2025", () => {
    expect(validateTimespanRange(new Date("2024-12-31T23:59:59Z"))).toBe(false);
    expect(validateTimespanRange(new Date("2020-01-01T00:00:00Z"))).toBe(false);
  });

  it("should accept dates after 2025", () => {
    expect(validateTimespanRange(new Date("2027-01-02T00:00:00Z"))).toBe(true);
    expect(validateTimespanRange(new Date("2030-01-01T00:00:00Z"))).toBe(true);
  });

  it("should handle boundary dates correctly", () => {
    // First second of valid range
    expect(validateTimespanRange(new Date("2025-01-01T00:00:00.001Z"))).toBe(
      true,
    );

    // Future dates are valid
    expect(validateTimespanRange(new Date("2030-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("extractTimespanRangeFromExtractedLocations", () => {
  const fallbackDate = new Date("2026-01-01T00:00:00Z");

  it("should return fallback when extractedData is null", () => {
    const result = extractTimespanRangeFromExtractedLocations(
      null,
      fallbackDate,
    );

    expect(result.timespanStart).toBe(fallbackDate);
    expect(result.timespanEnd).toBe(fallbackDate);
  });

  it("should return fallback when no timespans exist", () => {
    const extractedData: ExtractedLocations = {
      pins: [],
      streets: [],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    expect(result.timespanStart).toBe(fallbackDate);
    expect(result.timespanEnd).toBe(fallbackDate);
  });

  it("should extract MIN start and MAX end from pins", () => {
    const extractedData: ExtractedLocations = {
      pins: [
        {
          address: "Address 1",
          timespans: [
            { start: "10.01.2026 08:00", end: "10.01.2026 12:00" },
            { start: "15.01.2026 14:00", end: "15.01.2026 18:00" },
          ],
        },
      ],
      streets: [],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    // Dates parsed in local timezone - just check year, month, day
    expect(result.timespanStart.getFullYear()).toBe(2026);
    expect(result.timespanStart.getMonth()).toBe(0); // January
    expect(result.timespanStart.getDate()).toBe(10);
    expect(result.timespanStart.getHours()).toBe(8);

    expect(result.timespanEnd.getFullYear()).toBe(2026);
    expect(result.timespanEnd.getMonth()).toBe(0);
    expect(result.timespanEnd.getDate()).toBe(15);
    expect(result.timespanEnd.getHours()).toBe(18);
  });

  it("should extract MIN start and MAX end from streets", () => {
    const extractedData: ExtractedLocations = {
      pins: [],
      streets: [
        {
          street: "Street 1",
          from: "A",
          to: "B",
          timespans: [{ start: "05.01.2026 06:00", end: "05.01.2026 10:00" }],
        },
      ],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    expect(result.timespanStart.getFullYear()).toBe(2026);
    expect(result.timespanStart.getMonth()).toBe(0); // January
    expect(result.timespanStart.getDate()).toBe(5);
    expect(result.timespanStart.getHours()).toBe(6);

    expect(result.timespanEnd.getFullYear()).toBe(2026);
    expect(result.timespanEnd.getDate()).toBe(5);
    expect(result.timespanEnd.getHours()).toBe(10);
  });

  it("should extract from cadastral properties", () => {
    const extractedData: ExtractedLocations = {
      pins: [],
      streets: [],
      cadastralProperties: [
        {
          identifier: "УПИ-123",
          timespans: [{ start: "20.01.2026 09:00", end: "20.01.2026 17:00" }],
        },
      ],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    expect(result.timespanStart.getFullYear()).toBe(2026);
    expect(result.timespanStart.getMonth()).toBe(0);
    expect(result.timespanStart.getDate()).toBe(20);
    expect(result.timespanStart.getHours()).toBe(9);

    expect(result.timespanEnd.getDate()).toBe(20);
    expect(result.timespanEnd.getHours()).toBe(17);
  });

  it("should combine timespans from multiple sources", () => {
    const extractedData: ExtractedLocations = {
      pins: [
        {
          address: "Pin 1",
          timespans: [{ start: "10.01.2026 08:00", end: "10.01.2026 10:00" }],
        },
      ],
      streets: [
        {
          street: "Street 1",
          from: "A",
          to: "B",
          timespans: [{ start: "05.01.2026 14:00", end: "15.01.2026 18:00" }],
        },
      ],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    // MIN from street (Jan 5 14:00), MAX from street (Jan 15 18:00)
    expect(result.timespanStart.getDate()).toBe(5);
    expect(result.timespanStart.getHours()).toBe(14);

    expect(result.timespanEnd.getDate()).toBe(15);
    expect(result.timespanEnd.getHours()).toBe(18);
  });

  it("should handle invalid date formats gracefully", () => {
    const extractedData: ExtractedLocations = {
      pins: [
        {
          address: "Pin 1",
          timespans: [
            { start: "invalid", end: "also-invalid" },
            { start: "10.01.2026 08:00", end: "10.01.2026 10:00" },
          ],
        },
      ],
      streets: [],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    // Should use valid timespan, ignore invalid
    expect(result.timespanStart.getDate()).toBe(10);
    expect(result.timespanStart.getHours()).toBe(8);
    expect(result.timespanEnd.getDate()).toBe(10);
    expect(result.timespanEnd.getHours()).toBe(10);
  });

  it("should return fallback when all timespans are invalid", () => {
    const extractedData: ExtractedLocations = {
      pins: [
        {
          address: "Pin 1",
          timespans: [{ start: "invalid", end: "also-invalid" }],
        },
      ],
      streets: [],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    expect(result.timespanStart).toBe(fallbackDate);
    expect(result.timespanEnd).toBe(fallbackDate);
  });

  it("should use start + 30 days as timespanEnd for open-ended timespans (end: null)", () => {
    const extractedData: ExtractedLocations = {
      pins: [],
      streets: [
        {
          street: "ул. Кн. Александър I",
          from: "ул. Ген. Гурко",
          to: "ул. Съборна",
          timespans: [{ start: "04.03.2026 15:00", end: null }],
        },
      ],
    };

    const result = extractTimespanRangeFromExtractedLocations(
      extractedData,
      fallbackDate,
    );

    // timespanStart should be the parsed start date: 04.03.2026 15:00
    expect(result.timespanStart).toEqual(new Date(2026, 2, 4, 15, 0));
    // timespanEnd should be start + 7 days: 11.03.2026 15:00
    expect(result.timespanEnd).toEqual(new Date(2026, 2, 11, 15, 0));
  });
});
