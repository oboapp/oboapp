"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronDown } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import type { InternalMessage } from "@/lib/types";
import { classifyMessage } from "@/lib/message-classification";
import { useDragPanel, type DragHandlers } from "@/lib/hooks/useDragPanel";
import { useMessageAnimation } from "@/lib/hooks/useMessageAnimation";
import { useEscapeKey } from "@/lib/hooks/useEscapeKey";
import { zIndex } from "@/lib/colors";
import Header from "./Header";
import SourceDisplay from "./Source";
import Locations, { getLocationItemCount, hasAnyLocations } from "./Locations";
import DetailItem from "./DetailItem";
import MessageText from "./MessageText";
import AiProcessedNotice, { hasValidSourceUrl } from "./AiProcessedNotice";
import CategoryChips from "@/components/CategoryChips";
import ExternalLinkIcon from "@/components/icons/ExternalLinkIcon";
import { getFeaturesCentroid } from "@/lib/geometry-utils";
import LinkedMessagesAccordion from "./LinkedMessagesAccordion";

type CloseMethod = "drag" | "esc";

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("bg-BG", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mobile viewport detection via useSyncExternalStore
const mobileQuery = "(max-width: 639px)";
function subscribeMobile(callback: () => void) {
  const mql = globalThis.matchMedia(mobileQuery);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getIsMobile() {
  return globalThis.matchMedia(mobileQuery).matches;
}
function getIsMobileServer() {
  return false;
}

function formatLocationNoun(count: number): string {
  return count === 1 ? "локация" : "локации";
}

const INITIAL_PANEL_HEIGHT_VH = 50;
const EXPANDED_PANEL_HEIGHT_VH = 90;
const DRAG_CLOSE_THRESHOLD = 60;
const PULL_DOWN_RESISTANCE = 0.6;
const SWIPE_UP_THRESHOLD = -20;
const HEADER_DRAG_UP_THRESHOLD = -30;
const PULL_DOWN_CLOSE_THRESHOLD = 40;

const NOOP_DRAG_HANDLERS: DragHandlers = {
  onTouchStart: () => {},
  onTouchMove: () => {},
  onTouchEnd: () => {},
  onMouseDown: () => {},
};

interface MessageDetailViewProps {
  readonly message: InternalMessage | null;
  readonly onClose: () => void;
  readonly onAddressClick?: (lat: number, lng: number) => void;
}

export default function MessageDetailView({
  message,
  onClose,
  onAddressClick,
}: Readonly<MessageDetailViewProps>) {
  // Centralized close handler with analytics tracking
  const handleClose = useCallback(
    (method: CloseMethod) => {
      if (message) {
        trackEvent({
          name: "message_detail_closed",
          params: {
            message_id: message.id || "unknown",
            close_method: method,
          },
        });
      }
      onClose();
    },
    [message, onClose],
  );

  // Refs for scroll tracking and overscroll-to-close
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [expandedHeight, setExpandedHeight] = useState(INITIAL_PANEL_HEIGHT_VH);
  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getIsMobile,
    getIsMobileServer,
  );

  // Overscroll-to-close state
  const [pullDownOffset, setPullDownOffset] = useState(0);
  const isPullingDown = useRef(false);
  const pullTouchStartY = useRef<number | null>(null);

  // Track header drag for expansion
  const headerTouchStartY = useRef<number | null>(null);

  // Drag to close functionality (header/handle)
  const { isDragging, dragOffset, handlers } = useDragPanel({
    direction: "vertical",
    isOpen: true,
    onAction: () => handleClose("drag"),
    threshold: DRAG_CLOSE_THRESHOLD,
  });

  // Track scroll position for dynamic height expansion
  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop;

    // Expand to 90vh on any downward scroll, reset to 50vh at top
    if (scrollTop > 0) {
      setExpandedHeight(EXPANDED_PANEL_HEIGHT_VH);
    } else {
      setExpandedHeight(INITIAL_PANEL_HEIGHT_VH);
    }
  }, []);

  // Overscroll-to-close: pull down when at top of content
  const handleContainerTouchStart = useCallback((e: React.TouchEvent) => {
    pullTouchStartY.current = e.touches[0].clientY;
    isPullingDown.current = false;
  }, []);

  const handleContainerTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (pullTouchStartY.current === null) return;

      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
      const deltaY = e.touches[0].clientY - pullTouchStartY.current;

      // If at top and pulling down, enter overscroll mode
      if (scrollTop <= 0 && deltaY > 0) {
        isPullingDown.current = true;
        e.preventDefault(); // Prevent native scroll/bounce
        setPullDownOffset(deltaY * PULL_DOWN_RESISTANCE);
      } else if (isPullingDown.current && deltaY <= 0) {
        // User reversed direction back up, cancel pull
        isPullingDown.current = false;
        setPullDownOffset(0);
      }

      // If swiping up (negative deltaY) and on mobile, expand to 90vh
      if (isMobile && deltaY < SWIPE_UP_THRESHOLD) {
        setExpandedHeight(EXPANDED_PANEL_HEIGHT_VH);
      }
    },
    [isMobile],
  );

  const handleContainerTouchEnd = useCallback(() => {
    pullTouchStartY.current = null;
    if (isPullingDown.current) {
      isPullingDown.current = false;
      if (pullDownOffset > PULL_DOWN_CLOSE_THRESHOLD) {
        // Threshold met — close
        handleClose("drag");
      }
      setPullDownOffset(0);
    }
  }, [pullDownOffset, handleClose]);

  // Header drag handlers for expansion (drag up to expand to 90vh)
  const handleHeaderTouchStart = useCallback((e: React.TouchEvent) => {
    headerTouchStartY.current = e.touches[0].clientY;
  }, []);

  const handleHeaderTouchMove = useCallback((e: React.TouchEvent) => {
    if (headerTouchStartY.current === null) return;

    const touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - headerTouchStartY.current;

    // If user is dragging UP (negative deltaY) by at least 30px, expand to 90vh
    if (deltaY < HEADER_DRAG_UP_THRESHOLD) {
      setExpandedHeight(EXPANDED_PANEL_HEIGHT_VH);
    }
  }, []);

  const handleHeaderTouchEnd = useCallback(() => {
    headerTouchStartY.current = null;
  }, []);

  // Combined header handlers (expansion + close)
  const combinedHeaderHandlers = {
    ...handlers,
    onTouchStart: (e: React.TouchEvent) => {
      e.stopPropagation();
      handleHeaderTouchStart(e);
      handlers.onTouchStart(e);
    },
    onTouchMove: (e: React.TouchEvent) => {
      e.stopPropagation();
      handleHeaderTouchMove(e);
      handlers.onTouchMove(e);
    },
    onTouchEnd: (e?: React.TouchEvent) => {
      e?.stopPropagation();
      handleHeaderTouchEnd();
      handlers.onTouchEnd();
    },
  };

  const headerHandlers = isMobile ? combinedHeaderHandlers : NOOP_DRAG_HANDLERS;

  const [locationsAccordionState, setLocationsAccordionState] = useState<{
    messageId: string | null;
    isOpen: boolean;
  }>({
    messageId: null,
    isOpen: false,
  });
  const locationsContentId = useId();

  // Handle animation state
  const isVisible = useMessageAnimation(message);

  // Close on ESC key
  useEscapeKey(() => handleClose("esc"), !!message);

  if (!message) return null;

  // Determine which drag is active
  const fallbackDragOffset = isDragging ? dragOffset : 0;
  const activeDragOffset =
    pullDownOffset > 0 ? pullDownOffset : fallbackDragOffset;
  const isAnyDragging = isDragging || pullDownOffset > 0;
  const locationGroups = {
    pins: message.pins,
    streets: message.streets,
    busStops: message.busStops,
    cadastralProperties: message.cadastralProperties,
  };
  const hasLocations = hasAnyLocations(locationGroups);
  const locationsCount = getLocationItemCount(locationGroups);
  const hasGeoObjects = (message.geoJson?.features?.length ?? 0) > 0;
  const locationNoun = formatLocationNoun(locationsCount);
  const isLocationsOpen =
    locationsAccordionState.messageId === message.id &&
    locationsAccordionState.isOpen;

  const toggleLocationsAccordion = () => {
    setLocationsAccordionState((current) => {
      const sameMessage = current.messageId === message.id;
      return {
        messageId: message.id ?? null,
        isOpen: sameMessage ? !current.isOpen : true,
      };
    });
  };

  const locationsToggleLabel = isLocationsOpen
    ? `Скрий ${locationNoun} (${locationsCount})`
    : `Покажи ${locationNoun} (${locationsCount})`;

  return (
    <aside
      ref={scrollContainerRef}
      aria-label="Детайли за сигнала"
      className={`fixed ${zIndex.overlayContent} bg-white shadow-2xl overflow-y-auto transition-all duration-300 ease-out
        bottom-0 left-0 right-0 rounded-t-2xl
        sm:inset-y-0 sm:left-auto sm:right-0 sm:w-96 [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:w-2/5 sm:max-h-none sm:rounded-none
        ${
          isVisible
            ? "translate-y-0 sm:translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-y-0 sm:translate-x-full"
        }
      `}
      onScroll={handleScroll}
      onTouchStart={isMobile ? handleContainerTouchStart : undefined}
      onTouchMove={isMobile ? handleContainerTouchMove : undefined}
      onTouchEnd={isMobile ? handleContainerTouchEnd : undefined}
      style={{
        transform: isAnyDragging
          ? `translateY(${activeDragOffset}px)`
          : undefined,
        transition: isAnyDragging ? "none" : undefined,
        maxHeight: isMobile ? `${expandedHeight}vh` : undefined,
        overscrollBehaviorY: "contain", // Prevent pull-to-refresh on mobile
      }}
    >
      <Header
        handlers={headerHandlers}
        onClose={onClose}
        messageId={message.id}
        classification={classifyMessage(message)}
      />

      <div
        className={`px-4 sm:px-6 py-4 pb-6 sm:pb-4 space-y-6 transition-opacity duration-500 delay-100 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {message.finalizedAt && (
          <DetailItem title="Публикувано тук">
            <p className="text-base text-gray-900">
              {formatDate(message.finalizedAt)}
            </p>
          </DetailItem>
        )}

        {message.source && (
          <SourceDisplay
            sourceId={message.source}
            sourceUrl={message.sourceUrl}
          />
        )}

        {message.categories && message.categories.length > 0 && (
          <DetailItem title="Категории">
            <CategoryChips categories={message.categories} />
          </DetailItem>
        )}

        <DetailItem title="Текст">
          <MessageText
            text={message.text}
            markdownText={message.summary ?? message.markdownText}
          />
        </DetailItem>

        {message.summary && (
          <p className="text-neutral">
            Съдържанието е съкратено от AI.
            {hasValidSourceUrl(message.sourceUrl) && message.sourceUrl && (
              <>
                {" "}
                <span>Виж </span>
                <a
                  href={message.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="оригиналния източник (отваря се в нов таб)"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                >
                  <span>оригиналния източник</span>
                  <ExternalLinkIcon className="h-3.5 w-3.5 text-neutral" />
                </a>
                <span>.</span>
              </>
            )}
          </p>
        )}

        {message.responsibleEntity && (
          <DetailItem title="Отговорна институция">
            <p className="text-base text-gray-900">
              {message.responsibleEntity}
            </p>
          </DetailItem>
        )}

        {!message.summary && message.aiProcessed && (
          <AiProcessedNotice sourceUrl={message.sourceUrl} />
        )}

        {hasGeoObjects &&
          (() => {
            const centroid = getFeaturesCentroid(message.geoJson!);
            const isClickable = centroid && onAddressClick;
            const handleGeoClick = () => {
              if (centroid && onAddressClick) {
                onAddressClick(centroid.lat, centroid.lng);
                // Scroll body to bring the map into view (especially on mobile)
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            };
            return (
              <DetailItem title="Обекти на картата">
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {isClickable ? (
                      <button
                        type="button"
                        onClick={handleGeoClick}
                        className="flex-1 text-left bg-neutral-light rounded-md p-3 border border-neutral-border hover:bg-info-light hover:border-info-border transition-colors cursor-pointer"
                      >
                        <p className="text-sm text-foreground">
                          {message.geoJson!.features.length}{" "}
                          {message.geoJson!.features.length === 1
                            ? "обект"
                            : "обекта"}{" "}
                          на картата
                        </p>
                      </button>
                    ) : (
                      <div className="flex-1 text-left bg-neutral-light rounded-md p-3 border border-neutral-border">
                        <p className="text-sm text-gray-900">
                          {message.geoJson!.features.length}{" "}
                          {message.geoJson!.features.length === 1
                            ? "обект"
                            : "обекта"}{" "}
                          на картата
                        </p>
                      </div>
                    )}

                    {hasLocations && (
                      <button
                        type="button"
                        onClick={toggleLocationsAccordion}
                        aria-expanded={isLocationsOpen}
                        aria-controls={locationsContentId}
                        className="w-full sm:w-auto inline-flex items-center justify-between gap-2 text-sm font-medium text-neutral-dark bg-neutral-light rounded-md p-3 border border-neutral-border hover:bg-info-light hover:border-info-border transition-colors cursor-pointer"
                      >
                        <span>{locationsToggleLabel}</span>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            isLocationsOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  {hasLocations && (
                    <section
                      id={locationsContentId}
                      aria-label="Локации"
                      className="pt-1"
                      hidden={!isLocationsOpen}
                    >
                      <Locations
                        pins={message.pins}
                        streets={message.streets}
                        busStops={message.busStops}
                        cadastralProperties={message.cadastralProperties}
                        addresses={message.addresses}
                        onLocationClick={onAddressClick}
                      />
                    </section>
                  )}
                </div>
              </DetailItem>
            );
          })()}

        {!hasGeoObjects && hasLocations && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={toggleLocationsAccordion}
              aria-expanded={isLocationsOpen}
              aria-controls={locationsContentId}
              className="w-full inline-flex items-center justify-between gap-2 text-sm font-medium text-neutral-dark bg-neutral-light rounded-md p-3 border border-neutral-border hover:bg-info-light hover:border-info-border transition-colors cursor-pointer"
            >
              <span>{locationsToggleLabel}</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  isLocationsOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <section
              id={locationsContentId}
              aria-label="Локации"
              className="pt-1"
              hidden={!isLocationsOpen}
            >
              <Locations
                pins={message.pins}
                streets={message.streets}
                busStops={message.busStops}
                cadastralProperties={message.cadastralProperties}
                addresses={message.addresses}
                onLocationClick={onAddressClick}
              />
            </section>
          </div>
        )}

        {message.eventId && message.id && (
          <LinkedMessagesAccordion
            eventId={message.eventId}
            currentMessageId={message.id}
          />
        )}
      </div>
    </aside>
  );
}
