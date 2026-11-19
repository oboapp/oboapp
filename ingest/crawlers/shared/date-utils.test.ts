import { describe, expect, it } from "vitest";
import {
  parseBulgarianDate,
  parseBulgarianMonthDate,
} from "./date-utils";

describe("parseBulgarianDate", () => {
  it("should parse date with dot separator (DD.MM.YYYY)", () => {
    const isoDate = parseBulgarianDate("29.12.2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(29);
    expect(date.getMonth()).toBe(11); // December (0-indexed)
    expect(date.getFullYear()).toBe(2025);
  });

  it("should parse date with slash separator (DD/MM/YYYY)", () => {
    const isoDate = parseBulgarianDate("29/12/2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(29);
    expect(date.getMonth()).toBe(11); // December
    expect(date.getFullYear()).toBe(2025);
  });

  it("should parse date with leading zeros", () => {
    const isoDate = parseBulgarianDate("01.01.2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(0); // January
    expect(date.getFullYear()).toBe(2025);
  });

  it("should parse date with slash and leading zeros", () => {
    const isoDate = parseBulgarianDate("05/03/2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(5);
    expect(date.getMonth()).toBe(2); // March
    expect(date.getFullYear()).toBe(2025);
  });

  it("should return current date ISO string for invalid format", () => {
    const before = new Date();
    const isoDate = parseBulgarianDate("invalid-date");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date ISO string for empty string", () => {
    const before = new Date();
    const isoDate = parseBulgarianDate("");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should handle mixed separators by normalizing to dots", () => {
    const isoDate = parseBulgarianDate("15/06/2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(15);
    expect(date.getMonth()).toBe(5); // June
    expect(date.getFullYear()).toBe(2025);
  });

  it("should return ISO string format", () => {
    const isoDate = parseBulgarianDate("29.12.2025");

    // ISO string should match YYYY-MM-DDTHH:mm:ss.sssZ format
    expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should parse date with 2-digit year (DD.MM.YY)", () => {
    const isoDate = parseBulgarianDate("17.07.25");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(17);
    expect(date.getMonth()).toBe(6); // July (0-indexed)
    expect(date.getFullYear()).toBe(2025);
  });

  it("should parse date with 2-digit year and slash separator (DD/MM/YY)", () => {
    const isoDate = parseBulgarianDate("15/03/24");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(15);
    expect(date.getMonth()).toBe(2); // March
    expect(date.getFullYear()).toBe(2024);
  });

  it("should parse date with 2-digit year and leading zeros (DD.MM.YY)", () => {
    const isoDate = parseBulgarianDate("01.01.26");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(0); // January
    expect(date.getFullYear()).toBe(2026);
  });

  it("should handle 2-digit year assuming 20XX century", () => {
    const isoDate = parseBulgarianDate("31.12.99");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(31);
    expect(date.getMonth()).toBe(11); // December
    expect(date.getFullYear()).toBe(2099);
  });
});

describe("parseBulgarianMonthDate", () => {
  it("should parse date with Bulgarian month name (DD Month YYYY)", () => {
    const isoDate = parseBulgarianMonthDate("20 октомври 2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(20);
    expect(date.getMonth()).toBe(9); // October (0-indexed)
    expect(date.getFullYear()).toBe(2025);
  });

  it("should handle capitalized month names", () => {
    const isoDate = parseBulgarianMonthDate("20 Октомври 2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(20);
    expect(date.getMonth()).toBe(9); // October
    expect(date.getFullYear()).toBe(2025);
  });

  it("should parse all Bulgarian months correctly", () => {
    const testCases = [
      { input: "15 януари 2025", month: 0 },
      { input: "15 февруари 2025", month: 1 },
      { input: "15 март 2025", month: 2 },
      { input: "15 април 2025", month: 3 },
      { input: "15 май 2025", month: 4 },
      { input: "15 юни 2025", month: 5 },
      { input: "15 юли 2025", month: 6 },
      { input: "27 август 2025", month: 7 },
      { input: "19 септември 2025", month: 8 },
      { input: "14 октомври 2025", month: 9 },
      { input: "15 ноември 2025", month: 10 },
      { input: "15 декември 2025", month: 11 },
    ];

    for (const { input, month } of testCases) {
      const isoDate = parseBulgarianMonthDate(input);
      const date = new Date(isoDate);
      expect(date.getMonth()).toBe(month);
      expect(date.getFullYear()).toBe(2025);
    }
  });

  it("should handle single-digit days", () => {
    const isoDate = parseBulgarianMonthDate("3 февруари 2026");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(3);
    expect(date.getMonth()).toBe(1); // February
    expect(date.getFullYear()).toBe(2026);
  });

  it("should handle different years", () => {
    const isoDate = parseBulgarianMonthDate("25 декември 2024");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(25);
    expect(date.getMonth()).toBe(11); // December
    expect(date.getFullYear()).toBe(2024);
  });

  it("should handle uppercase month names", () => {
    const isoDate = parseBulgarianMonthDate("1 ЯНУАРИ 2025");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(0); // January
    expect(date.getFullYear()).toBe(2025);
  });

  it("should return current date for invalid format", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("invalid-date");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for unknown month name", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("20 foobar 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for empty string", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return ISO string format", () => {
    const isoDate = parseBulgarianMonthDate("20 октомври 2025");

    // ISO string should match YYYY-MM-DDTHH:mm:ss.sssZ format
    expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should handle extra whitespace", () => {
    const isoDate = parseBulgarianMonthDate("  20   октомври   2025  ");

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(20);
    expect(date.getMonth()).toBe(9); // October
    expect(date.getFullYear()).toBe(2025);
  });

  it("should handle February 29 in leap year", () => {
    const isoDate = parseBulgarianMonthDate("29 февруари 2024"); // 2024 is a leap year

    const date = new Date(isoDate);
    expect(date.getDate()).toBe(29);
    expect(date.getMonth()).toBe(1); // February
    expect(date.getFullYear()).toBe(2024);
  });

  it("should return current date for February 29 in non-leap year", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("29 февруари 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for February 31", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("31 февруари 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for April 31", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("31 април 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for June 31", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("31 юни 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for September 31", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("31 септември 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should return current date for November 31", () => {
    const before = new Date();
    const isoDate = parseBulgarianMonthDate("31 ноември 2025");
    const after = new Date();

    const parsed = new Date(isoDate);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
