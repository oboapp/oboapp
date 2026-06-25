import { describe, beforeEach, afterAll, it, expect, vi } from "vitest";
import { shouldApplyAggressiveCache } from "./messages";

describe("messages route pure helpers", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("applies aggressive cache only for unbound request shape", () => {
    expect(
      shouldApplyAggressiveCache({
        hasCategoryFilter: false,
        hasSourceFilter: false,
        hasViewport: false,
      }),
    ).toBe(true);

    expect(
      shouldApplyAggressiveCache({
        hasCategoryFilter: true,
        hasSourceFilter: false,
        hasViewport: false,
      }),
    ).toBe(false);

    expect(
      shouldApplyAggressiveCache({
        hasCategoryFilter: false,
        hasSourceFilter: false,
        hasViewport: false,
        limit: 25,
      }),
    ).toBe(false);
  });
});
