"use client";

import {
  getMessaging,
  getToken,
  Messaging,
  isSupported,
  deleteToken,
} from "firebase/messaging";
import type { User } from "firebase/auth";
import { app } from "./firebase";
import { NotificationSubscription } from "./types";

let messaging: Messaging | null = null;
let messagingSupported: boolean | null = null;

function hasCompleteMessagingConfig(): boolean {
  const missing = [
    ["NEXT_PUBLIC_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_FIREBASE_API_KEY],
    [
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    ],
    [
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ],
    [
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    ],
    [
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    ],
    ["NEXT_PUBLIC_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_FIREBASE_APP_ID],
    [
      "NEXT_PUBLIC_FIREBASE_VAPID_KEY",
      process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    ],
  ]
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.warn(
      `[Notifications] Messaging config missing (${missing.join(", ")}). Notification subscription is disabled.`,
    );
    return false;
  }

  return true;
}

// Initialize messaging (only in browser)
if (globalThis.window !== undefined) {
  isSupported()
    .then((supported) => {
      messagingSupported = supported;
      if (supported) {
        try {
          messaging = getMessaging(app);
        } catch (error) {
          console.error("Failed to initialize Firebase Messaging:", error);
        }
      } else {
        console.warn("Firebase Messaging is not supported in this browser");
      }
    })
    .catch((error) => {
      console.error("Error checking Firebase Messaging support:", error);
      messagingSupported = false;
    });
}

/**
 * Check if Firebase Messaging is supported in this browser
 */
export async function isMessagingSupported(): Promise<boolean> {
  // If we already checked, return cached result
  if (messagingSupported !== null) {
    return messagingSupported;
  }

  // Check if we're in a browser environment
  if (typeof globalThis.window === "undefined") {
    return false;
  }

  try {
    messagingSupported = await isSupported();
    return messagingSupported;
  } catch (error) {
    console.error("Error checking messaging support:", error);
    messagingSupported = false;
    return false;
  }
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in globalThis)) {
    console.warn("This browser does not support notifications");
    return false;
  }

  // Check if permission is already granted
  if (Notification.permission === "granted") {
    return true;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * Get the current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (!("Notification" in globalThis)) {
    return "denied";
  }
  return Notification.permission;
}

const NOTIFICATIONS_UNSUPPORTED_MESSAGE =
  "За съжаление, този браузър не поддържа известия.\n\n" +
  "На iOS Safari е необходимо да добавите приложението към началния екран " +
  "преди да можете да получавате известия.";

const NOTIFICATIONS_BLOCKED_MESSAGE =
  "Известията са блокирани в браузъра. За да ги разрешите:\n\n" +
  "1. Кликнете на иконката на катинара/информацията до адресната лента\n" +
  "2. Намерете настройките за известия\n" +
  "3. Разрешете известията за този сайт\n" +
  "4. Презаредете страницата";

const NOTIFICATIONS_PERMISSION_REQUIRED_MESSAGE =
  "Моля, разрешете известия в браузъра";

const NOTIFICATIONS_SUBSCRIBE_FAILED_MESSAGE = "Грешка при абонирането";

type EnableNotificationsFailureReason =
  | "unsupported"
  | "blocked"
  | "permission-denied"
  | "subscription-failed";

export type EnableCurrentDeviceNotificationsResult =
  | {
      ok: true;
      subscription: NotificationSubscription;
    }
  | {
      ok: false;
      reason: EnableNotificationsFailureReason;
    };

export function getEnableNotificationsMessage(
  reason: EnableNotificationsFailureReason,
): string {
  switch (reason) {
    case "unsupported":
      return NOTIFICATIONS_UNSUPPORTED_MESSAGE;
    case "blocked":
      return NOTIFICATIONS_BLOCKED_MESSAGE;
    case "permission-denied":
      return NOTIFICATIONS_PERMISSION_REQUIRED_MESSAGE;
    case "subscription-failed":
      return NOTIFICATIONS_SUBSCRIBE_FAILED_MESSAGE;
  }
}

export async function subscribeCurrentDeviceForUser(
  user: User,
): Promise<EnableCurrentDeviceNotificationsResult> {
  const supported = await isMessagingSupported();
  if (!supported) {
    return { ok: false, reason: "unsupported" };
  }

  const currentPermission = getNotificationPermission();
  if (currentPermission === "denied") {
    return { ok: false, reason: "blocked" };
  }

  const granted = await requestNotificationPermission();
  if (!granted) {
    return { ok: false, reason: "permission-denied" };
  }

  const token = await user.getIdToken();
  const subscription = await subscribeToPushNotifications(user.uid, token);

  if (!subscription) {
    return { ok: false, reason: "subscription-failed" };
  }

  return { ok: true, subscription };
}

/** * Track that user explicitly unsubscribed (to prevent auto-resubscription)
 */
function markExplicitUnsubscribe(userId: string): void {
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.setItem(
      `notif_unsubscribed_${userId}`,
      Date.now().toString(),
    );
  }
}

/**
 * Check if user explicitly unsubscribed recently (within 30 days)
 */
function hasExplicitlyUnsubscribed(userId: string): boolean {
  if (typeof globalThis.localStorage === "undefined") {
    return false;
  }

  const unsubscribedAt = globalThis.localStorage.getItem(
    `notif_unsubscribed_${userId}`,
  );
  if (!unsubscribedAt) {
    return false;
  }

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - Number.parseInt(unsubscribedAt, 10);
  return elapsed < thirtyDaysMs;
}

/**
 * Clear explicit unsubscribe flag (when user manually subscribes again)
 */
function clearExplicitUnsubscribe(userId: string): void {
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.removeItem(`notif_unsubscribed_${userId}`);
  }
}

/**
 * Export markExplicitUnsubscribe for use in settings page
 */
export { markExplicitUnsubscribe };

/**
 * Check if user has a valid subscription
 */
export async function hasValidSubscription(
  userId: string,
  idToken: string,
): Promise<boolean> {
  try {
    const response = await fetch("/api/notifications/subscription", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.hasSubscription === true;
  } catch (error) {
    console.error("Error checking subscription:", error);
    // If offline, assume we don't have a valid subscription
    if (!navigator.onLine) {
      console.warn("Cannot check subscription while offline");
    }
    return false;
  }
}

/**
 * Subscribe to push notifications and save the subscription
 */
export async function subscribeToPushNotifications(
  userId: string,
  idToken: string,
): Promise<NotificationSubscription | null> {
  if (!hasCompleteMessagingConfig()) {
    return null;
  }

  // Check if messaging is supported
  const supported = await isMessagingSupported();
  if (!supported) {
    console.error("Firebase Messaging is not supported on this platform");
    return null;
  }

  if (!messaging) {
    console.error("Firebase Messaging not initialized");
    return null;
  }

  try {
    // Get FCM token
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.error("VAPID key not configured");
      return null;
    }

    const token = await getToken(messaging, { vapidKey });
    if (!token) {
      console.warn("No registration token available");
      return null;
    }

    // Clear explicit unsubscribe flag since user is subscribing
    clearExplicitUnsubscribe(userId);

    // Save subscription to backend
    const response = await fetch("/api/notifications/subscription", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        token,
        endpoint: `https://fcm.googleapis.com/fcm/send/${token}`,
        deviceInfo: {
          userAgent: navigator.userAgent,
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to save subscription");
    }

    const subscription = await response.json();
    return subscription;
  } catch (error) {
    console.error("Error subscribing to push notifications:", error);
    // Check if offline
    if (!navigator.onLine) {
      console.error("Cannot subscribe to notifications while offline");
    }
    return null;
  }
}

/**
 * Remove subscription from backend
 * Separated for better testability and error handling
 * Exported for testing purposes
 */
export async function removeSubscriptionFromBackend(
  token: string,
  idToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/notifications/subscription?token=${encodeURIComponent(token)}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      },
    );

    if (!response.ok) {
      console.error("Failed to remove subscription from backend");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error removing subscription from backend:", error);
    return false;
  }
}

/**
 * Unsubscribe from push notifications on sign out
 * Removes the FCM token from backend and deletes it from Firebase
 */
export async function unsubscribeOnSignOut(
  userId: string,
  idToken: string,
): Promise<void> {
  // Check if messaging is supported
  const supported = await isMessagingSupported();
  if (!supported) {
    console.warn("Firebase Messaging is not supported on this platform");
    return;
  }

  if (!messaging) {
    console.warn("Firebase Messaging not initialized");
    return;
  }

  // Get VAPID key
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.error("VAPID key not configured");
    return;
  }

  // If permission isn't granted, skip token cleanup to avoid prompting
  const permission = getNotificationPermission();
  if (permission !== "granted") {
    console.warn(
      "Skipping notification unsubscribe on sign out: permission not granted",
    );
    return;
  }

  try {
    // Get the current FCM token
    const token = await getToken(messaging, { vapidKey });
    if (!token) {
      console.warn("No registration token available to delete");
      return;
    }

    // Remove token from backend (non-blocking - best effort)
    await removeSubscriptionFromBackend(token, idToken);

    // Delete the FCM token from Firebase to invalidate it
    await deleteToken(messaging);
    console.log("FCM token deleted successfully");

    // Mark as explicitly unsubscribed
    markExplicitUnsubscribe(userId);
  } catch (error) {
    console.error("Error unsubscribing on sign out:", error);
  }
}

/**
 * Check and request notification permission when user has circles
 */
export async function ensureNotificationPermission(
  userId: string,
  idToken: string,
  hasCircles: boolean,
  showPrompt?: (onAccept: () => void, onDecline: () => void) => void,
): Promise<void> {
  // Only proceed if user has circles
  if (!hasCircles) {
    return;
  }

  // Check current permission status
  const currentPermission = getNotificationPermission();

  // If permission denied, don't ask again
  if (currentPermission === "denied") {
    return;
  }

  // If permission already granted, ensure subscription is valid
  if (currentPermission === "granted") {
    // Don't auto-resubscribe if user explicitly unsubscribed
    if (hasExplicitlyUnsubscribed(userId)) {
      return;
    }

    const hasSubscription = await hasValidSubscription(userId, idToken);
    if (!hasSubscription) {
      await subscribeToPushNotifications(userId, idToken);
    }
    return;
  }

  // Permission is "default" - show custom prompt first
  if (showPrompt) {
    // Custom prompt will be shown, callback will handle the request
    showPrompt(
      async () => {
        const granted = await requestNotificationPermission();
        if (granted) {
          await subscribeToPushNotifications(userId, idToken);
        }
      },
      () => {
        // User declined
      },
    );
  } else {
    // Fallback: request permission directly
    const granted = await requestNotificationPermission();

    if (granted) {
      await subscribeToPushNotifications(userId, idToken);
    }
  }
}
