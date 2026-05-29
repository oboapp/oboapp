import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  computeCategoryCounts,
  computeHasActiveFilters,
  toggleCategorySelection,
  useCategoryFilter,
} from "./useCategoryFilter";
import { Category, UNCATEGORIZED } from "@oboapp/shared";
import { Message } from "@/lib/types";

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const buildFeatureCollection = (count: number) => ({
  type: "FeatureCollection" as const,
  features: Array.from({ length: count }, (_, index) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [0, 0] as [number, number],
    },
    properties: { index },
  })),
});

const buildMessage = (overrides: Partial<Message>): Message => ({
  text: "Test message",
  createdAt: new Date().toISOString(),
  locality: "bg.sofia",
  ...overrides,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("useCategoryFilter helpers", () => {
  describe("computeCategoryCounts", () => {
    it("counts features per category and orders output", () => {
      const available = new Set<Category | typeof UNCATEGORIZED>([
        "water",
        "traffic",
        UNCATEGORIZED,
      ]);
      const viewportMessages: Message[] = [
        buildMessage({
          categories: ["water"],
          geoJson: buildFeatureCollection(2),
        }),
        buildMessage({
          categories: ["traffic", "water"],
          geoJson: buildFeatureCollection(1),
        }),
        buildMessage({
          geoJson: buildFeatureCollection(3),
        }),
      ];

      const counts = computeCategoryCounts(available, viewportMessages);

      expect(counts).toEqual([
        { category: "water", count: 3 },
        { category: "traffic", count: 1 },
        { category: UNCATEGORIZED, count: 3 },
      ]);
    });
  });

  describe("computeHasActiveFilters", () => {
    it("returns false when no categories are selected (show all)", () => {
      const selected = new Set<Category | typeof UNCATEGORIZED>();

      expect(computeHasActiveFilters(selected)).toBe(false);
    });

    it("returns true when at least one category is selected", () => {
      const selected = new Set<Category | typeof UNCATEGORIZED>([
        "water",
        UNCATEGORIZED,
      ]);

      expect(computeHasActiveFilters(selected)).toBe(true);
    });
  });

  describe("toggleCategorySelection", () => {
    it("removes a category when already selected", () => {
      const current = new Set<Category | typeof UNCATEGORIZED>([
        "water",
        "traffic",
      ]);

      const next = toggleCategorySelection(current, "traffic");

      expect(Array.from(next).sort(compareStrings)).toEqual(
        ["water"].sort(compareStrings),
      );
      expect(Array.from(current).sort(compareStrings)).toEqual(
        ["traffic", "water"].sort(compareStrings),
      );
    });

    it("adds a category when not selected", () => {
      const current = new Set<Category | typeof UNCATEGORIZED>(["water"]);

      const next = toggleCategorySelection(current, UNCATEGORIZED);

      expect(Array.from(next).sort(compareStrings)).toEqual(
        ["water", UNCATEGORIZED].sort(compareStrings),
      );
    });
  });
});

describe("useCategoryFilter hook", () => {
  const availableCategories: (Category | typeof UNCATEGORIZED)[] = [
    "water",
    "traffic",
    "heating",
    UNCATEGORIZED,
  ];
  const viewportMessages: Message[] = [
    buildMessage({ categories: ["water"], geoJson: buildFeatureCollection(1) }),
  ];

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("clearAllCategories", () => {
    it("clears all selected categories", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Select some categories first
      act(() => {
        result.current.toggleCategory("water");
      });
      act(() => {
        result.current.toggleCategory("traffic");
      });

      expect(result.current.selectedCategories.size).toBe(2);
      expect(result.current.hasActiveFilters).toBe(true);

      // Clear all
      act(() => {
        result.current.clearAllCategories();
      });

      expect(result.current.selectedCategories.size).toBe(0);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("also resets showArchived to false", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Enable showArchived
      act(() => {
        result.current.toggleShowArchived();
      });

      expect(result.current.showArchived).toBe(true);
      expect(result.current.hasActiveFilters).toBe(true);

      // Clear all should also reset showArchived
      act(() => {
        result.current.clearAllCategories();
      });

      expect(result.current.showArchived).toBe(false);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("clears both categories and showArchived together", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Select categories and enable showArchived
      act(() => {
        result.current.toggleCategory("water");
        result.current.toggleShowArchived();
      });

      expect(result.current.selectedCategories.size).toBe(1);
      expect(result.current.showArchived).toBe(true);
      expect(result.current.hasActiveFilters).toBe(true);

      // Clear all
      act(() => {
        result.current.clearAllCategories();
      });

      expect(result.current.selectedCategories.size).toBe(0);
      expect(result.current.showArchived).toBe(false);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("updates localStorage after clearing", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Select a category
      act(() => {
        result.current.toggleCategory("water");
      });

      // Clear all
      act(() => {
        result.current.clearAllCategories();
      });

      // Check localStorage was updated
      const lastCall =
        localStorageMock.setItem.mock.calls[
          localStorageMock.setItem.mock.calls.length - 1
        ];
      const savedState = JSON.parse(lastCall[1]);

      expect(savedState.selectedCategories).toEqual([]);
      expect(savedState.showArchived).toBe(false);
    });

    it("notifies parent of category selection change", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Select a category
      act(() => {
        result.current.toggleCategory("water");
      });

      // Clear call count to focus on clearAllCategories
      onCategorySelectionChange.mockClear();

      // Clear all
      act(() => {
        result.current.clearAllCategories();
      });

      // Parent should be notified with empty set
      expect(onCategorySelectionChange).toHaveBeenCalled();
      const lastCallArg =
        onCategorySelectionChange.mock.calls[
          onCategorySelectionChange.mock.calls.length - 1
        ][0];
      expect(lastCallArg.size).toBe(0);
    });
  });

  describe("hasActiveFilters", () => {
    it("returns false when no categories selected and showArchived is false", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("returns true when categories are selected", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      act(() => {
        result.current.toggleCategory("water");
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("returns true when showArchived is true even with no categories selected", () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      act(() => {
        result.current.toggleShowArchived();
      });

      expect(result.current.selectedCategories.size).toBe(0);
      expect(result.current.hasActiveFilters).toBe(true);
    });
  });

  describe("localStorage migration", () => {
    it("migrates old format with empty unselectedCategories to empty selectedCategories (show all)", () => {
      // Set up old format in localStorage - empty unselectedCategories means "show all"
      localStorageMock.setItem(
        "categoryFilter",
        JSON.stringify({
          unselectedCategories: [],
          hasInteracted: true,
          showArchived: false,
        }),
      );

      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Empty selectedCategories means "show all" in new format
      expect(result.current.selectedCategories.size).toBe(0);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("migrates old format with some unselected categories to inverse selection", () => {
      // Set up old format - "water" and "traffic" were unselected (hidden)
      localStorageMock.setItem(
        "categoryFilter",
        JSON.stringify({
          unselectedCategories: ["water", "traffic"],
          hasInteracted: true,
          showArchived: true,
        }),
      );

      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // In old format, unselected ["water", "traffic"] means only "heating" and "uncategorized" were visible
      // In new format, this should become selectedCategories containing everything EXCEPT water and traffic
      expect(result.current.selectedCategories.has("water")).toBe(false);
      expect(result.current.selectedCategories.has("traffic")).toBe(false);
      expect(result.current.selectedCategories.has("heating")).toBe(true);
      expect(result.current.selectedCategories.has(UNCATEGORIZED)).toBe(true);
      expect(result.current.showArchived).toBe(true);
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("loads new format selectedCategories directly without migration", () => {
      // Set up new format in localStorage
      localStorageMock.setItem(
        "categoryFilter",
        JSON.stringify({
          selectedCategories: ["water", "heating"],
          hasInteracted: true,
          showArchived: false,
        }),
      );

      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Should load exactly what was stored
      expect(result.current.selectedCategories.size).toBe(2);
      expect(result.current.selectedCategories.has("water")).toBe(true);
      expect(result.current.selectedCategories.has("heating")).toBe(true);
      expect(result.current.selectedCategories.has("traffic")).toBe(false);
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("handles missing localStorage gracefully with default state", () => {
      // localStorage returns null (no stored state)
      localStorageMock.getItem.mockReturnValueOnce(null);

      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Default: empty selectedCategories (show all), showArchived false
      expect(result.current.selectedCategories.size).toBe(0);
      expect(result.current.showArchived).toBe(false);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("handles corrupted localStorage gracefully with default state", () => {
      // Set up invalid JSON in localStorage
      localStorageMock.setItem("categoryFilter", "not valid json{{{");

      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          viewportMessages,
          onCategorySelectionChange,
        ),
      );

      // Should fall back to defaults
      expect(result.current.selectedCategories.size).toBe(0);
      expect(result.current.showArchived).toBe(false);
      expect(result.current.hasActiveFilters).toBe(false);
    });
  });

  describe("isInitialLoad", () => {
    it("becomes false after 300ms even with empty viewport messages (zero results scenario)", async () => {
      const onCategorySelectionChange = vi.fn();

      const { result } = renderHook(() =>
        useCategoryFilter(
          availableCategories,
          [], // Empty messages - simulates filters resulting in zero records
          onCategorySelectionChange,
        ),
      );

      // Should start with isInitialLoad = true
      expect(result.current.isInitialLoad).toBe(true);

      // Wait for the 300ms delay
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });

      // Should now be false - categories are static and don't need messages to display
      expect(result.current.isInitialLoad).toBe(false);
    });
  });
});
