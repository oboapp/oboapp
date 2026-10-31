"use client";

import React, { useMemo } from "react";
import { Message } from "@/lib/types";
import MessageCard, { MessageCardSkeleton } from "./MessageCard";

interface MessagesGridProps {
  readonly messages: Message[];
  readonly isLoading: boolean;
  readonly onMessageClick: (message: Message) => void;
  readonly onMessageHover?: (messageId: string | null) => void;
  readonly limit?: number;
  readonly variant?: "grid" | "list";
}

interface GridContentProps {
  readonly containerClasses: string;
  readonly isLoading: boolean;
  readonly skeletonKeys: readonly string[];
  readonly finalizedMessages: Message[];
  readonly onMessageClick: (message: Message) => void;
  readonly onMessageHover?: (messageId: string | null) => void;
  readonly remainingCount: number;
  readonly variant: "grid" | "list";
}

function GridContent({
  containerClasses,
  isLoading,
  skeletonKeys,
  finalizedMessages,
  onMessageClick,
  onMessageHover,
  remainingCount,
  variant,
}: GridContentProps) {
  return (
    <>
      <div className={containerClasses}>
        {isLoading &&
          skeletonKeys.map((key) => <MessageCardSkeleton key={key} />)}
        {!isLoading &&
          finalizedMessages.length > 0 &&
          finalizedMessages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              onClick={onMessageClick}
              onHover={onMessageHover}
            />
          ))}
        {!isLoading && finalizedMessages.length === 0 && (
          <div
            className={
              variant === "list"
                ? "text-center text-neutral py-8"
                : "col-span-full text-center text-neutral py-8"
            }
          >
            Няма налични съобщения
          </div>
        )}
      </div>
      {!isLoading && remainingCount > 0 && (
        <div className="text-center text-sm text-neutral mt-4">
          ...и още {remainingCount} събития
        </div>
      )}
    </>
  );
}

export default function MessagesGrid({
  messages,
  isLoading,
  onMessageClick,
  onMessageHover,
  limit = 6,
  variant = "grid",
}: MessagesGridProps) {
  // Helper to parse date
  const parseDate = (dateValue: Date | string | undefined): Date => {
    if (!dateValue) {
      return new Date(0);
    }
    return typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  };

  // Generate skeleton keys once
  const skeletonKeys = useMemo(
    () => Array.from({ length: limit }, (_, i) => `skeleton-${i}`),
    [limit],
  );

  // City-wide cards use their locality and do not require event geometry.
  const allFinalizedMessages = messages
    .filter(
      (message) =>
        message.finalizedAt && (message.cityWide || message.geoJson?.features),
    )
    .sort((a, b) => {
      // Sort by finalizedAt descending (newest first)
      const dateA = parseDate(a.finalizedAt);
      const dateB = parseDate(b.finalizedAt);

      return dateB.getTime() - dateA.getTime();
    });

  // If total is within limit+4, show all instead of truncating
  const shouldShowAll = allFinalizedMessages.length <= limit + 4;
  const finalizedMessages = shouldShowAll
    ? allFinalizedMessages
    : allFinalizedMessages.slice(0, limit);
  const remainingCount = allFinalizedMessages.length - finalizedMessages.length;

  const containerClasses =
    variant === "list"
      ? "grid grid-cols-1 @lg:grid-cols-2 gap-4 min-w-0"
      : "grid grid-cols-1 @md:grid-cols-2 @xl:grid-cols-3 gap-6 min-w-0";

  const gridContent = (
    <GridContent
      containerClasses={containerClasses}
      isLoading={isLoading}
      skeletonKeys={skeletonKeys}
      finalizedMessages={finalizedMessages}
      onMessageClick={onMessageClick}
      onMessageHover={onMessageHover}
      remainingCount={remainingCount}
      variant={variant}
    />
  );

  return variant === "list" ? (
    gridContent
  ) : (
    <div className="bg-neutral-light py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {gridContent}
      </div>
    </div>
  );
}
