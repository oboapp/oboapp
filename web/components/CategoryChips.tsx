"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, Category } from "@oboapp/shared";
import CategoryIcon from "@/components/CategoryIcon";
import { getCategoryColor } from "@/lib/category-styles";
import { getPreferredScrollBehavior } from "@/lib/scroll-behavior";

interface CategoryChipsProps {
  readonly categories?: string[];
  readonly className?: string;
}

function isCategory(value: string): value is Category {
  return value in CATEGORY_LABELS;
}

export default function CategoryChips({
  categories,
  className,
}: CategoryChipsProps) {
  const [hasOverflow, setHasOverflow] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScrollState = () => {
      const nextOverflow = container.scrollWidth > container.clientWidth;
      const maxScrollLeft = Math.max(
        0,
        container.scrollWidth - container.clientWidth,
      );
      const nextCanScrollLeft = nextOverflow && container.scrollLeft > 0;
      const nextCanScrollRight =
        nextOverflow && container.scrollLeft < maxScrollLeft - 1;

      setHasOverflow((current) =>
        current === nextOverflow ? current : nextOverflow,
      );
      setCanScrollLeft((current) =>
        current === nextCanScrollLeft ? current : nextCanScrollLeft,
      );
      setCanScrollRight((current) =>
        current === nextCanScrollRight ? current : nextCanScrollRight,
      );
    };

    updateScrollState();

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(container);
    container.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", updateScrollState);
    };
  }, [categories]);

  if (!categories || categories.length === 0) {
    return null;
  }

  return (
    <div className={`relative min-w-0 -mx-1 px-1 ${className ?? ""}`}>
      <div
        ref={containerRef}
        data-category-scroll
        className="flex flex-nowrap gap-1.5 overflow-x-auto whitespace-nowrap -webkit-overflow-scrolling-touch scrollbar-hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {categories.map((category) => {
          if (!isCategory(category)) return null;

          return (
            <button
              type="button"
              key={category}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-normal rounded-full border bg-white whitespace-nowrap"
              style={{
                borderColor: getCategoryColor(category),
                color: "inherit",
              }}
              onClick={(event) => {
                event.currentTarget.scrollIntoView({
                  behavior: getPreferredScrollBehavior(),
                  block: "nearest",
                  inline: "center",
                });
              }}
            >
              <CategoryIcon category={category} size={14} showBackground />
              {CATEGORY_LABELS[category]}
            </button>
          );
        })}
      </div>
      {hasOverflow && (
        <>
          {canScrollLeft && (
            <div
              data-category-fade="left"
              className="pointer-events-none absolute inset-y-0 left-0 w-[2.5em] bg-gradient-to-r from-background to-transparent"
            />
          )}
          {canScrollRight && (
            <div
              data-category-fade="right"
              className="pointer-events-none absolute inset-y-0 right-0 w-[2.5em] bg-gradient-to-l from-background to-transparent"
            />
          )}
        </>
      )}
    </div>
  );
}
