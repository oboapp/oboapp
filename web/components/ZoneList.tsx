"use client";

import { useEffect, useRef, useState } from "react";
import type { Interest } from "@/lib/types";
import { colors } from "@/lib/colors";

interface ZoneListProps {
  readonly interests: readonly Interest[];
  readonly onZoneClick?: (interest: Interest) => void;
  readonly onMoveZone?: (interest: Interest) => void;
  readonly onDeleteZone?: (interest: Interest) => void;
}

/** Fallback colour when interest has no colour assigned. */
const DEFAULT_COLOR = colors.primary.grey;

/**
 * Renders the user's saved interest zones as a compact list.
 * Shown in the sidebar when "Моите зони" is selected.
 */
export default function ZoneList({
  interests,
  onZoneClick,
  onMoveZone,
  onDeleteZone,
}: ZoneListProps) {
  const [openMenuInterestId, setOpenMenuInterestId] = useState<string | null>(
    null,
  );
  const menuContainerRef = useRef<HTMLUListElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuRefs = useRef(new Map<string, HTMLDivElement>());

  const closeMenuAndFocusTrigger = (interestId: string) => {
    setOpenMenuInterestId(null);
    triggerRefs.current.get(interestId)?.focus();
  };

  const focusMenuItem = (interestId: string, direction: "next" | "prev") => {
    const menu = menuRefs.current.get(interestId);
    if (!menu) {
      return;
    }

    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) {
      return;
    }

    const currentIndex =
      document.activeElement instanceof HTMLButtonElement
        ? items.indexOf(document.activeElement)
        : -1;

    if (currentIndex < 0) {
      const fallbackIndex = direction === "next" ? 0 : items.length - 1;
      items[fallbackIndex]?.focus();
      return;
    }

    const delta = direction === "next" ? 1 : -1;
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const openMenuAndFocus = (interestId: string, direction: "next" | "prev") => {
    setOpenMenuInterestId(interestId);
    requestAnimationFrame(() => {
      focusMenuItem(interestId, direction);
    });
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuContainerRef.current) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!menuContainerRef.current.contains(target)) {
        setOpenMenuInterestId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  if (interests.length === 0) {
    return (
      <div className="text-center text-neutral py-8">
        Нямаш добавени зони. Натисни &ldquo;Добави зона&rdquo;, за да
        започнеш.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2" ref={menuContainerRef}>
      {interests.map((interest, index) => {
        const color = interest.color ?? DEFAULT_COLOR;
        const label = interest.label || "Зона";
        const menuId = `zone-actions-menu-${interest.id}`;
        const isMenuOpen = openMenuInterestId === interest.id;
        const key = interest.id ?? `zone-${index}`;

        return (
          <li key={key}>
            <div className="w-full flex items-start gap-2 rounded-lg border border-neutral-border bg-white p-3 text-left transition-colors hover:bg-neutral-light">
              <button
                type="button"
                onClick={() => onZoneClick?.(interest)}
                className="flex-1 min-w-0 flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md"
              >
                <span
                  className="w-8 h-8 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-neutral-dark truncate">
                    {label}
                  </span>
                  <span className="text-xs text-neutral">
                    {interest.radius} м радиус
                  </span>
                </div>
              </button>

              {(onMoveZone || onDeleteZone) && interest.id && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMenuInterestId((current) =>
                        current === interest.id ? null : interest.id!,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (isMenuOpen) {
                          setOpenMenuInterestId(null);
                          return;
                        }

                        openMenuAndFocus(interest.id!, "next");
                        return;
                      }

                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        if (isMenuOpen) {
                          focusMenuItem(interest.id!, "next");
                          return;
                        }

                        openMenuAndFocus(interest.id!, "next");
                        return;
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        if (isMenuOpen) {
                          focusMenuItem(interest.id!, "prev");
                          return;
                        }

                        openMenuAndFocus(interest.id!, "prev");
                      }
                    }}
                    ref={(node) => {
                      if (node) {
                        triggerRefs.current.set(interest.id!, node);
                        return;
                      }

                      triggerRefs.current.delete(interest.id!);
                    }}
                    className="h-8 w-8 rounded-md text-neutral hover:bg-neutral-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 cursor-pointer"
                    aria-label={`Действия за ${label}`}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    aria-controls={menuId}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="mx-auto h-5 w-5"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="5" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="12" cy="19" r="1.8" />
                    </svg>
                  </button>

                  {isMenuOpen && (
                    <div
                      id={menuId}
                      role="menu"
                      tabIndex={-1}
                      aria-label={`Меню с действия за ${label}`}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          closeMenuAndFocusTrigger(interest.id!);
                          return;
                        }

                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          focusMenuItem(interest.id!, "next");
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          focusMenuItem(interest.id!, "prev");
                        }
                      }}
                      ref={(node) => {
                        if (node) {
                          menuRefs.current.set(interest.id!, node);
                          return;
                        }

                        menuRefs.current.delete(interest.id!);
                      }}
                      className="absolute right-0 top-9 z-30 min-w-[140px] rounded-lg border border-neutral-border bg-white py-1 shadow-lg"
                    >
                      {onMoveZone && (
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            onMoveZone(interest);
                            setOpenMenuInterestId(null);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-neutral hover:bg-neutral-light cursor-pointer"
                        >
                          Премести
                        </button>
                      )}
                      {onDeleteZone && (
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            onDeleteZone(interest);
                            setOpenMenuInterestId(null);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-error hover:bg-error-light cursor-pointer"
                        >
                          Изтрий
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
