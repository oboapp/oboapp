import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseTimespanDate,
  getTodayBulgarianTime,
  isToday,
  classifyMessage,
  type MessageClassification,
} from "./message-classification";
import type { Message } from "./types";

describe("message-classification", () => {
  describe("parseTimespanDate", () => {
    it("should parse valid Bulgarian date format", () => {
      const result = parseTimespanDate("25.12.2023 14:30");

      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2023);
      expect(result?.getMonth()).toBe(11); // December (0-indexed)
      expect(result?.getDate()).toBe(25);
      expect(result?.getHours()).toBe(14);
      expect(result?.getMinutes()).toBe(30);
    });

    it("should parse date with leading zeros", () => {
      const result = parseTimespanDate("05.03.2024 09:05");

      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(2); // March (0-indexed)
      expect(result?.getDate()).toBe(5);
      expect(result?.getHours()).toBe(9);
      expect(result?.getMinutes()).toBe(5);
    });

    it("should handle edge cases for valid dates", () => {
      // End of month
      expect(parseTimespanDate("31.01.2024 23:59")).toBeInstanceOf(Date);

      // Leap year
      expect(parseTimespanDate("29.02.2024 12:00")).toBeInstanceOf(Date);

      // Start of day
      expect(parseTimespanDate("01.01.2024 00:00")).toBeInstanceOf(Date);
    });

    it("should return null for invalid date formats", () => {
      expect(parseTimespanDate("2023-12-25 14:30")).toBeNull(); // Wrong format
      expect(parseTimespanDate("25/12/2023 14:30")).toBeNull(); // Wrong separators
      expect(parseTimespanDate("25.12.23 14:30")).toBeNull(); // Wrong year format
      expect(parseTimespanDate("25.12.2023 14:30:45")).toBeNull(); // Extra seconds
      expect(parseTimespanDate("25.12.2023")).toBeNull(); // Missing time
      expect(parseTimespanDate("14:30")).toBeNull(); // Missing date
    });

    it("should return null for invalid date values", () => {
      expect(parseTimespanDate("32.12.2023 14:30")).toBeNull(); // Invalid day
      expect(parseTimespanDate("25.13.2023 14:30")).toBeNull(); // Invalid month
      expect(parseTimespanDate("25.12.1999 14:30")).toBeNull(); // Year too old
      expect(parseTimespanDate("25.12.2101 14:30")).toBeNull(); // Year too new
      expect(parseTimespanDate("25.12.2023 24:30")).toBeNull(); // Invalid hour
      expect(parseTimespanDate("25.12.2023 14:60")).toBeNull(); // Invalid minute
    });

    it("should return null for invalid input types", () => {
      expect(parseTimespanDate("")).toBeNull();
      expect(parseTimespanDate("   ")).toBeNull();
      expect(parseTimespanDate(null as any)).toBeNull();
      expect(parseTimespanDate(undefined as any)).toBeNull();
      expect(parseTimespanDate(123 as any)).toBeNull();
    });

    it("should handle whitespace around date string", () => {
      const result = parseTimespanDate("  25.12.2023 14:30  ");

      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2023);
    });
  });

  describe("getTodayBulgarianTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return current date in Bulgarian timezone", () => {
      // Set to January 15, 2024, 15:30 UTC
      vi.setSystemTime(new Date("2024-01-15T15:30:00.000Z"));

      const result = getTodayBulgarianTime();

      // Bulgarian time is UTC+2 in winter, so 15:30 UTC = 17:30 Bulgarian
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(15);
    });

    it("should handle daylight saving time correctly", () => {
      // Set to July 15, 2024, 15:30 UTC (DST period)
      vi.setSystemTime(new Date("2024-07-15T15:30:00.000Z"));

      const result = getTodayBulgarianTime();

      // Bulgarian time is UTC+3 in summer, so 15:30 UTC = 18:30 Bulgarian
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(6); // July
      expect(result.getDate()).toBe(15);
    });
  });

  describe("isToday", () => {
    it("should return true for same date", () => {
      const date1 = new Date("2024-01-15T10:30:00");
      const date2 = new Date("2024-01-15T18:45:00");

      expect(isToday(date1, date2)).toBe(true);
    });

    it("should return false for different dates", () => {
      const date1 = new Date("2024-01-15T10:30:00");
      const date2 = new Date("2024-01-16T10:30:00");

      expect(isToday(date1, date2)).toBe(false);
    });

    it("should handle year boundaries", () => {
      const date1 = new Date("2023-12-31T23:59:00");
      const date2 = new Date("2024-01-01T00:01:00");

      expect(isToday(date1, date2)).toBe(false);
    });

    it("should handle month boundaries", () => {
      const date1 = new Date("2024-01-31T23:59:00");
      const date2 = new Date("2024-02-01T00:01:00");

      expect(isToday(date1, date2)).toBe(false);
    });

    it("should return false for invalid dates", () => {
      const validDate = new Date("2024-01-15T10:30:00");

      expect(isToday(null as any, validDate)).toBe(false);
      expect(isToday(validDate, null as any)).toBe(false);
      expect(isToday(null as any, null as any)).toBe(false);
      expect(isToday(undefined as any, validDate)).toBe(false);
    });
  });

  describe("classifyMessage", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Set to January 15, 2024, 12:00 Bulgarian time
      vi.setSystemTime(new Date("2024-01-15T10:00:00.000Z")); // UTC+2 winter time
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should classify as active when latest timespan is today", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T10:00:00.000Z",
        timespanEnd: "2024-01-15T14:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should classify as archived when latest timespan is not today", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T10:00:00.000Z",
        timespanEnd: "2024-01-14T14:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe(
        "archived" as MessageClassification,
      );
    });

    it("should fallback to createdAt when no valid timespans", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-15T08:00:00.000Z", // Today in UTC (10:00 Bulgarian)
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should classify as archived using createdAt fallback", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T08:00:00.000Z", // Yesterday
      };

      expect(classifyMessage(message)).toBe(
        "archived" as MessageClassification,
      );
    });

    it("should handle createdAt as string", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-15T08:00:00.000Z", // Today as string
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should default to archived when no date information available", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-10T08:00:00.000Z", // Old date
        // No extractedData
      };

      expect(classifyMessage(message)).toBe(
        "archived" as MessageClassification,
      );
    });

    it("should prioritize timespan over createdAt", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-15T08:00:00.000Z", // Today (would be active)
        timespanEnd: "2024-01-14T14:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe(
        "archived" as MessageClassification,
      );
    });

    it("should handle timezone conversion for timespans correctly", () => {
      // Test with a timespan that could be today or yesterday depending on timezone
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T10:00:00.000Z",
        timespanEnd: "2024-01-15T01:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should classify as active when latest timespan is in the future", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T10:00:00.000Z",
        timespanEnd: "2024-01-16T14:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should classify as active when latest timespan is multiple days in the future", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T10:00:00.000Z",
        timespanEnd: "2024-01-22T16:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should classify as active when has mixed past and future timespans", () => {
      const message: Message = {
        id: "test-1",
        text: "Test message",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2024-01-14T10:00:00.000Z",
        timespanEnd: "2024-01-16T16:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);
    });

    it("should classify as active for the user's reported case (21-22 January 2026)", () => {
      // Set mock time to January 16, 2026 (the current date according to user's report)
      vi.setSystemTime(new Date("2026-01-16T10:00:00.000Z"));

      const message: Message = {
        id: "test-reported-case",
        text: "ул. Св. Св. Кирил и Методий\nОт: ул. Дунав → До: ул. 11-ти август",
        source: "test",
        locality: "bg.sofia",
      createdAt: "2026-01-14T10:00:00.000Z",
        timespanEnd: "2026-01-22T16:00:00.000Z",
      };

      expect(classifyMessage(message)).toBe("active" as MessageClassification);

      // Reset to original test time
      vi.setSystemTime(new Date("2024-01-15T10:00:00.000Z"));
    });
  });
});
