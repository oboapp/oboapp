import { logger } from "@/lib/logger";

const BULGARIAN_MONTH_TO_NUMBER: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

/**
 * Parse Bulgarian date format (DD.MM.YYYY, DD.MM.YY, or DD/MM/YYYY) to ISO string
 * Supports both 2-digit (YY) and 4-digit (YYYY) years
 */
export function parseBulgarianDate(dateStr: string): string {
  try {
    // Format: "19.12.2025" or "19/12/2025" or "17.07.25"
    // Handle both dot and slash separators
    const normalized = dateStr.trim().replaceAll("/", ".");
    const parts = normalized.split(".");
    if (parts.length === 3) {
      const [day, month, yearPart] = parts;
      let year = yearPart;

      // Convert 2-digit year to 4-digit year (assume 20XX)
      if (year.length === 2) {
        year = `20${year}`;
      }

      const date = new Date(`${year}-${month}-${day}`);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    logger.warn("Unable to parse date, using current date", { dateStr });
    return new Date().toISOString();
  } catch (error) {
    logger.error("Error parsing date", {
      dateStr,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Date().toISOString();
  }
}

/**
 * Parse Bulgarian date-time format "DD.MM.YYYY HH:MM" to Date object
 *
 * @param dateStr - Date string in Bulgarian format (e.g., "29.12.2025 10:51")
 * @returns Date object in runtime local timezone
 * @throws Error if date string is invalid
 */
export function parseBulgarianDateTime(dateStr: string): Date {
  if (!dateStr || typeof dateStr !== "string") {
    throw new Error(`Invalid date string: ${dateStr}`);
  }

  const trimmed = dateStr.trim();

  // Expected format: "DD.MM.YYYY HH:MM"
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(trimmed);

  if (!match) {
    throw new Error(
      `Date string does not match Bulgarian format "DD.MM.YYYY HH:MM": ${dateStr}`,
    );
  }

  const [, day, month, year, hour, minute] = match;

  // Parse components (months are 0-indexed in JavaScript Date)
  const parsedDay = Number.parseInt(day, 10);
  const parsedMonth = Number.parseInt(month, 10) - 1; // 0-indexed
  const parsedYear = Number.parseInt(year, 10);
  const parsedHour = Number.parseInt(hour, 10);
  const parsedMinute = Number.parseInt(minute, 10);

  // Validate ranges
  if (parsedMonth < 0 || parsedMonth > 11) {
    throw new Error(`Invalid month: ${month}`);
  }

  if (parsedDay < 1 || parsedDay > 31) {
    throw new Error(`Invalid day: ${day}`);
  }

  if (parsedHour < 0 || parsedHour > 23) {
    throw new Error(`Invalid hour: ${hour}`);
  }

  if (parsedMinute < 0 || parsedMinute > 59) {
    throw new Error(`Invalid minute: ${minute}`);
  }

  // Create date in runtime local timezone.
  const date = new Date(
    parsedYear,
    parsedMonth,
    parsedDay,
    parsedHour,
    parsedMinute,
    0,
    0,
  );

  // Check if date is valid (e.g., not 31st February)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${dateStr}`);
  }

  // Verify the parsed date matches input (catches invalid dates like Feb 31)
  if (
    date.getDate() !== parsedDay ||
    date.getMonth() !== parsedMonth ||
    date.getFullYear() !== parsedYear
  ) {
    throw new Error(`Invalid date (out of range): ${dateStr}`);
  }

  return date;
}

/**
 * Parse Bulgarian short date format with 2-digit year (DD.MM.YY) to ISO string
 * Optionally combines with time (HH:MM)
 *
 * @param dateStr - Date string in format "DD.MM.YY" (e.g., "17.07.25")
 * @param timeStr - Optional time string in format "HH:MM" (e.g., "18:48")
 * @returns ISO date string
 *
 * @example
 * parseShortBulgarianDateTime("17.07.25", "18:48") // "2025-07-17T18:48:00.000Z" (runtime timezone)
 * parseShortBulgarianDateTime("17.07.25") // "2025-07-17T00:00:00.000Z" (runtime timezone)
 */
export function parseShortBulgarianDateTime(
  dateStr: string,
  timeStr?: string,
): string {
  try {
    // Format: "DD.MM.YY" optionally with "HH:MM"
    const normalized = dateStr.trim().replaceAll("/", ".");
    const parts = normalized.split(".");

    if (parts.length === 3) {
      const [day, month, shortYear] = parts;

      // Convert 2-digit year to 4-digit year (always assume 20XX)
      const year = `20${shortYear}`;

      // Parse time if provided
      let hour = "00";
      let minute = "00";
      if (timeStr) {
        const timeParts = timeStr.trim().split(":");
        if (timeParts.length === 2) {
          hour = timeParts[0].padStart(2, "0");
          minute = timeParts[1].padStart(2, "0");
        }
      }

      // Create date in runtime local timezone.
      const date = new Date(
        Number.parseInt(year, 10),
        Number.parseInt(month, 10) - 1, // 0-indexed months
        Number.parseInt(day, 10),
        Number.parseInt(hour, 10),
        Number.parseInt(minute, 10),
        0,
        0,
      );

      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    logger.warn("Unable to parse short date, using current date", {
      dateStr,
      timeStr: timeStr || "",
    });
    return new Date().toISOString();
  } catch (error) {
    logger.error("Error parsing short date", {
      dateStr,
      timeStr: timeStr || "",
      error: error instanceof Error ? error.message : String(error),
    });
    return new Date().toISOString();
  }
}

/**
 * Parse Bulgarian month name date format (DD Month YYYY) to ISO string
 * Example: "20 Октомври 2025" -> ISO date string
 *
 * @param dateStr - Date string in format "DD Month YYYY" (e.g., "20 Октомври 2025")
 * @returns ISO date string
 */
export function parseBulgarianMonthDate(dateStr: string): string {
  try {
    // Clean and normalize the input
    const cleaned = dateStr.trim();

    // Match pattern: "DD Month YYYY" (e.g., "20 Октомври 2025")
    const match = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/.exec(cleaned);

    if (!match) {
      logger.warn("Unable to parse Bulgarian month date, using current date", {
        dateStr,
      });
      return new Date().toISOString();
    }

    const [, day, monthName, year] = match;
    const monthLower = monthName.toLowerCase();
    const month = BULGARIAN_MONTH_TO_NUMBER[monthLower];

    if (!month) {
      logger.warn("Unknown Bulgarian month name, using current date", {
        monthName,
      });
      return new Date().toISOString();
    }

    // Create date in runtime local timezone.
    const date = new Date(
      Number.parseInt(year, 10),
      month - 1, // 0-indexed months
      Number.parseInt(day, 10),
      0, // hour
      0, // minute
      0, // second
      0, // millisecond
    );

    if (Number.isNaN(date.getTime())) {
      logger.warn("Invalid date components, using current date", { dateStr });
      return new Date().toISOString();
    }

    // Verify the parsed date matches input (catches invalid dates like Feb 31)
    const parsedDay = Number.parseInt(day, 10);
    const parsedMonth = month - 1; // 0-indexed
    const parsedYear = Number.parseInt(year, 10);

    if (
      date.getDate() !== parsedDay ||
      date.getMonth() !== parsedMonth ||
      date.getFullYear() !== parsedYear
    ) {
      logger.warn("Invalid date (out of range), using current date", {
        dateStr,
      });
      return new Date().toISOString();
    }

    return date.toISOString();
  } catch (error) {
    logger.error("Error parsing Bulgarian month date", {
      dateStr,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Date().toISOString();
  }
}

/**
 * Format date for display in Bulgarian format
 *
 * @param date - Date object to format
 * @returns Formatted string "DD.MM.YYYY HH:MM"
 */
export function formatBulgarianDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hour}:${minute}`;
}

function buildDate(year: number, month: number, day: number): Date {
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`Invalid date: ${day}.${month}.${year}`);
  }

  return date;
}

function removeParenthesizedText(text: string): string {
  let depth = 0;
  let result = "";

  for (const char of text) {
    if (char === "(") {
      depth++;
      continue;
    }

    if (char === ")") {
      if (depth > 0) {
        depth--;
      } else {
        result += char;
      }
      continue;
    }

    if (depth === 0) {
      result += char;
    }
  }

  return result;
}

/**
 * Parse Bulgarian date text into a date range.
 * Supported formats:
 * - 27.01.2026
 * - 15-19.03.2026
 * - 15.02-19.03.2026
 * - 27 януари 2026
 * - 27 януари (сряда) 2026
 */
export function parseBulgarianDateOrRange(dateText: string): {
  start: Date;
  end: Date;
} {
  const normalized = removeParenthesizedText(dateText.trim().toLowerCase())
    .replace(/\s+/g, " ")
    .trim();

  // DD.MM-DD.MM.YYYY
  const crossMonthRange = /(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(normalized);
  if (crossMonthRange) {
    const startDay = Number.parseInt(crossMonthRange[1], 10);
    const startMonth = Number.parseInt(crossMonthRange[2], 10);
    const endDay = Number.parseInt(crossMonthRange[3], 10);
    const endMonth = Number.parseInt(crossMonthRange[4], 10);
    const yearRaw = Number.parseInt(crossMonthRange[5], 10);
    const year = crossMonthRange[5].length === 2 ? 2000 + yearRaw : yearRaw;

    return {
      start: buildDate(year, startMonth, startDay),
      end: buildDate(year, endMonth, endDay),
    };
  }

  // DD-DD.MM.YYYY
  const sameMonthRange = /(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(normalized);
  if (sameMonthRange) {
    const startDay = Number.parseInt(sameMonthRange[1], 10);
    const endDay = Number.parseInt(sameMonthRange[2], 10);
    const month = Number.parseInt(sameMonthRange[3], 10);
    const yearRaw = Number.parseInt(sameMonthRange[4], 10);
    const year = sameMonthRange[4].length === 2 ? 2000 + yearRaw : yearRaw;

    return {
      start: buildDate(year, month, startDay),
      end: buildDate(year, month, endDay),
    };
  }

  // DD.MM.YYYY
  const numericSingle = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(normalized);
  if (numericSingle) {
    const day = Number.parseInt(numericSingle[1], 10);
    const month = Number.parseInt(numericSingle[2], 10);
    const yearRaw = Number.parseInt(numericSingle[3], 10);
    const year = numericSingle[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const date = buildDate(year, month, day);

    return {
      start: date,
      end: date,
    };
  }

  // DD <month> YYYY
  const monthNameSingle = /(\d{1,2})\s+([а-я]+)\s+(\d{4})/.exec(normalized);
  if (monthNameSingle) {
    const day = Number.parseInt(monthNameSingle[1], 10);
    const monthName = monthNameSingle[2];
    const year = Number.parseInt(monthNameSingle[3], 10);
    const month = BULGARIAN_MONTH_TO_NUMBER[monthName];

    if (!month) {
      throw new Error(`Unsupported Bulgarian month: ${monthName}`);
    }

    const date = buildDate(year, month, day);
    return {
      start: date,
      end: date,
    };
  }

  throw new Error(`Unable to parse Bulgarian date text: ${dateText}`);
}

/**
 * Check whether a given reference date falls within a date range (inclusive).
 *
 * Both the range boundaries and the reference date are normalized to midnight,
 * so only the calendar date is compared (time of day is ignored).
 *
 * @param range - The date range to check against, with `start` and `end` dates.
 * @param referenceDate - The date to test for relevance. Defaults to the current date.
 * @returns `true` if the normalized reference date is between `range.start` and `range.end`
 * (inclusive), otherwise `false`.
 *
 * @example
 * const range = { start: new Date("2026-03-15"), end: new Date("2026-03-19") };
 * isDateRelevant(range, new Date("2026-03-17")); // true
 * isDateRelevant(range, new Date("2026-03-20")); // false
 *
 * @example
 * // Using the result of parseBulgarianDateOrRange
 * const dateRange = parseBulgarianDateOrRange("15-19.03.2026");
 * isDateRelevant(dateRange); // uses today's date as the reference
 */
export function isDateRelevant(
  range: { start: Date; end: Date },
  referenceDate: Date = new Date(),
): boolean {
  const reference = new Date(referenceDate);
  reference.setHours(0, 0, 0, 0);

  const start = new Date(range.start);
  start.setHours(0, 0, 0, 0);

  const end = new Date(range.end);
  end.setHours(0, 0, 0, 0);

  return reference >= start && reference <= end;
}
