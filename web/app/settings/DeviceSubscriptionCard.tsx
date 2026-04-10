import { NotificationSubscription } from "@/lib/types";
import { parseUserAgent } from "@/lib/parse-user-agent";
import { buttonStyles } from "@/lib/theme";

interface DeviceSubscriptionCardProps {
  readonly subscription: NotificationSubscription;
  readonly isCurrentDevice: boolean;
  readonly onUnsubscribe: (token: string) => void;
}

export default function DeviceSubscriptionCard({
  subscription,
  isCurrentDevice,
  onUnsubscribe,
}: DeviceSubscriptionCardProps) {
  const parsed = parseUserAgent(subscription.deviceInfo?.userAgent || "");
  const createdDate = new Date(subscription.createdAt).toLocaleDateString(
    "bg-BG",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    },
  );

  return (
    <div
      className={`border rounded-lg p-3 flex items-center justify-between gap-4 ${
        isCurrentDevice
          ? "border-info-border bg-info-light"
          : "border-neutral-border"
      }`}
    >
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-2">
        <p className="font-medium text-foreground text-sm flex items-center gap-2">
          <span>{parsed.displayName}</span>
          {isCurrentDevice && (
            <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded whitespace-nowrap">
              Това устройство
            </span>
          )}
        </p>
        <p className="text-sm text-neutral sm:before:content-['•'] sm:before:mr-2">
          Добавено: {createdDate}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onUnsubscribe(subscription.token)}
        className={`text-sm whitespace-nowrap flex-shrink-0 ${buttonStyles.linkDestructive}`}
      >
        Отписване
      </button>
    </div>
  );
}
