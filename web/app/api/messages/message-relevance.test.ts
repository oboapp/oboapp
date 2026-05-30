import { describe, it, expect } from "vitest";
import { Message, Timespan } from "@/lib/types";

/**
 * Parse a timespan end date string in format "DD.MM.YYYY HH:MM" to Date object
 */
function parseTimespanDate(dateStr: string): Date | null {
  try {
    // Expected format: "DD.MM.YYYY HH:MM"
    const regex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
    const parts = regex.exec(dateStr);
    if (!parts) return null;

    const [, day, month, year, hours, minutes] = parts;
    return new Date(
      Number.parseInt(year),
      Number.parseInt(month) - 1, // JS months are 0-indexed
      Number.parseInt(day),
      Number.parseInt(hours),
      Number.parseInt(minutes),
    );
  } catch {
    return null;
  }
}

/**
 * Check if a message is still relevant based on its timespans or creation date
 */
function isMessageRelevant(message: Message, cutoffDate: Date): boolean {
  // Check denormalized pins and streets for timespans
  const allTimespans: Timespan[] = [];

  // Collect all timespans from pins
  if (message.pins) {
    message.pins.forEach((pin) => {
      if (pin.timespans && Array.isArray(pin.timespans)) {
        allTimespans.push(...pin.timespans);
      }
    });
  }

  // Collect all timespans from streets
  if (message.streets) {
    message.streets.forEach((street) => {
      if (street.timespans && Array.isArray(street.timespans)) {
        allTimespans.push(...street.timespans);
      }
    });
  }

  // If we have timespans, check if any have valid end dates
  if (allTimespans.length > 0) {
    const hasAnyValidTimespan = allTimespans.some((timespan) => {
      if (!timespan.end) return false;
      const endDate = parseTimespanDate(timespan.end);
      return endDate !== null;
    });

    // If we have at least one valid timespan, use timespan-based logic
    if (hasAnyValidTimespan) {
      return allTimespans.some((timespan) => {
        if (!timespan.end) return false;
        const endDate = parseTimespanDate(timespan.end);
        return endDate && endDate >= cutoffDate;
      });
    }
    // All timespans are invalid - fall back to createdAt
  }

  // No timespans found or all timespans invalid - use createdAt date
  const createdAt = new Date(message.createdAt);
  return createdAt >= cutoffDate;
}

describe("isMessageRelevant", () => {
  const cutoffDate = new Date("2026-01-11T00:00:00Z"); // 7 days before 2026-01-18

  describe("timespan-based relevance", () => {
    it("should be relevant if pin timespan ends after cutoff", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
        createdAt: new Date("2025-12-01").toISOString(), // Old createdAt
        pins: [
          {
            address: "Test St",
            timespans: [{ start: "10.01.2026 08:00", end: "20.01.2026 18:00" }],
          },
        ],
        streets: [],
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should be relevant if street timespan ends after cutoff", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
        createdAt: new Date("2025-12-01").toISOString(),
        pins: [],
        streets: [
          {
            street: "Main St",
            from: "A",
            to: "B",
            timespans: [{ start: "10.01.2026 08:00", end: "15.01.2026 18:00" }],
          },
        ],
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should be irrelevant if all timespans end before cutoff", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2025-12-01",
        pins: [
          {
            address: "Test St",
            timespans: [{ start: "01.01.2026 08:00", end: "05.01.2026 18:00" }],
          },
        ],
        streets: [],
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(false);
    });

    it("should be relevant if at least one timespan is after cutoff", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2025-12-01",
        pins: [
          {
            address: "Test St 1",
            timespans: [{ start: "01.01.2026 08:00", end: "05.01.2026 18:00" }], // Old
          },
          {
            address: "Test St 2",
            timespans: [{ start: "15.01.2026 08:00", end: "20.01.2026 18:00" }], // Recent
          },
        ],
        streets: [],
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should fall back to createdAt when timespans have no end date", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15", // Recent createdAt (used when timespans invalid)
        pins: [
          {
            address: "Test St",
            timespans: [{ start: "01.01.2026 08:00", end: "" }],
          },
        ],
        streets: [],
      };

      // Timespans exist but have no valid end date, so falls back to createdAt
      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should fall back to createdAt when timespans have invalid end dates", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15",
        pins: [
          {
            address: "Test St",
            timespans: [{ start: "01.01.2026 08:00", end: "invalid date" }],
          },
        ],
        streets: [],
      };

      // Timespans exist but have invalid end date, so falls back to createdAt
      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should fall back to createdAt when ALL timespans are invalid", () => {
      const recentMessage: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15", // Recent, should be used
        pins: [
          {
            address: "Test St 1",
            timespans: [{ start: "01.01.2026 08:00", end: "" }], // Empty end
          },
          {
            address: "Test St 2",
            timespans: [{ start: "01.01.2026 08:00", end: "invalid date" }], // Invalid end
          },
        ],
        streets: [],
      };

      // All timespans are invalid, so falls back to createdAt
      expect(isMessageRelevant(recentMessage, cutoffDate)).toBe(true);
    });

    it("should NOT fall back to createdAt when at least one timespan is valid", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15", // Recent, but ignored
        pins: [
          {
            address: "Test St 1",
            timespans: [{ start: "01.01.2026 08:00", end: "" }], // Invalid
          },
          {
            address: "Test St 2",
            timespans: [{ start: "01.01.2026 08:00", end: "05.01.2026 18:00" }], // Valid but old
          },
        ],
        streets: [],
      };

      // Has at least one valid timespan, so uses timespan logic (not createdAt)
      // The valid timespan is before cutoff, so returns false
      expect(isMessageRelevant(message, cutoffDate)).toBe(false);
    });

    it("should collect timespans from both pins and streets", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2025-12-01",
        pins: [
          {
            address: "Pin St",
            timespans: [{ start: "01.01.2026 08:00", end: "05.01.2026 18:00" }],
          },
        ],
        streets: [
          {
            street: "Street St",
            from: "A",
            to: "B",
            timespans: [{ start: "15.01.2026 08:00", end: "20.01.2026 18:00" }],
          },
        ],
      };

      // Street timespan is after cutoff
      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });
  });

  describe("createdAt-based relevance", () => {
    it("should be relevant if createdAt is after cutoff and no timespans", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15",
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should be irrelevant if createdAt is before cutoff and no timespans", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-01",
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(false);
    });

    it("should use createdAt if pins and streets are empty", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15",
        pins: [],
        streets: [],
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should use createdAt if pins/streets have empty timespans arrays", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15",
        pins: [{ address: "Test St", timespans: [] }],
        streets: [],
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle message with no pins/streets", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15",
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should handle undefined pins and streets", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15",
        pins: undefined as any,
        streets: undefined as any,
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should handle createdAt as string", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2026-01-15T10:00:00Z",
      };

      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });

    it("should be relevant when timespan ends after cutoff (inclusive)", () => {
      const message: Message = {
        text: "Test",
        locality: "bg.sofia",
      createdAt: "2025-12-01", // Old createdAt
        pins: [
          {
            address: "Test St",
            timespans: [{ start: "10.01.2026 00:00", end: "12.01.2026 00:00" }],
          },
        ],
        streets: [],
      };

      // Timespan end (12.01) is after cutoff (11.01), so should be relevant
      expect(isMessageRelevant(message, cutoffDate)).toBe(true);
    });
  });
});
