"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { borderRadius } from "@/lib/colors";
import BackButton from "@/components/BackButton";
import SubscribeDevicePrompt from "@/app/settings/SubscribeDevicePrompt";
import { useNotificationHistory } from "@/lib/hooks/useNotificationHistory";
import { useSubscribeCurrentDevice } from "@/lib/hooks/useSubscribeCurrentDevice";
import LoadingSpinner from "@/components/LoadingSpinner";
import NotificationItem from "@/components/NotificationItem";

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { subscriptionStatus, handleSubscribeCurrentDevice } =
    useSubscribeCurrentDevice(user);
  const {
    notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    markAsRead,
    markAllRead,
  } = useNotificationHistory({
    user,
    enabled: true,
    initialLoading: true,
    emitUnreadCountEvent: true,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }
  }, [authLoading, user, router]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-neutral-light">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Back button */}
          <div className="mb-6">
            <BackButton />
          </div>

          <h1 className="text-3xl font-bold text-foreground mb-8">Известия</h1>
          <div className="flex justify-center items-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back button */}
        <div className="mb-6">
          <BackButton />
        </div>

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-foreground">Известия</h1>
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-sm text-primary hover:text-primary-hover hover:underline cursor-pointer transition-colors"
            >
              Маркирай всички прочетени
            </button>
          )}
        </div>

        {error && (
          <div className="bg-error-light border border-error-border rounded-lg p-4 mb-6">
            <p className="text-error">{error}</p>
          </div>
        )}

        {/* Subscription warning - first item */}
        {!subscriptionStatus.isCurrentDeviceSubscribed && (
          <div className="mb-6">
            <SubscribeDevicePrompt
              onSubscribe={handleSubscribeCurrentDevice}
              hasAnySubscriptions={subscriptionStatus.hasAnySubscriptions}
              isGuestUser={user?.isAnonymous ?? false}
            />
          </div>
        )}

        {notifications.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-neutral text-lg">Няма известия</p>
          </div>
        ) : (
          <div className="space-y-0">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
              />
            ))}
            {hasMore && (
              <div className="p-4 text-center bg-white border-t border-neutral-border">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className={`${buttonStyles.secondary} ${buttonSizes.md} ${borderRadius.md} ${isLoadingMore ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {isLoadingMore ? "Зареждане..." : "Зареди още"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
