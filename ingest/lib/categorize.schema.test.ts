import { describe, it, expect } from "vitest";
import {
  CategorizationResponseSchema,
  type CategorizationResult,
  type Category,
} from "./categorize.schema";
import { CategoryEnum } from "@oboapp/shared";

describe("CategorizationResponseSchema", () => {
  describe("valid inputs", () => {
    it("should validate a categories array", () => {
      const input = { categories: ["water", "traffic"] };
      const result = CategorizationResponseSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ categories: ["water", "traffic"] });
      }
    });

    it("should validate an empty categories array", () => {
      const result = CategorizationResponseSchema.safeParse({ categories: [] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual([]);
      }
    });

    it("should validate all category enum values", () => {
      const allCategories: Category[] = [
        "air-quality",
        "art",
        "bicycles",
        "construction-and-repairs",
        "culture",
        "education",
        "electricity",
        "health",
        "heating",
        "parking",
        "public-transport",
        "road-block",
        "sports",
        "traffic",
        "vehicles",
        "waste",
        "water",
        "weather",
      ];

      const result = CategorizationResponseSchema.safeParse({
        categories: allCategories,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(allCategories);
      }
    });

    it("should validate a single category", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: ["parking"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(["parking"]);
      }
    });
  });

  describe("normalizeCategoriesInput preprocessing", () => {
    it("should parse a JSON array string", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: '["water", "traffic"]',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(["water", "traffic"]);
      }
    });

    it("should split a comma-separated string", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: "water, traffic",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(["water", "traffic"]);
      }
    });

    it("should convert a whitespace-only string to an empty array", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: "   ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual([]);
      }
    });

    it("should treat a single non-comma string as a one-element array", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: "water",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(["water"]);
      }
    });

    it("should trim whitespace from array elements", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: [" water ", " traffic "],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toEqual(["water", "traffic"]);
      }
    });
  });

  describe("invalid inputs", () => {
    it("should reject an invalid category value", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: ["invalid-category"],
      });
      expect(result.success).toBe(false);
    });

    it("should reject a mix of valid and invalid categories", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: ["water", "not-a-category"],
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-string elements in the array", () => {
      const result = CategorizationResponseSchema.safeParse({
        categories: [123, true],
      });
      expect(result.success).toBe(false);
    });

    it("should reject null input", () => {
      expect(CategorizationResponseSchema.safeParse(null).success).toBe(false);
    });

    it("should reject undefined input", () => {
      expect(CategorizationResponseSchema.safeParse(undefined).success).toBe(
        false,
      );
    });

    it("should reject missing categories field", () => {
      expect(CategorizationResponseSchema.safeParse({}).success).toBe(false);
    });

    it("should reject an array at the root level", () => {
      const result = CategorizationResponseSchema.safeParse([
        { categories: ["water"] },
      ]);
      expect(result.success).toBe(false);
    });
  });

  describe("type: CategorizationResult", () => {
    it("should be assignable from a parsed result", () => {
      const result = CategorizationResponseSchema.parse({
        categories: ["water", "heating"],
      });
      const typed: CategorizationResult = result;
      expect(typed.categories).toEqual(["water", "heating"]);
    });
  });

  describe("CategoryEnum", () => {
    it("should contain all expected category values", () => {
      const expectedCategories = [
        "air-quality",
        "art",
        "bicycles",
        "construction-and-repairs",
        "culture",
        "education",
        "electricity",
        "health",
        "heating",
        "parking",
        "public-transport",
        "road-block",
        "sports",
        "traffic",
        "vehicles",
        "waste",
        "water",
        "weather",
      ];

      expect(CategoryEnum.options).toEqual(expectedCategories);
    });

    it("should validate individual category values", () => {
      expect(CategoryEnum.safeParse("water").success).toBe(true);
      expect(CategoryEnum.safeParse("invalid-category").success).toBe(false);
    });
  });
});
