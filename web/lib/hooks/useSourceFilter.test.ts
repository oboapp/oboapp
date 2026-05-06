import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  computeSourceCounts,
  computeHasActiveSourceFilters,
  toggleSourceSelection,
} from "./useSourceFilter";
import { Message } from "@/lib/types";

// Mock sources so computeSourceCounts is independent of the upstream SOURCES
// assembly (which may be a minimal demo set without all Sofia-specific sources).
vi.mock("@/lib/sources", () => ({
  default: [
    { id: "sofia-bg", url: "https://sofia.bg", name: "Столична община", localities: ["bg.sofia"] },
    { id: "toplo-bg", url: "https://toplo.bg", name: "Топлофикация", localities: ["bg.sofia"] },
    { id: "erm-zapad", url: "https://erm.bg", name: "ЧЕЗ Разпределение", localities: ["bg.sofia"] },
  ],
}));

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

describe("useSourceFilter helpers", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("computeSourceCounts", () => {
    beforeEach(() => {
      // Set NEXT_PUBLIC_LOCALITY for tests
      process.env.NEXT_PUBLIC_LOCALITY = "bg.sofia";
    });

    afterEach(() => {
      // Clean up
      delete process.env.NEXT_PUBLIC_LOCALITY;
    });

    it("counts features per source and sorts by name", () => {
      const viewportMessages: Message[] = [
        buildMessage({
          source: "sofia-bg",
          geoJson: buildFeatureCollection(2),
        }),
        buildMessage({
          source: "toplo-bg",
          geoJson: buildFeatureCollection(1),
        }),
        buildMessage({
          source: "sofia-bg",
          geoJson: buildFeatureCollection(3),
        }),
      ];

      const counts = computeSourceCounts(viewportMessages);

      // Find sofia-bg and toplo-bg in results
      const sofiaBg = counts.find((c) => c.sourceId === "sofia-bg");
      const toploBg = counts.find((c) => c.sourceId === "toplo-bg");

      expect(sofiaBg).toBeDefined();
      expect(sofiaBg?.count).toBe(5);
      expect(toploBg).toBeDefined();
      expect(toploBg?.count).toBe(1);

      // Verify sorting by name (Bulgarian locale)
      if (counts.length >= 2) {
        expect(
          counts[0].name.localeCompare(counts[1].name, "bg"),
        ).toBeLessThanOrEqual(0);
      }
    });

    it("returns ALL sources for locality including those with zero counts", () => {
      const viewportMessages: Message[] = [
        buildMessage({
          source: "sofia-bg",
          geoJson: buildFeatureCollection(1),
        }),
      ];

      const counts = computeSourceCounts(viewportMessages);

      // Should include ALL sources for the locality, not just those with records
      expect(counts.length).toBeGreaterThan(1);

      // Sofia-bg should have count of 1
      const sofiaBg = counts.find((c) => c.sourceId === "sofia-bg");
      expect(sofiaBg).toBeDefined();
      expect(sofiaBg?.count).toBe(1);

      // Other sources should have count of 0
      const otherSources = counts.filter((c) => c.sourceId !== "sofia-bg");
      expect(otherSources.length).toBeGreaterThan(0);
      expect(otherSources.every((c) => c.count === 0)).toBe(true);
    });

    it("handles messages without source", () => {
      const viewportMessages: Message[] = [
        buildMessage({
          geoJson: buildFeatureCollection(1),
        }),
      ];

      const counts = computeSourceCounts(viewportMessages);

      // All sources should have count of 0
      expect(counts.length).toBeGreaterThan(0);
      expect(counts.every((c) => c.count === 0)).toBe(true);
    });
  });

  describe("computeHasActiveSourceFilters", () => {
    it("returns false when no sources are selected (show all)", () => {
      const selected = new Set<string>();

      expect(computeHasActiveSourceFilters(selected)).toBe(false);
    });

    it("returns true when at least one source is selected", () => {
      const selected = new Set<string>(["sofia-bg", "toplo-bg"]);

      expect(computeHasActiveSourceFilters(selected)).toBe(true);
    });
  });

  describe("toggleSourceSelection", () => {
    it("removes a source when already selected", () => {
      const current = new Set<string>(["sofia-bg", "toplo-bg"]);

      const next = toggleSourceSelection(current, "sofia-bg");

      expect(next.has("sofia-bg")).toBe(false);
      expect(next.has("toplo-bg")).toBe(true);
    });

    it("adds a source when not selected", () => {
      const current = new Set<string>(["sofia-bg"]);

      const next = toggleSourceSelection(current, "toplo-bg");

      expect(next.has("sofia-bg")).toBe(true);
      expect(next.has("toplo-bg")).toBe(true);
    });

    it("does not mutate the original set", () => {
      const current = new Set<string>(["sofia-bg"]);

      const next = toggleSourceSelection(current, "toplo-bg");

      expect(current.has("toplo-bg")).toBe(false);
      expect(next.has("toplo-bg")).toBe(true);
    });
  });
});
