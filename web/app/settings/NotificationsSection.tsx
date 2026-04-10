"use client";

import { NotificationSubscription } from "@/lib/types";
import SubscriptionCount from "./SubscriptionCount";
import SubscribeDevicePrompt from "./SubscribeDevicePrompt";
import DeviceSubscriptionCard from "./DeviceSubscriptionCard";
import UnsubscribeAllButton from "./UnsubscribeAllButton";
import Link from "next/link";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { borderRadius } from "@/lib/colors";

interface NotificationsSectionProps {
  readonly subscriptions: NotificationSubscription[];
  readonly currentDeviceToken: string | null;
  readonly isGuestUser?: boolean;
  readonly onSubscribeCurrentDevice: () => void;
  readonly onUnsubscribeDevice: (token: string) => void;
  readonly onUnsubscribeAll: () => void;
}

export default function NotificationsSection({
  subscriptions,
  currentDeviceToken,
  isGuestUser = false,
  onSubscribeCurrentDevice,
  onUnsubscribeDevice,
  onUnsubscribeAll,
}: NotificationsSectionProps) {
  const isCurrentDeviceSubscribed = subscriptions.some(
    (sub) => sub.token === currentDeviceToken,
  );

  return (
    <section className="bg-white rounded-lg shadow mb-6 p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Известия</h2>

      <SubscriptionCount count={subscriptions.length} />

      {!isCurrentDeviceSubscribed && (
        <SubscribeDevicePrompt
          onSubscribe={onSubscribeCurrentDevice}
          hasAnySubscriptions={subscriptions.length > 0}
          isGuestUser={isGuestUser}
        />
      )}

      {subscriptions.length > 0 && (
        <div className="space-y-2 mb-4">
          {subscriptions.map((sub) => (
            <DeviceSubscriptionCard
              key={sub.id}
              subscription={sub}
              isCurrentDevice={sub.token === currentDeviceToken}
              onUnsubscribe={onUnsubscribeDevice}
            />
          ))}
        </div>
      )}

      {subscriptions.length > 1 && (
        <UnsubscribeAllButton onUnsubscribeAll={onUnsubscribeAll} />
      )}

      {/* Notification Filters link */}
      <div className="mt-4 pt-4 border-t border-neutral-border">
        <Link
          href="/settings/notification-filters"
          className={`${buttonStyles.ghost} ${buttonSizes.md} ${borderRadius.sm} inline-block`}
        >
          Филтри за известия
        </Link>
        <p className="text-sm text-neutral mt-1">
          Избери от кои категории и източници искаш да получаваш известия.
        </p>
      </div>
    </section>
  );
}
