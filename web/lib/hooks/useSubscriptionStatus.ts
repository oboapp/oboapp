import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import * as Sentry from "@sentry/nextjs";
import { fetchWithAuth } from "@/lib/auth-fetch";

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

async function resolveCurrentDeviceToken(
  isStaleRequest: () => boolean,
): Promise<string | null> {
  const { isMessagingSupported } =
    await import("@/lib/notification-service");
  throwIfStale(isStaleRequest);

  const supported = await isMessagingSupported();
  throwIfStale(isStaleRequest);
  if (!supported) {
    return null;
  }

  const permission =
    "Notification" in globalThis ? Notification.permission : "denied";
  throwIfStale(isStaleRequest);
  if (permission !== "granted") {
    return null;
  }

  const { getMessaging, getToken } = await import("firebase/messaging");
  const { app } = await import("@/lib/firebase");
  const messaging = getMessaging(app);
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    return null;
  }

  throwIfStale(isStaleRequest);
  const currentToken = await getToken(messaging, { vapidKey });
  throwIfStale(isStaleRequest);
  if (!currentToken) {
    return null;
  }

  return currentToken;
}

function captureStatusCheckWarning(
  error: unknown,
  reason: "non_ok_response" | "exception",
  reportedNonOkStatusCodes: Set<number>,
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
  const reportedNonOkStatusCodesRef = useRef(new Set<number>());
  const hasKnownStatusRef = useRef(false);

  const checkStatus = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!user) {
      setIsCurrentDeviceSubscribed(false);
      setHasAnySubscriptions(false);
      setHasStatusCheckError(false);
      setIsLoading(false);
      previousUserIdRef.current = null;
      reportedNonOkStatusCodesRef.current.clear();
      hasKnownStatusRef.current = false;
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
      reportedNonOkStatusCodesRef.current.clear();
      hasKnownStatusRef.current = false;
    }
    previousUserIdRef.current = user.uid;
    const activeUserId = user.uid;

    const isStaleRequest = (): boolean =>
      requestId !== requestIdRef.current || previousUserIdRef.current !== activeUserId;

    try {
      setIsLoading(true);
      setHasStatusCheckError(false);

      const currentToken = await resolveCurrentDeviceToken(isStaleRequest);
      if (!currentToken) {
        setIsCurrentDeviceSubscribed(false);
        setHasAnySubscriptions(false);
        hasKnownStatusRef.current = true;
        return;
      }

      // Check if this token is in the backend
      throwIfStale(isStaleRequest);
      const response = await fetchWithAuth(
        user,
        "/api/notifications/subscription/all",
      );
      throwIfStale(isStaleRequest);

      if (!response.ok) {
        throwIfStale(isStaleRequest);
        if (!hasKnownStatusRef.current) {
          setIsCurrentDeviceSubscribed(false);
          setHasAnySubscriptions(false);
        }
        setHasStatusCheckError(true);
        captureStatusCheckWarning(
          new Error(
            `Subscription status check failed with status ${response.status}`,
          ),
          "non_ok_response",
          reportedNonOkStatusCodesRef.current,
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
      hasKnownStatusRef.current = true;
    } catch (err) {
      if (isStaleStatusCheckError(err) || isStaleRequest()) {
        return;
      }
      // Preserve the last known status to avoid false "not subscribed" messages
      // when there are transient auth/network/backend failures.
      if (!hasKnownStatusRef.current) {
        setIsCurrentDeviceSubscribed(false);
        setHasAnySubscriptions(false);
      }
      setHasStatusCheckError(true);
      captureStatusCheckWarning(
        err,
        "exception",
        reportedNonOkStatusCodesRef.current,
      );
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
