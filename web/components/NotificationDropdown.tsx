"use client";

import { useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { NotificationHistoryItem } from "@/lib/types";
import Link from "next/link";
import { createMessageUrlFromId } from "@/lib/url-utils";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { borderRadius, zIndex } from "@/lib/colors";
import { createSnippet } from "@/lib/text-utils";
import { useSubscriptionStatus } from "@/lib/hooks/useSubscriptionStatus";
import SubscribeDevicePrompt from "@/app/settings/SubscribeDevicePrompt";
import {
  subscribeCurrentDeviceForUser,
  getEnableNotificationsMessage,
} from "@/lib/notification-service";
import { formatNotificationDateTime } from "@/lib/notification-history";
import { useNotificationHistory } from "@/lib/hooks/useNotificationHistory";
import LoadingSpinner from "@/components/LoadingSpinner";

interface NotificationDropdownProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCountUpdate: (count: number) => void;
  readonly anchorRef: React.RefObject<HTMLElement | null>;
}

export default function NotificationDropdown({
  isOpen,
  onClose,
  onCountUpdate,
  anchorRef,
}: NotificationDropdownProps) {
  const { user } = useAuth();
  const subscriptionStatus = useSubscriptionStatus(user);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
    enabled: isOpen,
    onUnreadCountChange: onCountUpdate,
    refreshUnreadCountFromServer: true,
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose, anchorRef]);

  const handleSubscribeCurrentDevice = async () => {
    if (!user) return;

    try {
      const result = await subscribeCurrentDeviceForUser(user);
      if (!result.ok) {
        alert(getEnableNotificationsMessage(result.reason));
        return;
      }

      // Re-check subscription status after subscribing
      await subscriptionStatus.checkStatus();
    } catch (error) {
      console.error("Error subscribing:", error);
      alert("Грешка при абонирането");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className={`absolute top-full right-0 mt-2 w-[calc(100vw-2rem)] sm:w-96 bg-white border border-neutral-border rounded-lg shadow-lg ${zIndex.dropdown}`}
      style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-border">
        <h3 className="text-lg font-semibold text-foreground">Известия</h3>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/notification-filters"
            onClick={onClose}
            className="text-sm text-primary hover:text-primary-hover hover:underline transition-colors"
            title="Филтри за известия"
          >
            Филтри
          </Link>
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Subscription warning - first item in scrollable container */}
        {!subscriptionStatus.isCurrentDeviceSubscribed && (
          <div className="p-4 border-b border-neutral-border">
            <SubscribeDevicePrompt
              onSubscribe={handleSubscribeCurrentDevice}
              hasAnySubscriptions={subscriptionStatus.hasAnySubscriptions}
              isGuestUser={user?.isAnonymous ?? false}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-error">{error}</div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-neutral">Няма известия</div>
        ) : (
          <>
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
                onClose={onClose}
              />
            ))}
            {hasMore && (
              <div className="p-4 text-center">
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
          </>
        )}
      </div>
    </div>
  );
}

interface NotificationItemProps {
  readonly notification: NotificationHistoryItem;
  readonly onMarkAsRead: (id: string) => void;
  readonly onClose: () => void;
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onClose,
}: NotificationItemProps) {
  const isUnread = !notification.readAt;
  const messagePreview = createSnippet(notification.messageSnapshot.text);

  const formattedDate = formatNotificationDateTime(notification.notifiedAt);

  const handleClick = () => {
    if (isUnread) {
      onMarkAsRead(notification.id);
    }
    onClose();
  };

  return (
    <Link
      href={createMessageUrlFromId(notification.messageId)}
      onClick={handleClick}
      className={`block p-4 border-b border-neutral-border hover:bg-neutral-light transition-colors ${
        isUnread ? "bg-info-light" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {isUnread && (
          <span className="mt-1 w-2 h-2 bg-primary rounded-full flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs text-neutral">{formattedDate}</span>
            {notification.distance !== undefined && (
              <span className="text-xs text-neutral">
                {Math.round(notification.distance)}m
              </span>
            )}
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {messagePreview}
          </p>
        </div>
      </div>
    </Link>
  );
}
