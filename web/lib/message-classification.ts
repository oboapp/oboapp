import type { Message } from "./types";

export type MessageClassification = "active" | "archived";

const DEFAULT_CLASSIFICATION_TIME_ZONE = "UTC";

export function getClassificationTimeZone(): string {
  const configuredTimeZone =
    process.env.NEXT_PUBLIC_TIMEZONE?.trim() ||
    process.env.NEXT_PUBLIC_TIME_ZONE?.trim();

  return configuredTimeZone || DEFAULT_CLASSIFICATION_TIME_ZONE;
}

/**
 * Parse Bulgarian timespan date format "DD.MM.YYYY HH:MM"
 * Returns null if parsing fails
 */
export function parseTimespanDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== "string") {
    return null;
  }

  const regex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
  const parts = regex.exec(dateStr.trim());

  if (!parts) {
    return null;
  }

  const [, day, month, year, hours, minutes] = parts;

  // Validate ranges
  const dayNum = Number.parseInt(day, 10);
  const monthNum = Number.parseInt(month, 10);
  const yearNum = Number.parseInt(year, 10);
  const hoursNum = Number.parseInt(hours, 10);
  const minutesNum = Number.parseInt(minutes, 10);

  if (
    dayNum < 1 ||
    dayNum > 31 ||
    monthNum < 1 ||
    monthNum > 12 ||
    yearNum < 2000 ||
    yearNum > 2100 ||
    hoursNum < 0 ||
    hoursNum > 23 ||
    minutesNum < 0 ||
    minutesNum > 59
  ) {
    return null;
  }

  return new Date(
    yearNum,
    monthNum - 1, // JS months are 0-indexed
    dayNum,
    hoursNum,
    minutesNum,
  );
}

/**
 * Get current date in instance classification timezone.
 * The timezone comes from NEXT_PUBLIC_TIMEZONE (or NEXT_PUBLIC_TIME_ZONE)
 * and defaults to UTC.
 */
export function getTodayBulgarianTime(): Date {
  const classificationTimeString = new Date().toLocaleString("en-US", {
    timeZone: getClassificationTimeZone(),
  });

  // Parse the localized string back to a Date object
  return new Date(classificationTimeString);
}

/**
 * Check if two dates are on the same day (ignoring time)
 * Both dates should be in the same timezone context
 */
export function isToday(date: Date, referenceDate: Date): boolean {
  if (!date || !referenceDate) {
    return false;
  }

  return (
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth() &&
    date.getDate() === referenceDate.getDate()
  );
}

/**
 * Classify a message as "active" (today or future) or "archived" (past)
 * Uses configured instance timezone for date determination
 *
 * Classification logic:
 * 1. Try to use denormalized timespanEnd field at message root
 * 2. If found, check if it's today or in the future in Bulgarian time → "active", else "archived"
 * 3. Fallback: use createdAt, check if today → "active", else "archived"
 */
export function classifyMessage(message: Message): MessageClassification {
  const classificationTimeZone = getClassificationTimeZone();
  const today = getTodayBulgarianTime();

  // Try denormalized timespanEnd first
  if (message.timespanEnd) {
    const timespanEnd =
      typeof message.timespanEnd === "string"
        ? new Date(message.timespanEnd)
        : message.timespanEnd;

    const localizedTimespanEnd = new Date(
      timespanEnd.toLocaleString("en-US", {
        timeZone: classificationTimeZone,
      }),
    );

    // Check if the timespan ends today or in the future
    return isToday(localizedTimespanEnd, today) || localizedTimespanEnd > today
      ? "active"
      : "archived";
  }

  // Fallback to createdAt
  if (message.createdAt) {
    const createdDate =
      typeof message.createdAt === "string"
        ? new Date(message.createdAt)
        : message.createdAt;

    const localizedCreatedAt = new Date(
      createdDate.toLocaleString("en-US", {
        timeZone: classificationTimeZone,
      }),
    );

    return isToday(localizedCreatedAt, today) ? "active" : "archived";
  }

  // Default to archived if no date information available
  return "archived";
}
