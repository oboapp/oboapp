import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "./cosine-similarity";

describe("cosineSimilarity", () => {
  it("identical vectors → 1.0", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("opposite vectors → -1.0", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("orthogonal vectors → 0.0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("different lengths → 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("empty vectors → 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("one empty vector → 0", () => {
    expect(cosineSimilarity([1, 2, 3], [])).toBe(0);
  });

  it("zero vector → 0 (no division by zero)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("similar but not identical → high positive", () => {
    const a = [1, 2, 3, 4];
    const b = [1.1, 2.1, 3.1, 4.1];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.99);
    expect(sim).toBeLessThan(1.0);
  });
});
