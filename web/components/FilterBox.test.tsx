import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Category } from "@oboapp/shared";
import FilterBox from "./FilterBox";

it("announces category and source counts once, only while the panel is open", async () => {
  const props = {
    selectedCategories: new Set<Category>(),
    selectedSources: new Set<string>(),
    categoryCounts: [],
    sourceCounts: [],
    hasActiveFilters: false,
    hasActiveCategoryFilters: false,
    hasActiveSourceFilters: false,
    isInitialLoad: false,
    showArchived: false,
    onTogglePanel: vi.fn(),
    onToggleCategory: vi.fn(),
    onToggleSource: vi.fn(),
    onToggleShowArchived: vi.fn(),
    onClearAllFilters: vi.fn(),
  };
  const { rerender } = render(
    <FilterBox {...props} isOpen={false} isLoadingCounts />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  rerender(<FilterBox {...props} isOpen isLoadingCounts />);
  const status = screen.getByRole("status");
  await waitFor(() => {
    expect(status).toHaveTextContent("Броят съобщения по категории и източници се обновява.");
  });

  rerender(<FilterBox {...props} isOpen isLoadingCounts={false} />);
  await waitFor(() => {
    expect(status).toHaveTextContent("Обновяването на филтрите приключи.");
  });
});
