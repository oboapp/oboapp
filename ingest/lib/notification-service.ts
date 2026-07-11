"use client";

import {
  getMessaging,
  getToken,
  onMessage,
  Messaging,
} from "firebase/messaging";
import { app } from "./firebase";
import { logger } from "@/lib/logger";
import { NotificationSubscription } from "./types";
import type { FirebaseNotificationPayload } from "./types";

let messaging: Messaging | null = null;

// Initialize messaging (only in browser)
if (globalThis.window !== undefined) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    logger.error("Failed to initialize Firebase Messaging", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in globalThis)) {
    logger.warn("This browser does not support notifications");
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

/**
 * Check if user has a valid subscription
 */
export async function hasValidSubscription(userId: string): Promise<boolean> {
  try {
    const response = await fetch("/api/notifications/subscription", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.hasSubscription === true;
  } catch (error) {
    logger.error("Error checking subscription", {
      error: error instanceof Error ? error.message : String(error),
    });
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
  if (!messaging) {
    logger.error("Firebase Messaging not initialized");
    return null;
  }

  try {
    // Get FCM token
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      logger.error("VAPID key not configured");
      return null;
    }

    const token = await getToken(messaging, { vapidKey });
    if (!token) {
      logger.warn("No registration token available");
      return null;
    }

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
    logger.error("Error subscribing to push notifications", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Setup foreground message listener
 */
export function setupForegroundMessageListener(
  onMessageReceived: (payload: FirebaseNotificationPayload) => void,
) {
  if (!messaging) {
    logger.error("Firebase Messaging not initialized");
    return () => {};
  }

  return onMessage(messaging, (payload) => {
    onMessageReceived(payload);

    // Show browser notification if permission granted
    if (Notification.permission === "granted" && payload.notification) {
      new Notification(payload.notification.title || "Ново съобщение", {
        body: payload.notification.body,
        icon: payload.notification.icon || "/icon-192x192.png",
        data: payload.data,
        tag: payload.data?.messageId || "default",
      });
    }
  });
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
    const hasSubscription = await hasValidSubscription(userId);
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
