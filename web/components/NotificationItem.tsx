"use client";

import Link from "next/link";
import { NotificationHistoryItem } from "@/lib/types";
import { createMessageUrlFromId } from "@/lib/url-utils";
import { createSnippet } from "@/lib/text-utils";
import SourceLogo from "@/components/SourceLogo";
import sources from "@/lib/sources";
import { formatNotificationDateTime } from "@/lib/notification-history";

interface NotificationItemProps {
  readonly notification: NotificationHistoryItem;
  readonly onMarkAsRead: (id: string) => void;
  readonly onClose?: () => void;
}

export default function NotificationItem({
  notification,
  onMarkAsRead,
  onClose,
}: NotificationItemProps) {
  const isUnread = !notification.readAt;
  const messagePreview = createSnippet(notification.messageSnapshot.text);
  const sourceId = notification.messageSnapshot.source;
  const sourceName = sourceId
    ? sources.find((source) => source.id === sourceId)?.name || sourceId
    : null;

  const formattedDate = formatNotificationDateTime(notification.notifiedAt);

  const handleClick = () => {
    if (isUnread) {
      onMarkAsRead(notification.id);
    }
    onClose?.();
  };

  return (
    <Link
      href={createMessageUrlFromId(notification.messageId)}
      onClick={handleClick}
      className={`relative block p-4 border-b border-neutral-border hover:bg-neutral-light transition-colors bg-white ${
        isUnread ? "!bg-info-light" : ""
      }`}
    >
      {isUnread && (
        <span className="absolute top-5 left-2 w-2 h-2 bg-primary rounded-full" />
      )}
      <div className="flex items-start gap-3">
        {sourceId && (
          <div className="w-8 h-8 rounded-full bg-neutral-light border border-neutral-border flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">
            <SourceLogo sourceId={sourceId} size={24} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {sourceName && (
              <p className="text-sm text-neutral truncate min-w-0 flex-1">
                {sourceName}
              </p>
            )}
            <span className="text-sm text-neutral">{formattedDate}</span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {messagePreview}
          </p>
        </div>
      </div>
    </Link>
  );
}
