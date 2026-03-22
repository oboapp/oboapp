"use client";

import { useState } from "react";
import Image from "next/image";
import { trackEvent } from "@/lib/analytics";
import { Message } from "@/lib/types";
import sources from "@/lib/sources";
import { stripMarkdown } from "@/lib/markdown-utils";
import { classifyMessage } from "@/lib/message-classification";
import CategoryChips from "@/components/CategoryChips";

interface MessageCardProps {
  readonly message: Message;
  readonly onClick: (message: Message) => void;
  readonly onHover?: (messageId: string | null) => void;
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function MessageCardSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-neutral-border overflow-clip">
      <div className="space-y-4 animate-pulse">
        {/* Source logo skeleton */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-neutral-light rounded"></div>
          <div className="flex-1">
            <div className="h-4 bg-neutral-light rounded w-3/4"></div>
          </div>
        </div>

        {/* Categories skeleton */}
        <div className="flex gap-2">
          <div className="h-6 w-20 bg-neutral-light rounded-full"></div>
          <div className="h-6 w-16 bg-neutral-light rounded-full"></div>
          <div className="h-6 w-24 bg-neutral-light rounded-full"></div>
        </div>

        {/* Text snippet skeleton */}
        <div className="space-y-2">
          <div className="h-3 bg-neutral-light rounded"></div>
          <div className="h-3 bg-neutral-light rounded"></div>
          <div className="h-3 bg-neutral-light rounded w-5/6"></div>
        </div>

        {/* Timestamp skeleton */}
        <div className="h-3 bg-neutral-light rounded w-1/2"></div>
      </div>
    </div>
  );
}

export default function MessageCard({
  message,
  onClick,
  onHover,
  children,
  className,
}: MessageCardProps) {
  const [logoError, setLogoError] = useState(false);

  // Classify message for status indicator
  const classification = classifyMessage(message);
  const isActive = classification === "active";

  // Find source info
  const sourceInfo = sources.find((s) => s.id === message.source);
  const logoPath = message.source ? `/sources/${message.source}.png` : null;

  // Create text snippet (120-150 characters)
  const createSnippet = (text: string): string => {
    const maxLength = 150;
    // Strip markdown formatting for clean preview
    const cleanText = stripMarkdown(text);

    if (cleanText.length <= maxLength) return cleanText;

    // Try to cut at a word boundary near 150 chars
    const truncated = cleanText.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > 120) {
      return truncated.substring(0, lastSpace) + "...";
    }

    return truncated + "...";
  };

  // Format date in Bulgarian
  const formatDate = (dateStr: Date | string | undefined): string => {
    if (!dateStr) return "";

    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    if (Number.isNaN(date.getTime())) return "";

    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");

    return `${day}.${month}.${year} ${hours}:${minutes}`;
  };

  // Use markdownText if available (from crawlers with precomputed GeoJSON),
  // otherwise fall back to text
  const displayText = message.markdownText || message.text;
  const snippet = createSnippet(displayText);
  const formattedDate = formatDate(message.finalizedAt);

  const handleClick = () => {
    trackEvent({
      name: "message_clicked",
      params: {
        message_id: message.id || "unknown",
        source_id: message.source || "unknown",
        location: "grid",
      },
    });
    onClick(message);
  };

  return (
    <button
      type="button"
      className={`bg-white rounded-lg shadow-md p-4 border border-neutral-border hover:shadow-lg transition-shadow cursor-pointer w-full text-left relative h-full flex flex-col min-w-0 overflow-clip${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      onMouseEnter={() => message.id && onHover?.(message.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => message.id && onHover?.(message.id)}
      onBlur={() => onHover?.(null)}
    >
      {/* Status indicator circle (top-right) */}
      <div
        className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${
          isActive ? "bg-destructive" : "bg-neutral"
        }`}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <div className="space-y-3 min-w-0">
          {/* Source */}
          <div className="flex items-center space-x-2">
            {logoPath && !logoError ? (
              <Image
                src={logoPath}
                alt={sourceInfo?.name || message.source || "Source"}
                width={32}
                height={32}
                className="w-8 h-8 object-contain flex-shrink-0"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div className="w-8 h-8 bg-neutral-light rounded flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {sourceInfo?.name || message.source || "Неизвестен източник"}
              </h3>
            </div>
          </div>

          {message.categories && message.categories.length > 0 && (
            <CategoryChips categories={message.categories} />
          )}

          {/* Text snippet */}
          <p className="text-sm text-neutral line-clamp-3 break-words overflow-wrap-anywhere">
            {snippet}
          </p>

          {/* Timestamp */}
          {formattedDate && (
            <p className="text-xs text-neutral break-words">{formattedDate}</p>
          )}
        </div>

        {/* Admin/debug content can be injected here */}
        {children}
      </div>
    </button>
  );
}
