"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Message } from "@/lib/types";
import {
  Category,
  CATEGORIES,
  CATEGORY_DISPLAY_ORDER,
  UNCATEGORIZED,
} from "@oboapp/shared";
import { classifyMessage } from "@/lib/message-classification";

const STORAGE_KEY = "categoryFilter";

interface CategoryFilterState {
  selectedCategories: Set<Category | typeof UNCATEGORIZED>; // Categories user has selected (empty = show all)
  hasInteracted: boolean;
  showArchived: boolean; // Whether to show archived (past) items
}

interface CategoryCount {
  category: Category | typeof UNCATEGORIZED; // Display both real categories and uncategorized
  count: number;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

function isCategory(value: string): value is Category {
  return CATEGORY_SET.has(value);
}

export function computeCategoryCounts(
  availableCategories: Set<Category | typeof UNCATEGORIZED>,
  viewportMessages: Message[],
): CategoryCount[] {
  const counts = new Map<Category | typeof UNCATEGORIZED, number>();

  for (const category of availableCategories) {
    counts.set(category, 0);
  }

  for (const message of viewportMessages) {
    const featureCount = message.geoJson?.features?.length || 1;

    if (
      !message.categories ||
      !Array.isArray(message.categories) ||
      message.categories.length === 0
    ) {
      if (counts.has(UNCATEGORIZED)) {
        counts.set(UNCATEGORIZED, counts.get(UNCATEGORIZED)! + featureCount);
      }
    } else {
      for (const category of message.categories) {
        if (isCategory(category) && counts.has(category)) {
          counts.set(category, counts.get(category)! + featureCount);
        }
      }
    }
  }

  const orderedCounts: CategoryCount[] = CATEGORY_DISPLAY_ORDER.filter((cat) =>
    availableCategories.has(cat),
  ).map((category) => ({
    category,
    count: counts.get(category) || 0,
  }));

  if (availableCategories.has(UNCATEGORIZED)) {
    orderedCounts.push({
      category: UNCATEGORIZED,
      count: counts.get(UNCATEGORIZED) || 0,
    });
  }

  return orderedCounts;
}

export function computeHasActiveFilters(
  selectedCategories: Set<Category | typeof UNCATEGORIZED>,
): boolean {
  return selectedCategories.size > 0;
}

export function toggleCategorySelection(
  current: Set<Category | typeof UNCATEGORIZED>,
  category: Category | typeof UNCATEGORIZED,
): Set<Category | typeof UNCATEGORIZED> {
  const next = new Set(current);
  if (next.has(category)) {
    next.delete(category);
  } else {
    next.add(category);
  }
  return next;
}

function migrateOldFormat(parsed: {
  unselectedCategories?: string[];
  hasInteracted?: boolean;
  showArchived?: boolean;
}): CategoryFilterState {
  const unselectedArray = parsed.unselectedCategories || [];

  // If nothing was unselected in old format, that means "show all"
  // In new format, empty selectedCategories also means "show all"
  if (unselectedArray.length === 0) {
    return {
      selectedCategories: new Set(),
      hasInteracted: parsed.hasInteracted || false,
      showArchived: parsed.showArchived ?? false,
    };
  }

  // Get all available categories to compute the inverse
  const allCategories = [...CATEGORIES, UNCATEGORIZED];

  // Convert unselected to selected (inverse)
  const unselectedSet = new Set(unselectedArray);
  const selectedCategories = allCategories.filter(
    (cat) => !unselectedSet.has(cat),
  );

  return {
    selectedCategories: new Set(selectedCategories),
    hasInteracted: parsed.hasInteracted || false,
    showArchived: parsed.showArchived ?? false,
  };
}

function loadFilterState(): CategoryFilterState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // Default: nothing selected (show all), archived (past items) hidden by default
      return {
        selectedCategories: new Set(),
        hasInteracted: false,
        showArchived: false,
      };
    }
    const parsed = JSON.parse(stored);

    // Check if this is old format (has unselectedCategories)
    if ("unselectedCategories" in parsed && !("selectedCategories" in parsed)) {
      return migrateOldFormat(parsed);
    }

    return {
      selectedCategories: new Set(parsed.selectedCategories || []),
      hasInteracted: parsed.hasInteracted || false,
      showArchived: parsed.showArchived ?? false,
    };
  } catch {
    return {
      selectedCategories: new Set(),
      hasInteracted: false,
      showArchived: false,
    };
  }
}

function saveFilterState(state: CategoryFilterState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedCategories: Array.from(state.selectedCategories),
        hasInteracted: state.hasInteracted,
        showArchived: state.showArchived,
        lastUpdated: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error("Failed to save category filter state:", error);
  }
}

/**
 * Hook for category-based message filtering
 *
 * @param availableCategories - Categories that exist in the database (from /api/categories)
 * @param viewportMessages - Messages in current viewport (used for counting)
 * @param onCategorySelectionChange - Callback when selected categories change
 */
export function useCategoryFilter(
  availableCategories: (Category | typeof UNCATEGORIZED)[],
  viewportMessages: Message[],
  onCategorySelectionChange: (
    selected: Set<Category | typeof UNCATEGORIZED>,
  ) => void,
) {
  const initialFilterState = useMemo(() => loadFilterState(), []);
  // Store which categories the user has SELECTED (empty Set = show all)
  const [selectedCategories, setSelectedCategories] = useState<
    Set<Category | typeof UNCATEGORIZED>
  >(() => initialFilterState.selectedCategories);
  const [hasInteracted, setHasInteracted] = useState<boolean>(
    () => initialFilterState.hasInteracted,
  );
  const [showArchived, setShowArchived] = useState<boolean>(
    () => initialFilterState.showArchived,
  );
  const [isOpen, setIsOpen] = useState<boolean>(
    () => !initialFilterState.hasInteracted,
  );
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [isLoadingCounts, setIsLoadingCounts] = useState<boolean>(false);

  // Save to localStorage when state changes
  useEffect(() => {
    saveFilterState({ selectedCategories, hasInteracted, showArchived });
  }, [selectedCategories, hasInteracted, showArchived]);

  // Convert availableCategories array to Set
  const availableCategoriesSet = useMemo<
    Set<Category | typeof UNCATEGORIZED>
  >(() => {
    return new Set(availableCategories);
  }, [availableCategories]);

  // Notify parent when selected categories change
  useEffect(() => {
    onCategorySelectionChange(selectedCategories);
  }, [selectedCategories, onCategorySelectionChange]);

  // Track loading state when viewportMessages or availableCategories change
  useEffect(() => {
    // Skip initial load - it's handled by isInitialLoad state
    if (isInitialLoad) {
      return;
    }

    // Use a flag to prevent state updates if the component unmounts
    let isMounted = true;

    // Defer loading state to avoid synchronous setState in effect
    Promise.resolve().then(() => {
      if (isMounted) {
        setIsLoadingCounts(true);

        // Keep loading state visible for at least 300ms for better UX
        const timer = setTimeout(() => {
          if (isMounted) {
            setIsLoadingCounts(false);
          }
        }, 300);

        return () => clearTimeout(timer);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [viewportMessages, availableCategoriesSet, isInitialLoad]);

  // Handle initial load separately
  // Categories are static (always available), so we don't need to wait for messages
  // Just show the UI after a brief delay for smooth transition
  useEffect(() => {
    if (isInitialLoad) {
      const timer = setTimeout(() => {
        setIsInitialLoad(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isInitialLoad]);

  // Count features per category - ONLY for viewport messages that match showArchived filter
  const categoryCounts = useMemo<CategoryCount[]>(() => {
    let messagesToCount = viewportMessages;

    // Filter messages based on showArchived toggle
    if (!showArchived) {
      // Only count active (non-archived) messages
      messagesToCount = viewportMessages.filter(
        (message) => classifyMessage(message) === "active",
      );
    }

    return computeCategoryCounts(availableCategoriesSet, messagesToCount);
  }, [availableCategoriesSet, viewportMessages, showArchived]);

  // Check if filters are active (something is selected)
  // Red dot shows when ANY category is checked (not in default "show all" state) or archived is shown
  const hasActiveFilters = useMemo<boolean>(() => {
    return computeHasActiveFilters(selectedCategories) || showArchived;
  }, [selectedCategories, showArchived]);

  // Toggle a single category's selection state
  // IMPORTANT: Only modifies the toggled category in localStorage, preserving all others
  // Example flow:
  // 1. Default state: selectedCategories = [] → shows all messages
  // 2. User selects "heating" → stores ["heating"] → filters to only heating messages
  // 3. User selects "water" → stores ["heating", "water"] → filters to heating OR water
  // 4. User unselects "heating" → stores ["water"] → filters to only water
  // 5. User unselects "water" → stores [] → shows all messages again
  const toggleCategory = useCallback(
    (category: Category | typeof UNCATEGORIZED) => {
      setSelectedCategories((prev) => toggleCategorySelection(prev, category));
    },
    [],
  );

  const openPanel = useCallback(() => {
    setIsOpen(true);
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  }, [hasInteracted]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  }, [hasInteracted]);

  const togglePanel = useCallback(() => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }, [isOpen, openPanel, closePanel]);

  const toggleShowArchived = useCallback(() => {
    setShowArchived((prev) => !prev);
  }, []);

  const clearAllCategories = useCallback(() => {
    setSelectedCategories(new Set());
    setShowArchived(false);
  }, []);

  return {
    categoryCounts,
    selectedCategories,
    hasActiveFilters,
    isOpen,
    isInitialLoad,
    isLoadingCounts,
    showArchived,
    toggleCategory,
    toggleShowArchived,
    clearAllCategories,
    openPanel,
    closePanel,
    togglePanel,
  };
}
