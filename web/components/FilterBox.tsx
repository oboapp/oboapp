"use client";

import { useEffect, useRef, useMemo } from "react";
import FilterIcon from "@/components/icons/FilterIcon";
import { LoadingStatus } from "@/components/LoadingStatus";
import CategoryFilterItem from "@/components/CategoryFilterItem";
import SourceFilterItem from "@/components/SourceFilterItem";
import Accordion from "@/components/Accordion";
import Checkbox from "@/components/Checkbox";
import UnreadIndicator from "@/components/UnreadIndicator";
import { buttonStyles, buttonSizes } from "@/lib/theme";
import { useDragPanel } from "@/lib/hooks/useDragPanel";
import { borderRadius, zIndex } from "@/lib/colors";
import {
  CATEGORY_LABELS,
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  Category,
} from "@oboapp/shared";

/**
 * Skeleton placeholder for category filter while loading
 */
function CategoryFilterSkeleton() {
  const widths = ["w-32", "w-28", "w-36", "w-24", "w-40"];
  return (
    <div className="px-4 py-4 space-y-1">
      {widths.map((width) => (
        <div
          key={width}
          className="flex items-center gap-3 py-2 px-3 animate-pulse"
        >
          <div className="w-4 h-4 bg-neutral-light rounded" />
          <div className={`h-3.5 bg-neutral-light rounded ${width}`} />
        </div>
      ))}
    </div>
  );
}

interface CategoryCount {
  category: Category | typeof UNCATEGORIZED;
  count: number;
}

interface SourceCount {
  sourceId: string;
  name: string;
  count: number;
}

interface FilterBoxProps {
  readonly isOpen: boolean;
  readonly selectedCategories: Set<Category | typeof UNCATEGORIZED>;
  readonly selectedSources: Set<string>;
  readonly categoryCounts: CategoryCount[];
  readonly sourceCounts: SourceCount[];
  readonly hasActiveFilters: boolean;
  readonly hasActiveCategoryFilters: boolean;
  readonly hasActiveSourceFilters: boolean;
  readonly isInitialLoad: boolean;
  readonly isLoadingCounts: boolean;
  readonly showArchived: boolean;
  readonly onTogglePanel: () => void;
  readonly onToggleCategory: (
    category: Category | typeof UNCATEGORIZED,
  ) => void;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onToggleShowArchived: () => void;
  readonly onClearAllFilters: () => void;
}

/**
 * Filter box - slides in/out from left side
 * Shows category and source filters with accordions
 */
export default function FilterBox({
  isOpen,
  selectedCategories,
  selectedSources,
  categoryCounts,
  sourceCounts,
  hasActiveFilters,
  hasActiveCategoryFilters,
  hasActiveSourceFilters,
  isInitialLoad,
  isLoadingCounts,
  showArchived,
  onTogglePanel,
  onToggleCategory,
  onToggleSource,
  onToggleShowArchived,
  onClearAllFilters,
}: FilterBoxProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Horizontal drag to open/close functionality
  const { isActuallyDragging, dragOffset, handlers } = useDragPanel({
    direction: "horizontal",
    isOpen,
    bidirectional: true,
    onAction: onTogglePanel,
  });

  // Calculate transform style based on drag state
  const transformStyle = useMemo(() => {
    let translateX = "-100%";

    if (isActuallyDragging) {
      translateX = isOpen ? `${dragOffset}px` : `calc(-100% + ${dragOffset}px)`;
    } else if (isOpen) {
      translateX = "0";
    }

    return {
      transform: `translateX(${translateX}) translateY(-50%)`,
      transitionProperty: isActuallyDragging ? "none" : undefined,
    };
  }, [isActuallyDragging, isOpen, dragOffset]);

  // Close on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onTogglePanel();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onTogglePanel]);

  return (
    <>
      {/* Backdrop (mobile only) */}
      {isOpen && (
        <button
          type="button"
          className={`fixed inset-0 ${zIndex.overlay} bg-neutral/20 backdrop-blur-sm pointer-events-auto sm:hidden`}
          onClick={onTogglePanel}
          aria-label="Затвори филтрите"
        />
      )}

      {/* Filter Container - Box and Handle together */}
      <div
        className={`absolute left-0 top-1/2 ${zIndex.overlayContent} transition-transform duration-300`}
        style={transformStyle}
      >
        {/* Filter Panel */}
        <div
          ref={panelRef}
          className="relative w-[320px] max-h-[calc(100vh-80px-2rem)] [@media(min-width:1280px)_and_(min-aspect-ratio:4/3)]:max-h-[450px] my-4 bg-white shadow-2xl rounded-r-lg flex flex-col"
        >
          {isOpen && (
            <LoadingStatus
              isLoading={isInitialLoad || isLoadingCounts}
              loadingMessage="Броят съобщения по категории и източници се обновява."
              finishedMessage="Обновяването на филтрите приключи."
            />
          )}
          {isInitialLoad ? (
            <div aria-hidden="true" className="overflow-y-auto flex-1">
              <CategoryFilterSkeleton />
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {/* Categories Accordion - Open by default */}
              <Accordion
                title="Категории"
                defaultOpen={true}
                hasActiveFilters={hasActiveCategoryFilters}
              >
                <div className="px-4 space-y-1">
                  {categoryCounts.map(({ category, count }) => (
                    <CategoryFilterItem
                      key={category}
                      category={category}
                      label={
                        category === UNCATEGORIZED
                          ? UNCATEGORIZED_LABEL
                          : CATEGORY_LABELS[category]
                      }
                      checked={selectedCategories.has(category)}
                      onChange={() => onToggleCategory(category)}
                      count={count}
                      isLoadingCount={isLoadingCounts}
                    />
                  ))}
                </div>
              </Accordion>

              {/* Sources Accordion - Closed by default */}
              <Accordion
                title="Източници"
                defaultOpen={false}
                hasActiveFilters={hasActiveSourceFilters}
              >
                <div className="px-4 space-y-1">
                  {sourceCounts.map(({ sourceId, name, count }) => (
                    <SourceFilterItem
                      key={sourceId}
                      label={name}
                      checked={selectedSources.has(sourceId)}
                      onChange={() => onToggleSource(sourceId)}
                      count={count}
                      isLoadingCount={isLoadingCounts}
                    />
                  ))}
                </div>
              </Accordion>

              {/* Show Archived Checkbox */}
              <div className="border-t border-neutral-border px-4 py-3">
                <Checkbox
                  label="Покажи минали"
                  checked={showArchived}
                  onChange={onToggleShowArchived}
                />
              </div>

              {/* Clear All Button - Desktop only (mobile has it in footer) */}
              {hasActiveFilters && (
                <div className="hidden sm:block border-t border-neutral-border px-4 py-3">
                  <button
                    type="button"
                    onClick={onClearAllFilters}
                    className={`w-full ${buttonSizes.md} ${buttonStyles.ghost} ${borderRadius.md}`}
                  >
                    Изчисти всички
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mobile Footer with Clear and Close Buttons */}
          <div className="border-t border-neutral-border px-4 py-4 flex gap-2 sm:hidden">
            <button
              type="button"
              onClick={onClearAllFilters}
              className={`flex-1 ${buttonSizes.md} ${buttonStyles.ghost} ${borderRadius.md} ${hasActiveFilters ? "" : "invisible"}`}
            >
              Изчисти всички
            </button>
            <button
              type="button"
              onClick={onTogglePanel}
              className={`${buttonSizes.md} ${buttonStyles.primary} ${borderRadius.md}`}
            >
              {hasActiveFilters ? "Покажи" : "Покажи всички"}
            </button>
          </div>
        </div>

        {/* Handle */}
        <button
          type="button"
          onClick={onTogglePanel}
          {...handlers}
          className={[
            "drag-handle absolute right-0 top-1/2",
            "-translate-y-1/2 translate-x-full rounded-r-lg px-2 py-3 hover:px-3 transition-all duration-200 border border-l-0 border-primary-hover bg-primary text-white cursor-grab active:cursor-grabbing shadow-lg",
          ].join(" ")}
          aria-label={isOpen ? "Затвори филтрите" : "Отвори филтрите"}
        >
          <div className="relative">
            <FilterIcon className="w-5 h-5 text-white" />
            {/* Active Filter Indicator - Red Dot */}
            {hasActiveFilters && <UnreadIndicator />}
          </div>
        </button>
      </div>
    </>
  );
}
