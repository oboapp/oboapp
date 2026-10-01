#!/usr/bin/env node

import dotenv from "dotenv";
import { resolve } from "node:path";
import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";
import { Message, NotificationMatch } from "@/lib/types";
import {
  getString,
  getOptionalBoolean,
  isFeatureCollection,
} from "@/lib/record-fields";
import {
  getUnprocessedMessages,
  markMessagesAsNotified,
} from "./message-fetcher";
import { getAllInterests } from "./interest-fetcher";
import {
  matchMessagesWithInterests,
  deduplicateMatches,
  storeNotificationMatches,
  getUnnotifiedMatches,
} from "./match-processor";
import type { UserNotificationFilters } from "./match-processor";
import {
  sendToUserDevices,
  updateMatchWithResults,
  markMatchesAsNotified,
} from "./notification-sender";
import { logger } from "@/lib/logger";

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Send notifications for matches
 */
async function sendNotifications(
  db: OboDb,
  messaging: Messaging,
  matches: NotificationMatch[],
): Promise<void> {
  logger.info("Sending notifications");

  let successCount = 0;
  let errorCount = 0;

  const uniqueMatches = getUniqueMatches(matches);
  logger.info("Sending unique notifications", {
    unique: uniqueMatches.length,
    total: matches.length,
  });

  // Track which matches were processed to mark them all as notified
  const allMatchIds = matches
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  for (const match of uniqueMatches) {
    if (!match.id) {
      continue;
    }

    const messageData = await db.messages.findById(match.messageId);
    const message = buildNotificationMessage(match, messageData);
    if (!message) {
      continue;
    }

    // Send to all user devices
    const { successCount: deviceSuccessCount, notifications } =
      await sendToUserDevices(db, messaging, match.userId, message, match);

    if (deviceSuccessCount > 0) {
      successCount++;
      logger.info("Notification sent", {
        userId: match.userId.substring(0, 8),
        devicesSuccess: deviceSuccessCount,
        devicesTotal: notifications.length,
        messageId: match.messageId.substring(0, 8),
      });
    } else {
      errorCount++;
      logger.warn("Failed to send to any device", {
        userId: match.userId.substring(0, 8),
        messageId: match.messageId.substring(0, 8),
      });
    }

    if (messageData) {
      await updateMatchWithResults(db, match.id, messageData, notifications);
    }
  }

  // Mark all related matches as notified
  await markMatchesAsNotified(db, allMatchIds);

  logger.info("Notification sending complete", { successCount, errorCount });
}

function getUniqueMatches(matches: NotificationMatch[]): NotificationMatch[] {
  // Group matches by userId-messageId to send only one notification per user per message.
  const notificationMap = new Map<string, NotificationMatch>();

  for (const match of matches) {
    const key = `${match.userId}-${match.messageId}`;
    const existing = notificationMap.get(key);
    // Keep the match with the smallest distance.
    if (
      !existing ||
      (match.distance && (!existing.distance || match.distance < existing.distance))
    ) {
      notificationMap.set(key, match);
    }
  }

  return Array.from(notificationMap.values());
}

function buildNotificationMessage(
  match: NotificationMatch,
  messageData: Record<string, unknown> | null,
): Message | null {
  if (!messageData) {
    logger.warn("Message not found for notification", {
      messageId: match.messageId,
    });
    return null;
  }

  if (!messageData.locality) {
    logger.error("Message missing required locality field", {
      messageId: match.messageId,
    });
    return null;
  }

  // plainText is set by AI pipeline (Filter & Split stage).
  // For precomputed-GeoJSON crawlers, text is already plain.
  // summary (when present) is preferred to match what the detail view shows.
  // summary may contain markdown — stripMarkdown() is applied downstream in
  // buildNotificationPayload() before the text is used as notification body.
  return {
    id: match.messageId,
    text:
      getString(messageData.summary) ||
      getString(messageData.plainText) ||
      getString(messageData.text),
    aiProcessed: getOptionalBoolean(messageData.aiProcessed) === true,
    locality: getString(messageData.locality),
    geoJson: isFeatureCollection(messageData.geoJson)
      ? messageData.geoJson
      : undefined,
    createdAt: toISOString(messageData.createdAt),
  };
}

/**
 * Initialize database and Firebase services
 */
async function initServices(): Promise<{
  db: OboDb;
  messaging: Messaging;
}> {
  const { getDb } = await import("@/lib/db");
  const firebaseAdmin = await import("@/lib/firebase-admin");
  const { getMessaging } = await import("firebase-admin/messaging");

  return {
    db: await getDb(),
    messaging: getMessaging(firebaseAdmin.adminApp),
  };
}

/**
 * Main function
 */
export async function processNotificationWork(
  db: OboDb,
  messaging: Messaging,
): Promise<void> {
  // Process one bounded page of new messages, then drain a bounded page of
  // pending matches even when there are no new messages in this run.
  const unprocessedMessages = await getUnprocessedMessages(db);
  if (unprocessedMessages.length > 0) {
    const interests = await getAllInterests(db);
    const messageIds = unprocessedMessages
      .map((message) => message.id)
      .filter((id): id is string => !!id);

    if (interests.length > 0) {
      const uniqueUserIds = [...new Set(interests.map((interest) => interest.userId))];
      const userFiltersMap = new Map<string, UserNotificationFilters>();
      const allPrefs = await db.userPreferences.findByUserIds(uniqueUserIds);

      for (const prefs of allPrefs) {
        const userId = getString(prefs._id);
        const rawCats = prefs.notificationCategories;
        const cats = Array.isArray(rawCats)
          ? rawCats.filter((value): value is string => typeof value === "string")
          : [];
        const rawSrcs = prefs.notificationSources;
        const srcs = Array.isArray(rawSrcs)
          ? rawSrcs.filter((value): value is string => typeof value === "string")
          : [];
        const experimentalFeatures = prefs.experimentalFeatures === true;
        if (cats.length > 0 || srcs.length > 0 || experimentalFeatures) {
          userFiltersMap.set(userId, {
            notificationCategories: new Set(cats),
            notificationSources: new Set(srcs),
            experimentalFeatures,
          });
        }
      }

      const matches = await matchMessagesWithInterests(
        unprocessedMessages,
        interests,
        userFiltersMap,
      );
      if (matches.length > 0) {
        await storeNotificationMatches(db, deduplicateMatches(matches));
      } else {
        logger.info("No matches found");
      }
    } else {
      logger.info("No user interests configured");
    }

    // Matches are durable now. Mark source messages before sending so a
    // send failure cannot create a second set of matches on the next run.
    await markMessagesAsNotified(db, messageIds);
  } else {
    logger.info("No new messages to process");
  }

  const unnotifiedMatches = await getUnnotifiedMatches(db);
  if (unnotifiedMatches.length > 0) {
    await sendNotifications(db, messaging, unnotifiedMatches);
  } else {
    logger.info("No unnotified matches to send");
  }

  logger.info("Notification processing complete");
}

export async function main(): Promise<void> {
  logger.info("Starting notification matching and sending");
  const { db, messaging } = await initServices();
  await processNotificationWork(db, messaging);
}

// Run the script only when executed directly
if (require.main === module) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      logger.error("Fatal error in notification processing", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  })();
}
