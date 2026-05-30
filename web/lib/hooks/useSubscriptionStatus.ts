import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import * as Sentry from "@sentry/nextjs";
import { fetchWithAuth } from "@/lib/auth-fetch";

const reportedNonOkStatusCodes = new Set<number>();

class StaleStatusCheckError extends Error {
  constructor() {
    super("Stale subscription status check");
    this.name = "StaleStatusCheckError";
  }
}

function throwIfStale(isStaleRequest: () => boolean): void {
  if (isStaleRequest()) {
    throw new StaleStatusCheckError();
  }
}

function isStaleStatusCheckError(error: unknown): boolean {
  return error instanceof StaleStatusCheckError;
}

function captureStatusCheckWarning(
  error: unknown,
  reason: "non_ok_response" | "exception",
  details?: { statusCode?: number },
): void {
  if (reason === "non_ok_response" && details?.statusCode !== undefined) {
    if (reportedNonOkStatusCodes.has(details.statusCode)) {
      return;
    }
    reportedNonOkStatusCodes.add(details.statusCode);
  }

  const normalizedError =
    error instanceof Error
      ? error
      : new Error("Unknown error while checking notification subscription status");

  Sentry.captureException(normalizedError, {
    level: "warning",
    tags: {
      area: "notifications",
      hook: "useSubscriptionStatus",
      reason,
    },
    extra: {
      statusCode: details?.statusCode,
    },
  });
}

export interface SubscriptionStatus {
  isCurrentDeviceSubscribed: boolean;
  hasAnySubscriptions: boolean;
  isLoading: boolean;
  hasStatusCheckError: boolean;
  checkStatus: () => Promise<void>;
}

/**
 * Custom hook to check notification subscription status
 * Handles Firebase messaging setup, permission checks, and backend verification
 */
export function useSubscriptionStatus(user: User | null): SubscriptionStatus {
  const [isCurrentDeviceSubscribed, setIsCurrentDeviceSubscribed] =
    useState(true);
  const [hasAnySubscriptions, setHasAnySubscriptions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasStatusCheckError, setHasStatusCheckError] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const checkStatus = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!user) {
      setIsCurrentDeviceSubscribed(false);
      setHasAnySubscriptions(false);
      setHasStatusCheckError(false);
      setIsLoading(false);
      previousUserIdRef.current = null;
      return;
    }

    if (
      previousUserIdRef.current !== null &&
      previousUserIdRef.current !== user.uid
    ) {
      // Reset cached state on account switch so transient failures cannot keep
      // the previous account's last-known subscription status.
      setIsCurrentDeviceSubscribed(false);
      setHasAnySubscriptions(false);
      setHasStatusCheckError(false);
    }
    previousUserIdRef.current = user.uid;
    const activeUserId = user.uid;

    const isStaleRequest = (): boolean =>
      requestId !== requestIdRef.current || previousUserIdRef.current !== activeUserId;

    try {
      setIsLoading(true);
      setHasStatusCheckError(false);

      // Check if Firebase Messaging is supported
      const { isMessagingSupported } =
        await import("@/lib/notification-service");
      throwIfStale(isStaleRequest);
      const supported = await isMessagingSupported();
      throwIfStale(isStaleRequest);

      if (!supported) {
        setIsCurrentDeviceSubscribed(false);
        setHasAnySubscriptions(false);
        setIsLoading(false);
        return;
      }

      // Check notification permission
      const permission =
        "Notification" in globalThis ? Notification.permission : "denied";
      throwIfStale(isStaleRequest);

      if (permission !== "granted") {
        setIsCurrentDeviceSubscribed(false);
        setHasAnySubscriptions(false);
        setIsLoading(false);
        return;
      }

      // Get current device's FCM token
      const { getMessaging, getToken } = await import("firebase/messaging");
      const { app } = await import("@/lib/firebase");
      const messaging = getMessaging(app);
      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

      if (!vapidKey) {
        setIsCurrentDeviceSubscribed(false);
        setHasAnySubscriptions(false);
        setIsLoading(false);
        return;
      }

      const currentToken = await getToken(messaging, { vapidKey });
      throwIfStale(isStaleRequest);

      if (!currentToken) {
        setIsCurrentDeviceSubscribed(false);
        setHasAnySubscriptions(false);
        setIsLoading(false);
        return;
      }

      // Check if this token is in the backend
      const response = await fetchWithAuth(
        user,
        "/api/notifications/subscription/all",
      );
      throwIfStale(isStaleRequest);

      if (!response.ok) {
        setHasStatusCheckError(true);
        captureStatusCheckWarning(
          new Error(
            `Subscription status check failed with status ${response.status}`,
          ),
          "non_ok_response",
          { statusCode: response.status },
        );
        return;
      }

      const subscriptions = await response.json();
      throwIfStale(isStaleRequest);
      const hasCurrentDevice =
        Array.isArray(subscriptions) &&
        subscriptions.some((sub) => sub.token === currentToken);

      setIsCurrentDeviceSubscribed(hasCurrentDevice);
      setHasAnySubscriptions(
        Array.isArray(subscriptions) && subscriptions.length > 0,
      );
    } catch (err) {
      if (isStaleStatusCheckError(err) || isStaleRequest()) {
        return;
      }
      // Preserve the last known status to avoid false "not subscribed" messages
      // when there are transient auth/network/backend failures.
      setHasStatusCheckError(true);
      captureStatusCheckWarning(err, "exception");
    } finally {
      if (!isStaleRequest()) {
        setIsLoading(false);
      }
    }
  }, [user]);

  // Check status on mount and when user changes
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  return {
    isCurrentDeviceSubscribed,
    hasAnySubscriptions,
    isLoading,
    hasStatusCheckError,
    checkStatus,
  };
}
