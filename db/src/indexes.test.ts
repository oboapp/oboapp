import { describe, expect, it } from "vitest";

import { INDEX_DEFINITIONS } from "./indexes";

describe("INDEX_DEFINITIONS", () => {
  const expectedMessageIndexes = [
    {
      name: "locality_timespanEnd_finalizedAt",
      spec: { locality: 1, timespanEnd: 1, finalizedAt: -1 },
    },
    {
      name: "locality_categories_timespanEnd_finalizedAt",
      spec: { locality: 1, categories: 1, timespanEnd: 1, finalizedAt: -1 },
    },
    {
      name: "locality_cityWide_timespanEnd_finalizedAt",
      spec: { locality: 1, cityWide: 1, timespanEnd: 1, finalizedAt: -1 },
    },
    {
      name: "locality_finalizedAt_crawledAt",
      spec: { locality: 1, finalizedAt: -1, crawledAt: -1 },
    },
  ];

  it("includes message indexes used by locality-scoped public consumers", () => {
    for (const expected of expectedMessageIndexes) {
      const index = INDEX_DEFINITIONS.find(
        (definition) =>
          definition.collection === "messages" &&
          definition.options?.name === expected.name,
      );

      expect(index?.spec).toEqual(expected.spec);
    }
  });

  it("does not reuse an index name within the same collection", () => {
    const seen = new Set<string>();

    for (const definition of INDEX_DEFINITIONS) {
      const name = definition.options?.name;
      if (!name) {
        continue;
      }

      const key = `${definition.collection}:${name}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
