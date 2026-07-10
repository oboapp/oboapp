import { useCallback } from "react";
import { User } from "firebase/auth";
import { useSubscriptionStatus } from "@/lib/hooks/useSubscriptionStatus";
import {
  subscribeCurrentDeviceForUser,
  getEnableNotificationsMessage,
} from "@/lib/notification-service";
import { toast } from "sonner";
import * as Sentry from "@sentry/nextjs";

export function useSubscribeCurrentDevice(user: User | null) {
  const subscriptionStatus = useSubscriptionStatus(user);

  const handleSubscribeCurrentDevice = useCallback(async () => {
    if (!user) return;

    try {
      const result = await subscribeCurrentDeviceForUser(user);
      if (!result.ok) {
        toast.error(getEnableNotificationsMessage(result.reason));
        return;
      }
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: {
          area: "notifications",
          action: "subscribeCurrentDevice",
        },
      });
      toast.error("Грешка при абонирането");
    }
    await subscriptionStatus.checkStatus();
  }, [user, subscriptionStatus]);

  return { subscriptionStatus, handleSubscribeCurrentDevice };
}
