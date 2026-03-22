"use client";

import { useState, useId } from "react";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Event, Message, EventMessage } from "@oboapp/shared";
import sources from "@/lib/sources";
import { stripMarkdown } from "@/lib/markdown-utils";
import { createSnippet } from "@/lib/text-utils";
import { formatTimespan } from "@/lib/date-format";
import CategoryChips from "@/components/CategoryChips";
import SourceLogo from "@/components/SourceLogo";
import LoadingSpinner from "@/components/LoadingSpinner";

interface EventAccordionProps {
  readonly event: Event;
}

type EventMessagesResponse = {
  messages: Message[];
  eventMessages: EventMessage[];
};

function makeSnippet(text: string, maxLength = 150): string {
  const clean = stripMarkdown(text);
  return createSnippet(clean, maxLength);
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function MessageRow({
  message,
  eventMessage,
}: {
  readonly message: Message;
  readonly eventMessage: EventMessage | undefined;
}) {
  const sourceInfo = sources.find((s) => s.id === message.source);
  const displayText = message.markdownText || message.text;
  const snippet = makeSnippet(displayText, 120);

  return (
    <div className="flex items-start gap-3 py-2 px-3 border-b border-neutral-border last:border-b-0">
      <div className="flex-shrink-0 mt-0.5">
        {message.source && <SourceLogo sourceId={message.source} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-medium text-neutral-dark truncate">
            {sourceInfo?.name || message.source || "Неизвестен"}
          </span>
          {eventMessage && (
            <span
              className="text-xs text-neutral flex-shrink-0"
              title="Увереност на съвпадението"
            >
              {formatConfidence(eventMessage.confidence)}
            </span>
          )}
        </div>
        <p className="text-xs text-neutral leading-relaxed">{snippet}</p>
      </div>
    </div>
  );
}

function EventMessagesBody({ eventId }: { readonly eventId: string }) {
  const { data, isLoading, error } = useQuery<EventMessagesResponse>({
    queryKey: ["eventMessages", eventId],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/events/messages?eventId=${encodeURIComponent(eventId)}`,
        { signal },
      );
      if (!res.ok) throw new Error("Failed to fetch event messages");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-xs text-error">
        Грешка при зареждане на съобщенията.
      </div>
    );
  }

  if (!data || data.messages.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-neutral">Няма съобщения.</div>
    );
  }

  const eventMessagesByMessageId = new Map(
    data.eventMessages.map((em) => [em.messageId, em]),
  );

  return (
    <div>
      {data.messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          eventMessage={eventMessagesByMessageId.get(message.id || "")}
        />
      ))}
    </div>
  );
}

export default function EventAccordion({ event }: EventAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const titleId = useId();

  const snippet = makeSnippet(event.plainText, 200);
  const timespan = formatTimespan(event.timespanStart, event.timespanEnd);

  return (
    <div className="bg-white rounded-lg shadow-md border border-neutral-border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left p-4 hover:bg-neutral-light/50 transition-colors cursor-pointer"
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Header row: text + badge */}
            <div className="flex items-center gap-2 mb-1">
              <span
                id={titleId}
                className="text-sm font-semibold text-foreground line-clamp-2"
              >
                {snippet}
              </span>
              <span className="flex-shrink-0 inline-flex items-center justify-center bg-info-light text-info text-xs font-medium px-2 py-0.5 rounded-full">
                {event.messageCount}
              </span>
            </div>

            {/* Categories */}
            {event.categories && event.categories.length > 0 && (
              <div className="mb-2">
                <CategoryChips categories={event.categories} />
              </div>
            )}

            {/* Meta row: sources + timespan */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral">
              {/* Source logos */}
              <div className="flex items-center gap-1">
                {event.sources.map((sourceId) => (
                  <SourceLogo key={sourceId} sourceId={sourceId} />
                ))}
              </div>

              {timespan && <span>{timespan}</span>}
            </div>
          </div>

          <ChevronDown
            className={`w-4 h-4 text-neutral transition-transform flex-shrink-0 mt-1 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {isOpen && (
        <div
          id={contentId}
          role="region"
          aria-labelledby={titleId}
          className="border-t border-neutral-border bg-neutral-light/30"
        >
          <EventMessagesBody eventId={event.id!} />
        </div>
      )}
    </div>
  );
}
