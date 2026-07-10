import type { OboDb } from "@oboapp/db";
import type { Messaging } from "firebase-admin/messaging";
import {
  Message,
  NotificationMatch,
  NotificationSubscription,
  DeviceNotification,
} from "@/lib/types";
import {
  getUserSubscriptions,
  deleteSubscription,
} from "./subscription-manager";
import { getString, hasCode } from "@/lib/record-fields";
import { logger } from "@/lib/logger";

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

// App URL (use env var or fallback for tests)
const APP_URL_ENV = process.env.APP_URL;

if (!APP_URL_ENV && process.env.NODE_ENV === "production") {
  throw new Error("Environment variable APP_URL must be set in production.");
}

const APP_URL = APP_URL_ENV || "http://localhost:3000";

function stripMarkdownInlineLinks(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const openBracket = text.indexOf("[", cursor);
    if (openBracket === -1) {
      result += text.slice(cursor);
      break;
    }

    const mid = text.indexOf("](", openBracket + 1);
    if (mid === -1) {
      result += text.slice(cursor);
      break;
    }

    const closeParen = text.indexOf(")", mid + 2);
    if (closeParen === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, openBracket);
    result += text.slice(openBracket + 1, mid);
    cursor = closeParen + 1;
  }

  return result;
}

function stripMarkdownListMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let i = 0;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) {
        i++;
      }

      const marker = line[i];
      if ((marker === "-" || marker === "*") && line[i + 1] === " ") {
        return line.slice(i + 2);
      }

      let j = i;
      while (j < line.length && line[j] >= "0" && line[j] <= "9") {
        j++;
      }

      if (j > i && line[j] === "." && line[j + 1] === " ") {
        return line.slice(j + 2);
      }

      return line;
    })
    .join("\n");
}

/**
 * Strip markdown formatting from text for use in plain-text notifications.
 * Handles bold, italic, headings, links, and list markers.
 */
function stripMarkdown(text: string): string {
  return (
    stripMarkdownListMarkers(stripMarkdownInlineLinks(text))
      // Bold: **text** or __text__
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      // Italic: *text* or _text_ (but not inside words)
      .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1")
      .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
      // Headings: # text
      .replace(/^#{1,6}\s+/gm, "")
  );
}

/**
 * Build notification payload for FCM
 */
export function buildNotificationPayload(
  message: Message,
  match: NotificationMatch,
) {
  const cleanText = stripMarkdown(message.text);
  const messagePreview =
    cleanText.length > 100 ? cleanText.substring(0, 100) + "..." : cleanText;

  const distanceText = match.distance
    ? ` (${Math.round(match.distance)}m от вашия район)`
    : "";

  // Use match ID in the notification URL for server-side click tracking.
  // The /n/[id] page records clickedAt then redirects to the message.
  // Fall back to the direct message URL if match.id is not set (should not
  // happen after notify, but guards against edge cases in tests/backfill).
  const messageUrl = match.id
    ? `${APP_URL}/n/${encodeURIComponent(match.id)}`
    : `${APP_URL}/m/${encodeURIComponent(match.messageId)}`;
  const sourceId = typeof message.source === "string" ? message.source : "";
  const senderIcon =
    sourceId.length > 0
      ? `${APP_URL}/sources/${encodeURIComponent(sourceId)}.png`
      : `${APP_URL}/icon-192x192.png`;

  return {
    data: {
      title: "Ново съобщение в OboApp",
      body: `${messagePreview}${distanceText}`,
      icon: `${APP_URL}/icon-192x192.png`,
      senderIcon,
      badge: `${APP_URL}/icon-72x72.png`,
      messageId: match.messageId,
      interestId: match.interestId,
      matchId: match.id || "",
      url: messageUrl,
    },
    webpush: {
      fcmOptions: {
        link: messageUrl,
      },
    },
  };
}

/**
 * Send push notification to a single device
 */
export async function sendPushNotification(
  db: OboDb,
  messaging: Messaging,
  subscription: NotificationSubscription,
  message: Message,
  match: NotificationMatch,
): Promise<{ success: boolean; error?: string; tokenInvalid?: boolean }> {
  try {
    const payload = buildNotificationPayload(message, match);

    await messaging.send({
      token: subscription.token,
      ...payload,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = hasCode(error) ? String(error.code) : undefined;

    // Check if the FCM token is invalid/expired
    const isInvalidToken =
      errorCode === "messaging/registration-token-not-registered" ||
      errorCode === "messaging/invalid-registration-token";

    if (isInvalidToken && subscription.id) {
      // Token is stale — log as warning (handled gracefully) and remove it
      logger.warn("Stale FCM token detected, removing subscription", {
        errorCode,
        subscriptionId: subscription.id.substring(0, 8),
      });
      await deleteSubscription(db, subscription.id);
    } else {
      // Genuine send failure — log as error
      logger.error("Failed to send notification", {
        error: errorMessage,
        errorCode,
      });
    }

    return {
      success: false,
      error: errorMessage,
      tokenInvalid: isInvalidToken,
    };
  }
}

/**
 * Send notification to all user devices
 */
export async function sendToUserDevices(
  db: OboDb,
  messaging: Messaging,
  userId: string,
  message: Message,
  match: NotificationMatch,
): Promise<{ successCount: number; notifications: DeviceNotification[] }> {
  const subscriptions = await getUserSubscriptions(db, userId);

  if (subscriptions.length === 0) {
    logger.info("No subscriptions for user", {
      userId: userId.substring(0, 8),
    });
    return { successCount: 0, notifications: [] };
  }

  const deviceNotifications: DeviceNotification[] = [];
  let successCount = 0;

  for (const subscription of subscriptions) {
    const result = await sendPushNotification(
      db,
      messaging,
      subscription,
      message,
      match,
    );

    const deviceNotification: DeviceNotification = {
      subscriptionId: subscription.id || "",
      deviceInfo: subscription.deviceInfo,
      sentAt: new Date().toISOString(),
      success: result.success,
    };

    // Only include error field if there was an error (avoid undefined)
    if (result.error) {
      deviceNotification.error = result.error;
    }

    deviceNotifications.push(deviceNotification);

    if (result.success) {
      successCount++;
    }
  }

  return { successCount, notifications: deviceNotifications };
}

/**
 * Update match document with notification results
 */
export async function updateMatchWithResults(
  db: OboDb,
  matchId: string,
  messageData: Record<string, unknown>,
  deviceNotifications: DeviceNotification[],
): Promise<void> {
  const messageSnapshot: Record<string, string> = {
    text: getString(messageData?.text),
    createdAt: toISOString(messageData?.createdAt),
  };

  // Only add optional fields if they exist (avoid undefined in Firestore)
  if (messageData?.source && typeof messageData.source === "string") {
    messageSnapshot.source = messageData.source;
  }
  if (messageData?.sourceUrl && typeof messageData.sourceUrl === "string") {
    messageSnapshot.sourceUrl = messageData.sourceUrl;
  }

  await db.notificationMatches.updateOne(matchId, {
    deviceNotifications,
    messageSnapshot,
  });
}

/**
 * Mark matches as notified
 */
export async function markMatchesAsNotified(
  db: OboDb,
  matchIds: string[],
): Promise<void> {
  logger.info("Marking matches as notified", { count: matchIds.length });

  const now = new Date();

  for (const matchId of matchIds) {
    await db.notificationMatches.updateOne(matchId, {
      notified: true,
      notifiedAt: now,
    });
  }
}
