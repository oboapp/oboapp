"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Event } from "@oboapp/shared";
import sources from "@/lib/sources";
import { stripMarkdown } from "@/lib/markdown-utils";
import { getButtonClasses } from "@/lib/theme";
import { formatTimespan } from "@/lib/date-format";
import { createSnippet } from "@/lib/text-utils";
import CategoryChips from "@/components/CategoryChips";
import SourceLogo from "@/components/SourceLogo";
import EventAccordion from "@/components/EventAccordion";

type EventsCursor = {
  updatedAt: string;
  id: string;
};

type EventsResponse = {
  events: Event[];
  nextCursor?: EventsCursor;
};

const fetchEvents = async ({
  pageParam,
  signal,
}: {
  pageParam?: EventsCursor;
  signal?: AbortSignal;
}): Promise<EventsResponse> => {
  const params = new URLSearchParams();
  if (pageParam) {
    params.set("cursorUpdatedAt", pageParam.updatedAt);
    params.set("cursorId", pageParam.id);
  }

  const response = await fetch(`/api/events?${params}`, { signal });
  if (!response.ok) throw new Error("Failed to fetch events");
  return response.json();
};

function SingleEventCard({ event }: { readonly event: Event }) {
  const displayText = event.markdownText || event.plainText;
  const clean = stripMarkdown(displayText);
  const snippet = createSnippet(clean, 150);
  const timespan = formatTimespan(event.timespanStart, event.timespanEnd);

  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-neutral-border">
      <div className="space-y-2">
        {/* Source */}
        <div className="flex items-center gap-2">
          {event.sources.length > 0 && (
            <SourceLogo
              sourceId={event.sources[0]}
              size={24}
              showFallbackText
            />
          )}
          <span className="text-sm font-semibold text-foreground truncate">
            {sources.find((s) => s.id === event.sources[0])?.name ||
              event.sources[0] ||
              "Неизвестен"}
          </span>
        </div>

        {/* Categories */}
        {event.categories && event.categories.length > 0 && (
          <CategoryChips categories={event.categories} />
        )}

        {/* Text */}
        <p className="text-sm text-neutral leading-relaxed">{snippet}</p>

        {/* Timespan */}
        {timespan && <p className="text-xs text-neutral">{timespan}</p>}
      </div>
    </div>
  );
}

function EventCardSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-neutral-border animate-pulse">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-neutral-light rounded" />
          <div className="h-4 bg-neutral-light rounded w-1/3" />
        </div>
        <div className="flex gap-2">
          <div className="h-5 w-16 bg-neutral-light rounded-full" />
          <div className="h-5 w-20 bg-neutral-light rounded-full" />
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-neutral-light rounded w-full" />
          <div className="h-3 bg-neutral-light rounded w-5/6" />
        </div>
        <div className="h-3 bg-neutral-light rounded w-1/4" />
      </div>
    </div>
  );
}

export default function EventsPage() {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteQuery({
    queryKey: ["events"],
    queryFn: fetchEvents,
    initialPageParam: undefined satisfies EventsCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const events = useMemo(
    () => data?.pages.flatMap((page) => page.events) ?? [],
    [data],
  );

  const isEmpty = !isLoading && events.length === 0;

  return (
    <div className="min-h-screen bg-neutral-light">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/"
            className="text-primary hover:text-primary-hover inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Начало</span>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8 border border-neutral-border">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Групирани съобщения
            </h1>
            <p className="text-sm text-neutral">
              Съобщенията са групирани по реални събития. Всяко събитие
              обединява свързани съобщения от различни източници. Разгъни
              събитие, за да видиш включените съобщения и тяхната увереност на
              съвпадение.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-error-border bg-error-light p-4 text-error">
            Грешка при зареждане на събитията. Опитай отново.
          </div>
        )}

        <div className="space-y-4">
          {isLoading &&
            Array.from({ length: 6 }, (_, i) => (
              <EventCardSkeleton key={`skeleton-${i}`} />
            ))}

          {!isLoading &&
            events.map((event) =>
              event.messageCount === 1 ? (
                <SingleEventCard key={event.id} event={event} />
              ) : (
                <EventAccordion key={event.id} event={event} />
              ),
            )}

          {isEmpty && (
            <div className="text-center text-neutral py-8">
              Няма налични групирани съобщения.
            </div>
          )}
        </div>

        {hasNextPage && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              className={getButtonClasses("ghost", "lg", "sm")}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Зареждане..." : "Покажи още"}
            </button>
          </div>
        )}

        {isFetchingNextPage && (
          <div className="mt-6 space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <EventCardSkeleton key={`loading-${i}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
