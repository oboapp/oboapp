"use client";

import { useCallback, useId, useLayoutEffect, useRef } from "react";
import { House } from "lucide-react";
import styles from "./SegmentedControl.module.css";

interface SegmentOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SegmentedControlProps {
  readonly options: readonly SegmentOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly homeValue?: string;
  readonly onHomeChange?: (value: string) => void;
  readonly className?: string;
}

/**
 * Pill-shaped segmented control for selecting between mutually exclusive options.
 * Renders as a role="radiogroup" with roving tabIndex and arrow-key navigation
 * per the WAI-ARIA radio group pattern.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  homeValue,
  onHomeChange,
  className = "",
}: SegmentedControlProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const previousValueRef = useRef(value);
  const homeHintId = useId();
  const hasHomeActions = Boolean(onHomeChange);
  const enabledOptions = options.filter((o) => !o.disabled);

  useLayoutEffect(() => {
    const group = groupRef.current;
    const indicator = indicatorRef.current;
    if (!group || !indicator) {
      return;
    }

    const activeSegment = group.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeSegment) {
      delete group.dataset.indicatorReady;
      return;
    }

    const paintIndicator = (
      bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
    ) => {
      const groupBounds = group.getBoundingClientRect();
      indicator.style.setProperty(
        "--selection-x",
        `${bounds.left - groupBounds.left - group.clientLeft}px`,
      );
      indicator.style.setProperty(
        "--selection-y",
        `${bounds.top - groupBounds.top - group.clientTop}px`,
      );
      indicator.style.setProperty("--selection-width", `${bounds.width}px`);
      indicator.style.setProperty("--selection-height", `${bounds.height}px`);
      group.dataset.indicatorReady = "true";
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const duration = Number.parseFloat(
      getComputedStyle(group).getPropertyValue("--selection-duration"),
    );
    let isAnimating =
      previousValueRef.current !== value &&
      group.dataset.indicatorReady === "true" &&
      !reducedMotion.matches &&
      duration > 0;
    previousValueRef.current = value;
    let frame = 0;

    if (isAnimating) {
      const startBounds = indicator.getBoundingClientRect();
      const started = performance.now();
      const animate = (now: number) => {
        const progress = reducedMotion.matches
          ? 1
          : Math.min(Math.max((now - started) / duration, 0), 1);
        const eased = 1 - (1 - progress) ** 3;
        const target = activeSegment.getBoundingClientRect();
        paintIndicator({
          left: startBounds.left + (target.left - startBounds.left) * eased,
          top: startBounds.top + (target.top - startBounds.top) * eased,
          width: startBounds.width + (target.width - startBounds.width) * eased,
          height: startBounds.height + (target.height - startBounds.height) * eased,
        });
        isAnimating = progress < 1;
        if (isAnimating) {
          frame = requestAnimationFrame(animate);
        }
      };
      frame = requestAnimationFrame(animate);
    }

    // Read live tab bounds while their house slots expand and collapse.
    const updateIndicator = () => {
      if (!isAnimating) {
        paintIndicator(activeSegment.getBoundingClientRect());
      }
    };
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(group);
    for (const segment of group.querySelectorAll<HTMLElement>("[data-active]")) {
      observer.observe(segment);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [options, value, hasHomeActions]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const { key } = event;
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(key)) {
        return;
      }

      event.preventDefault();

      if (enabledOptions.length === 0) {
        return;
      }

      const currentIndex = enabledOptions.findIndex((o) => o.value === value);
      if (currentIndex === -1) {
        return;
      }
      let nextIndex: number;

      if (key === "ArrowRight" || key === "ArrowDown") {
        nextIndex = (currentIndex + 1) % enabledOptions.length;
      } else {
        nextIndex =
          (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
      }

      const nextOption = enabledOptions[nextIndex];
      onChange(nextOption.value);

      // Move focus to the newly selected radio button
      const target = event.target;
      const radiogroup =
        target instanceof HTMLElement
          ? target.closest("[role='radiogroup']")
          : null;
      const buttons = radiogroup?.querySelectorAll<HTMLButtonElement>(
        "[role='radio']:not([aria-disabled='true'])",
      );
      buttons?.[nextIndex]?.focus();
    },
    [enabledOptions, value, onChange],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Изглед на събитията"
      data-slot="segmented-control"
      className={`${styles.control} relative isolate inline-flex items-center rounded-full border border-neutral-border bg-neutral-light p-1 gap-0 sm:gap-1 ${className}`}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        data-slot="selection-indicator"
        className={`${styles.indicator} pointer-events-none absolute left-0 top-0 rounded-full bg-white shadow-sm`}
      />
      {hasHomeActions && (
        <span id={homeHintId} className="sr-only">
          За да смениш началния изглед, избери друг изглед и натисни къщичката му.
        </span>
      )}
      {options.map((option) => {
        const isActive = option.value === value;
        const isDisabled = option.disabled === true;
        // Roving tabIndex: only the active (checked) radio is tabbable;
        // disabled buttons are also not tabbable.
        let tabIndex = -1;
        if (!isDisabled && isActive) {
          tabIndex = 0;
        }
        const isHome = homeValue === option.value;
        const hasHomeAction = isActive && !isDisabled && Boolean(onHomeChange);
        const homeLabel = isHome
          ? `Информация за началния изглед „${option.label}“`
          : `Направи „${option.label}“ начален изглед`;
        const homeTitle = isHome
          ? `„${option.label}“ е началният ти изглед`
          : homeLabel;
        return (
          <div
            key={option.value}
            data-active={isActive}
            data-disabled={isDisabled || undefined}
            className={`${styles.segment} relative flex min-w-0 items-center rounded-full ${
              isActive ? "bg-white shadow-sm text-primary" : "text-neutral-hover"
            }`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-disabled={isDisabled || undefined}
              tabIndex={tabIndex}
              onClick={isDisabled ? undefined : () => onChange(option.value)}
              onKeyDown={isDisabled ? undefined : handleKeyDown}
              className={`${styles.label} min-h-11 whitespace-nowrap py-1.5 rounded-full text-[13px] sm:text-sm font-medium focus-visible:outline-none ${
                hasHomeAction
                  ? "pl-2.5 pr-0 min-[360px]:pl-3"
                  : "px-2.5 min-[360px]:px-3"
              } ${
                isDisabled
                  ? "opacity-40 cursor-not-allowed"
                  : "cursor-pointer"
              }`}
            >
              {option.label}
            </button>
            {!isDisabled && onHomeChange && (
              <span
                data-slot="home-action-slot"
                aria-hidden={!isActive}
                inert={!isActive}
                className={styles.homeSlot}
              >
                <button
                  type="button"
                  aria-label={homeLabel}
                  title={homeTitle}
                  aria-describedby={isHome ? homeHintId : undefined}
                  disabled={!isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => {
                    if (isActive) {
                      onHomeChange(option.value);
                    }
                  }}
                  className={`${styles.homeButton} flex h-11 w-11 shrink-0 items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  <House
                    className="h-5 w-5"
                    fill={isHome ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
