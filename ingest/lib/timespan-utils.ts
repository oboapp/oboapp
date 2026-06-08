import type { ExtractedLocations, Timespan } from "./types";

// Use UTC to avoid timezone-dependent boundary behavior
const TIMESPAN_MIN_DATE = new Date(Date.UTC(2025, 0, 1)); // 2025-01-01T00:00:00Z

// Fallback duration for open-ended events (end: null) — "until further notice"
const OPEN_ENDED_FALLBACK_DAYS = 7;

/**
 * Parse Bulgarian date format "DD.MM.YYYY HH:MM" to Date object
 * @param dateStr - Date string in Bulgarian format
 * @returns Date object or null if invalid format
 * @example parseBulgarianDate("23.01.2026 14:30") // => Date(2026-01-23T14:30:00)
 */
export function parseBulgarianDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== "string") {
    return null;
  }

  const regex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
  const parts = regex.exec(dateStr.trim());

  if (!parts) {
    return null;
  }

  const [, day, month, year, hours, minutes] = parts;
  const parsedDay = Number.parseInt(day, 10);
  const parsedMonth = Number.parseInt(month, 10);
  const parsedYear = Number.parseInt(year, 10);
  const parsedHours = Number.parseInt(hours, 10);
  const parsedMinutes = Number.parseInt(minutes, 10);

  const date = new Date(
    parsedYear,
    parsedMonth - 1, // Month is 0-indexed
    parsedDay,
    parsedHours,
    parsedMinutes,
  );

  // Verify the date is valid (handles invalid dates like Feb 30)
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  // Verify the date components match (catches rollover like Feb 31 -> Mar 3)
  if (
    date.getDate() !== parsedDay ||
    date.getMonth() !== parsedMonth - 1 ||
    date.getFullYear() !== parsedYear ||
    date.getHours() !== parsedHours ||
    date.getMinutes() !== parsedMinutes
  ) {
    return null;
  }

  return date;
}

/**
 * Validate timespan is not before 2025-01-01 (filters out parsing errors that create dates in 1970s/2020s)
 * @param date - Date to validate
 * @returns true if date is valid, false otherwise
 */
export function validateTimespanRange(date: Date): boolean {
  return date.getTime() >= TIMESPAN_MIN_DATE.getTime();
}

/**
 * Validate timespans and fallback to a default date if invalid
 * @param timespanStart - Start date to validate
 * @param timespanEnd - End date to validate
 * @param fallbackDate - Date to use if validation fails
 * @returns Validated timespan bounds
 */
export function validateAndFallback(
  timespanStart: Date | undefined,
  timespanEnd: Date | undefined,
  fallbackDate: Date,
): { timespanStart: Date; timespanEnd: Date } {
  const isStartValid = timespanStart
    ? validateTimespanRange(timespanStart)
    : false;
  const isEndValid = timespanEnd ? validateTimespanRange(timespanEnd) : false;

  return {
    timespanStart: isStartValid && timespanStart ? timespanStart : fallbackDate,
    timespanEnd: isEndValid && timespanEnd ? timespanEnd : fallbackDate,
  };
}

/**
 * Parse all timespans from an array and return valid Date objects
 * @param timespans - Array of timespan objects
 * @returns Array of parsed Date objects
 */
function parseTimespans(timespans: Timespan[]): Date[] {
  const dates: Date[] = [];

  for (const timespan of timespans) {
    let startDate: Date | null = null;

    if (timespan.start) {
      startDate = parseBulgarianDate(timespan.start);
      if (startDate) {
        dates.push(startDate);
      }
    }

    if (timespan.end) {
      const endDate = parseBulgarianDate(timespan.end);
      if (endDate) {
        dates.push(endDate);
      }
    } else if (startDate) {
      // end is null — open-ended event ("until further notice")
      // Use start + fallback so the message stays visible on the map
      const fallbackEnd = new Date(startDate);
      fallbackEnd.setDate(fallbackEnd.getDate() + OPEN_ENDED_FALLBACK_DAYS);
      dates.push(fallbackEnd);
    }
  }

  return dates;
}

/**
 * Collect all timespans from extractedData structure
 * @param extractedData - Extracted data containing pins, streets, cadastral properties
 * @returns Array of all timespan objects
 */
function collectTimespansFromArray(
  items: Array<{ timespans?: Timespan[] }>,
): Timespan[] {
  const timespans: Timespan[] = [];
  for (const item of items) {
    if (item.timespans && Array.isArray(item.timespans)) {
      timespans.push(...item.timespans);
    }
  }
  return timespans;
}

function collectAllTimespans(extractedData: ExtractedLocations): Timespan[] {
  const allTimespans: Timespan[] = [];

  if (extractedData.pins && Array.isArray(extractedData.pins)) {
    allTimespans.push(...collectTimespansFromArray(extractedData.pins));
  }

  if (extractedData.streets && Array.isArray(extractedData.streets)) {
    allTimespans.push(...collectTimespansFromArray(extractedData.streets));
  }

  if (
    extractedData.cadastralProperties &&
    Array.isArray(extractedData.cadastralProperties)
  ) {
    allTimespans.push(
      ...collectTimespansFromArray(extractedData.cadastralProperties),
    );
  }

  return allTimespans;
}

/**
 * Extract MIN start and MAX end from extractedData timespans
 * @param extractedData - Extracted data containing timespans
 * @param fallbackDate - Date to use when no timespans exist or all are invalid
 * @returns Object with timespanStart and timespanEnd dates
 */
export function extractTimespanRangeFromExtractedLocations(
  extractedData: ExtractedLocations | null,
  fallbackDate: Date,
): { timespanStart: Date; timespanEnd: Date } {
  if (!extractedData) {
    return { timespanStart: fallbackDate, timespanEnd: fallbackDate };
  }

  const allTimespans = collectAllTimespans(extractedData);

  if (allTimespans.length === 0) {
    return { timespanStart: fallbackDate, timespanEnd: fallbackDate };
  }

  const dates = parseTimespans(allTimespans);

  if (dates.length === 0) {
    return { timespanStart: fallbackDate, timespanEnd: fallbackDate };
  }

  const timestamps = dates.map((d) => d.getTime());
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);

  return {
    timespanStart: new Date(minTimestamp),
    timespanEnd: new Date(maxTimestamp),
  };
}
