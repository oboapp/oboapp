"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { NotificationSubscription } from "@/lib/types";
import {
  subscribeCurrentDeviceForUser,
  getEnableNotificationsMessage,
  markExplicitUnsubscribe,
} from "@/lib/notification-service";
import { getMessaging, getToken } from "firebase/messaging";
import { app } from "@/lib/firebase";
import NotificationsSection from "./NotificationsSection";
import DeleteAccountSection from "./DeleteAccountSection";
import DeleteSuccessMessage from "./DeleteSuccessMessage";
import LoadingState from "./LoadingState";
import SettingsHeader from "./SettingsHeader";
import ErrorBanner from "./ErrorBanner";
import ApiAccessSection from "./ApiAccessSection";
import type { ApiClient } from "@/lib/types";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { borderRadius } from "@/lib/colors";
import { fetchWithAuth } from "@/lib/auth-fetch";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { LandingViewSection } from "./LandingViewSection";

export default function SettingsPage() {
  const {
    user,
    loading: authLoading,
    guestAuthUnavailable,
    signOut,
    reauthenticateWithGoogle,
    signInWithGoogle,
  } = useAuth();
  const router = useRouter();
  const isGuestUser = user?.isAnonymous ?? false;

  const [subscriptions, setSubscriptions] = useState<
    NotificationSubscription[]
  >([]);
  const [currentDeviceToken, setCurrentDeviceToken] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // API client state
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isApiClientLoading, setIsApiClientLoading] = useState(false);

  // Delete account state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [showUnsubscribeAllConfirm, setShowUnsubscribeAllConfirm] =
    useState(false);
  const [isUnsubscribingAll, setIsUnsubscribingAll] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const subscriptionsRes = await fetchWithAuth(
        user,
        "/api/notifications/subscription/all",
      );

      let apiClientRes: Response | null = null;
      if (!isGuestUser) {
        apiClientRes = await fetchWithAuth(user, "/api/api-clients");
      }

      if (!subscriptionsRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const subscriptionsData = await subscriptionsRes.json();
      const apiClientData =
        apiClientRes?.ok ? await apiClientRes.json() : null;

      setSubscriptions(
        Array.isArray(subscriptionsData) ? subscriptionsData : [],
      );
      setApiClient(isGuestUser ? null : (apiClientData ?? null));
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Неуспешно зареждане на данни");
      // Ensure arrays are set even on error
      setSubscriptions([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, isGuestUser]);

  // Fetch data
  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setIsLoading(false);
      return;
    }

    void fetchData();
  }, [authLoading, user, router, fetchData]);

  // Get current device FCM token
  useEffect(() => {
    const getCurrentToken = async () => {
      try {
        // Check if Firebase Messaging is supported
        const { isMessagingSupported } =
          await import("@/lib/notification-service");
        const supported = await isMessagingSupported();

        if (!supported) {
          console.warn(
            "Firebase Messaging is not supported on this browser/platform",
          );
          return;
        }

        const messaging = getMessaging(app);
        const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
        if (!vapidKey) {
          return;
        }

        const token = await getToken(messaging, { vapidKey });
        if (token) {
          setCurrentDeviceToken(token);
        }
      } catch (error) {
        console.error("Error getting current device token:", error);
      }
    };

    if (globalThis.window !== undefined) {
      void getCurrentToken();
    }
  }, []);

  const handleSubscribeCurrentDevice = async () => {
    if (!user) {
      return;
    }

    try {
      const result = await subscribeCurrentDeviceForUser(user);
      if (!result.ok) {
        toast.error(getEnableNotificationsMessage(result.reason));
        if (user.isAnonymous) {
          trackEvent({
            name: "guest_push_failed",
            params: { source: "settings" },
          });
        }
        return;
      }

      if (user.isAnonymous) {
        trackEvent({
          name: "guest_push_enabled",
          params: { source: "settings" },
        });
      }
      await fetchData(); // Refresh subscriptions
    } catch (error) {
      console.error("Error subscribing:", error);
      if (user.isAnonymous) {
        trackEvent({
          name: "guest_push_failed",
          params: { source: "settings" },
        });
      }
      toast.error("Грешка при абонирането");
    }
  };

  const handleUnsubscribeDevice = async (deviceToken: string) => {
    if (!user) {
      return;
    }

    try {
      const response = await fetchWithAuth(
        user,
        `/api/notifications/subscription?token=${encodeURIComponent(
          deviceToken,
        )}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to unsubscribe");
      }

      // Mark that user explicitly unsubscribed
      markExplicitUnsubscribe(user.uid);

      await fetchData(); // Refresh subscriptions
    } catch (error) {
      console.error("Error unsubscribing:", error);
      toast.error("Грешка при отписването");
    }
  };

  const handleUnsubscribeAll = () => {
    setShowUnsubscribeAllConfirm(true);
  };

  const handleConfirmUnsubscribeAll = async () => {
    if (!user) {
      setShowUnsubscribeAllConfirm(false);
      setIsUnsubscribingAll(false);
      return;
    }
    setIsUnsubscribingAll(true);

    try {
      const response = await fetchWithAuth(
        user,
        "/api/notifications/subscription/all",
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to unsubscribe all");
      }

      // Mark that user explicitly unsubscribed
      markExplicitUnsubscribe(user.uid);

      await fetchData(); // Refresh subscriptions
    } catch (error) {
      console.error("Error unsubscribing all:", error);
      toast.error("Грешка при отписването от всички устройства");
    } finally {
      setIsUnsubscribingAll(false);
      setShowUnsubscribeAllConfirm(false);
    }
  };

  const handleDeleteAccount = async (confirmText: string) => {
    if (confirmText !== "ИЗТРИЙ") {
      toast.error("Напиши 'ИЗТРИЙ' за потвърждение");
      return;
    }

    setIsDeleting(true);

    try {
      // Step 1: Re-authenticate user for security
      try {
        await reauthenticateWithGoogle();
      } catch (reauthError) {
        console.error("Re-authentication failed:", reauthError);
        toast.error("Необходима е повторна идентификация. Опитай отново.");
        setIsDeleting(false);
        return;
      }

      // Step 2: Delete all user data from backend
      const response = await fetchWithAuth(user!, "/api/user", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete account");
      }

      setDeleteSuccess(true);

      // Sign out after 2 seconds
      setTimeout(async () => {
        await signOut();
        router.push("/");
      }, 2000);
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error("Грешка при изтриването на профила");
      setIsDeleting(false);
    }
  };

  const handleGenerateApiKey = async (websiteUrl: string): Promise<boolean> => {
    if (!user) {
      return false;
    }
    setIsApiClientLoading(true);
    try {
      const response = await fetchWithAuth(user, "/api/api-clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ websiteUrl }),
      });
      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error ?? "Грешка при генериране на API ключ");
        return false;
      }
      const data = await response.json();
      setApiClient(data);
      return true;
    } catch (error) {
      console.error("Error generating API key:", error);
      toast.error("Грешка при генериране на API ключ");
      return false;
    } finally {
      setIsApiClientLoading(false);
    }
  };

  const handleRevokeApiKey = async (): Promise<boolean> => {
    if (!user) {
      return false;
    }
    setIsApiClientLoading(true);
    try {
      const response = await fetchWithAuth(user, "/api/api-clients", {
        method: "DELETE",
      });
      if (!response.ok) {
        toast.error("Грешка при отмяна на API ключа");
        return false;
      }
      setApiClient(null);
      return true;
    } catch (error) {
      console.error("Error revoking API key:", error);
      toast.error("Грешка при отмяна на API ключа");
      return false;
    } finally {
      setIsApiClientLoading(false);
    }
  };

  if (authLoading) {
    return <LoadingState />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-light">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <SettingsHeader />
          <section className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {guestAuthUnavailable
                ? "Гост режимът е недостъпен"
                : "Подготвяме сесията"}
            </h2>
            <p className="text-neutral mb-4">
              {guestAuthUnavailable
                ? "Временно не може да се стартира гост сесия. Влез с Google, за да използваш настройките."
                : "Подготвяме достъп до настройките. Ако това отнема повече време, можеш да влезеш с Google или да се върнеш към началото."}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  trackEvent({
                    name: "login_initiated",
                    params: { source: "settings" },
                  });
                  try {
                    await signInWithGoogle();
                  } catch {
                    toast.error("Неуспешно влизане. Опитай отново.");
                  }
                }}
                className={`${buttonStyles.primary} ${buttonSizes.md} ${borderRadius.md}`}
              >
                Влез с Google
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className={`${buttonStyles.secondary} ${buttonSizes.md} ${borderRadius.md}`}
              >
                Към началото
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (deleteSuccess) {
    return <DeleteSuccessMessage />;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <SettingsHeader />

        {error && <ErrorBanner message={error} />}

        <LandingViewSection />

        <NotificationsSection
          subscriptions={subscriptions}
          currentDeviceToken={currentDeviceToken}
          isGuestUser={isGuestUser}
          onSubscribeCurrentDevice={handleSubscribeCurrentDevice}
          onUnsubscribeDevice={handleUnsubscribeDevice}
          onUnsubscribeAll={handleUnsubscribeAll}
        />

        {isGuestUser && (
          <section className="bg-white rounded-lg shadow mb-6 p-6">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Профил в Google
            </h2>
            <p className="text-neutral mb-4">
              В момента използваш приложението като гост. Влез с Google, за да
              отключиш настройките за профил и API достъп.
            </p>
            <button
              type="button"
              onClick={async () => {
                trackEvent({
                  name: "login_initiated",
                  params: { source: "settings" },
                });
                try {
                  await signInWithGoogle();
                } catch {
                  toast.error("Неуспешно влизане. Опитай отново.");
                }
              }}
              className={`${buttonStyles.primary} ${buttonSizes.md} ${borderRadius.md}`}
            >
              Влез с Google
            </button>
          </section>
        )}

        <ConfirmDialog
          isOpen={showUnsubscribeAllConfirm}
          title="Наистина ли искаш да отпишеш всички устройства?"
          description="Всички устройства ще спрат да получават известия, докато не ги абонираш отново."
          confirmText="Отпиши всички"
          isConfirming={isUnsubscribingAll}
          onConfirm={() => {
            void handleConfirmUnsubscribeAll();
          }}
          onCancel={() => setShowUnsubscribeAllConfirm(false)}
        />

        {!isGuestUser && (
          <ApiAccessSection
            apiClient={apiClient}
            onGenerate={handleGenerateApiKey}
            onRevoke={handleRevokeApiKey}
            isLoading={isApiClientLoading}
          />
        )}

        {!isGuestUser && (
          <DeleteAccountSection
            onDeleteAccount={handleDeleteAccount}
            isDeleting={isDeleting}
          />
        )}
      </div>
    </div>
  );
}
