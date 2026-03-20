import type { OboDb } from "@oboapp/db";
import type { Message, Interest, NotificationMatch } from "@/lib/types";
import { matchMessageToInterest } from "./geo-matcher";
import { logger } from "@/lib/logger";
import { UNCATEGORIZED } from "@oboapp/shared";
import {
  getString,
  getBoolean,
  getOptionalNumber,
} from "@/lib/record-fields";

export interface MatchResult {
  messageId: string;
  userId: string;
  interestId: string;
  distance: number;
}

/** User notification filter preferences (loaded from userPreferences collection) */
export interface UserNotificationFilters {
  /** Categories to include (empty = allow all). May contain "uncategorized". */
  notificationCategories: Set<string>;
  /** Sources to include (empty = allow all) */
  notificationSources: Set<string>;
}

/**
 * Determine whether a message passes a user's notification filters.
 *
 * Rules:
 * - Empty filter array for a dimension = no restriction (allow all)
 * - Non-empty categories: message must have at least one matching category,
 *   OR "uncategorized" is selected and message has no categories
 * - Non-empty sources: message source must be in the set
 * - Both dimensions must pass (AND logic)
 */
export function shouldNotifyUser(
  filters: UserNotificationFilters | undefined,
  message: Pick<Message, "categories" | "source">,
): boolean {
  // No preferences doc → no filtering → allow all
  if (!filters) return true;

  const { notificationCategories, notificationSources } = filters;

  // Check category filter
  if (notificationCategories.size > 0) {
    const messageCategories = message.categories ?? [];

    if (messageCategories.length === 0) {
      // Message has no categories → only passes if "uncategorized" is selected
      if (!notificationCategories.has(UNCATEGORIZED)) {
        return false;
      }
    } else {
      // Message has categories → at least one must be in the filter set
      const hasMatch = messageCategories.some((cat) =>
        notificationCategories.has(cat),
      );
      if (!hasMatch) return false;
    }
  }

  // Check source filter
  if (notificationSources.size > 0) {
    if (!message.source || !notificationSources.has(message.source)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a message passes a user's notification filters.
 * Returns true if user has no filters or if the message passes them.
 */
function passesUserFilters(
  filtersMap: Map<string, UserNotificationFilters> | undefined,
  userId: string,
  message: Pick<Message, "categories" | "source">,
): boolean {
  if (!filtersMap) return true;
  return shouldNotifyUser(filtersMap.get(userId), message);
}

/**
 * Check if a message-interest pair should produce a match.
 * Returns a MatchResult if the pair passes all checks, or null otherwise.
 */
function tryMatchPair(
  message: Message,
  interest: Interest,
  userFiltersMap?: Map<string, UserNotificationFilters>,
): MatchResult | null {
  if (!interest.id) return null;

  // Only match if the message was created after the interest was created
  if (message.createdAt < interest.createdAt) return null;

  const { matches: isMatch, distance } = matchMessageToInterest(
    message,
    interest,
  );

  if (!isMatch || distance === null) return null;

  // Check user's notification filters before recording the match
  if (!passesUserFilters(userFiltersMap, interest.userId, message)) {
    return null;
  }

  return {
    messageId: message.id!,
    userId: interest.userId,
    interestId: interest.id,
    distance,
  };
}

/**
 * Match unprocessed messages with user interests.
 *
 * When userFiltersMap is provided, messages that don't pass a user's
 * notification filters are skipped (no match record created).
 */
export async function matchMessagesWithInterests(
  messages: Message[],
  interests: Interest[],
  userFiltersMap?: Map<string, UserNotificationFilters>,
): Promise<MatchResult[]> {
  logger.info("Matching messages with interests");

  const matches: MatchResult[] = [];

  for (const message of messages) {
    if (!message.id || !message.geoJson) {
      continue;
    }

    for (const interest of interests) {
      const match = tryMatchPair(message, interest, userFiltersMap);
      if (match) {
        matches.push(match);
        logger.info("Match found", {
          messageId: match.messageId.substring(0, 8),
          userId: match.userId.substring(0, 8),
          interestId: match.interestId.substring(0, 8),
          distanceMeters: Math.round(match.distance),
        });
      }
    }
  }

  logger.info("Total matches found", { count: matches.length });

  return matches;
}

/**
 * Deduplicate matches - one notification per user per message
 */
export function deduplicateMatches(matches: MatchResult[]): MatchResult[] {
  logger.info("Deduplicating matches");

  const dedupedMap = new Map<string, MatchResult>();

  for (const match of matches) {
    const key = `${match.userId}-${match.messageId}`;
    const existing = dedupedMap.get(key);

    // Keep the match with the smallest distance
    if (!existing || match.distance < existing.distance) {
      dedupedMap.set(key, match);
    }
  }

  const deduped = Array.from(dedupedMap.values());
  logger.info("Deduplication complete", {
    remaining: deduped.length,
    removed: matches.length - deduped.length,
  });

  return deduped;
}

/**
 * Store notification matches in Firestore
 */
export async function storeNotificationMatches(
  db: OboDb,
  matches: MatchResult[],
): Promise<void> {
  logger.info("Storing notification matches");

  const now = new Date();

  for (const match of matches) {
    await db.notificationMatches.insertOne({
      userId: match.userId,
      messageId: match.messageId,
      interestId: match.interestId,
      distance: match.distance,
      matchedAt: now,
      notified: false,
    });
  }

  logger.info("Stored notification matches", { count: matches.length });
}

/**
 * Get unnotified matches
 */
export async function getUnnotifiedMatches(
  db: OboDb,
): Promise<NotificationMatch[]> {
  logger.info("Fetching unnotified matches");

  const docs = await db.notificationMatches.findUnnotified();

  const matches: NotificationMatch[] = docs.map((data) => {
    const toStr = (v: unknown): string =>
      v instanceof Date
        ? v.toISOString()
        : typeof v === "string"
          ? v
          : new Date().toISOString();

    return {
      id: getString(data._id),
      userId: getString(data.userId),
      messageId: getString(data.messageId),
      interestId: getString(data.interestId),
      matchedAt: toStr(data.matchedAt),
      notified: getBoolean(data.notified),
      notifiedAt: data.notifiedAt ? toStr(data.notifiedAt) : undefined,
      distance: getOptionalNumber(data.distance),
    };
  });

  logger.info("Found unnotified matches", { count: matches.length });

  return matches;
}
