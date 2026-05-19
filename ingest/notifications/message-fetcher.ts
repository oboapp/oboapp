import type { OboDb } from "@oboapp/db";
import type { Category } from "@oboapp/shared";
import { CATEGORIES } from "@oboapp/shared";
import { Message } from "@/lib/types";
import { logger } from "@/lib/logger";
import {
  getString,
  getOptionalString,
  getOptionalBoolean,
  isFeatureCollection,
} from "@/lib/record-fields";

const categorySet: ReadonlySet<string> = new Set(CATEGORIES);

function isCategory(v: unknown): v is Category {
  return typeof v === "string" && categorySet.has(v);
}

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

/**
 * Converts a value that may be a Date, ISO string, or undefined into an ISO
 * string. Returns undefined for null / missing values so optional fields are
 * not coerced to the current time (contrast with `toISOString`).
 */
function toOptionalISOString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/**
 * Returns true when a message should be skipped because its event has already ended.
 * Accepts an ISO string, a Date, or undefined — we err on the side of notifying
 * (return false) for missing or unparseable values rather than silently dropping.
 */
export function isMessageStale(
  timespanEnd: string | Date | undefined,
  now: Date,
): boolean {
  if (!timespanEnd) return false;
  const end = timespanEnd instanceof Date ? timespanEnd : new Date(timespanEnd);
  if (Number.isNaN(end.getTime())) return false;
  return end < now;
}

/**
 * Get all unprocessed messages whose event has not yet ended.
 * Messages must have notificationsSent set and not equal to true.
 * Messages whose timespanEnd is in the past are excluded to prevent
 * stale-event notifications.
 */
export async function getUnprocessedMessages(db: OboDb): Promise<Message[]> {
  logger.info("Fetching unprocessed messages");

  const docs = await db.messages.findMany({
    where: [{ field: "notificationsSent", op: "!=", value: true }],
    orderBy: [{ field: "createdAt", direction: "asc" }],
  });

  const now = new Date();

  const unprocessedMessages: Message[] = docs
    .map((data) => ({
      id: getString(data._id),
      text: getString(data.text),
      locality: getString(data.locality),
      geoJson: isFeatureCollection(data.geoJson) ? data.geoJson : undefined,
      createdAt: toISOString(data.createdAt),
      cityWide: getOptionalBoolean(data.cityWide),
      source: getOptionalString(data.source),
      categories: Array.isArray(data.categories)
        ? data.categories.filter(isCategory)
        : undefined,
      timespanEnd: toOptionalISOString(data.timespanEnd),
    }))
    .filter((message) => {
      if (!isMessageStale(message.timespanEnd, now)) return true;
      logger.info("Skipping stale message (timespanEnd in the past)", {
        messageId: message.id,
        timespanEnd: message.timespanEnd,
      });
      return false;
    });

  logger.info("Found unprocessed messages", {
    count: unprocessedMessages.length,
  });

  return unprocessedMessages;
}

/**
 * Mark messages as having notifications sent
 */
export async function markMessagesAsNotified(
  db: OboDb,
  messageIds: string[],
): Promise<void> {
  logger.info("Marking messages as notified", { count: messageIds.length });

  const now = new Date();

  for (const messageId of messageIds) {
    await db.messages.updateOne(messageId, {
      notificationsSent: true,
      notificationsSentAt: now,
    });
  }

  logger.info("Marked messages as notified", { count: messageIds.length });
}
