import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test the schema validation logic for the 3-step pipeline
describe("AI service schema validation", () => {
  let originalEnv: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_AI_MODEL = "gemini-1.5-flash";
    process.env.GOOGLE_AI_API_KEY = "mock-api-key";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe("FilterSplitResponseSchema", () => {
    it("should validate valid filter & split response", async () => {
      const { FilterSplitResponseSchema } =
        await import("./filter-split.schema");

      const mockResponse = [
        {
          plainText: "Спиране на водоснабдяването.",
          isOneOfMany: false,
          isInformative: true,
          isRelevant: true,
          responsibleEntity: "Софийска вода",
          markdownText: "**Спиране на водоснабдяването.**",
        },
      ];

      const result = FilterSplitResponseSchema.safeParse(mockResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].plainText).toBe("Спиране на водоснабдяването.");
        expect(result.data[0].isRelevant).toBe(true);
        expect(result.data[0].isInformative).toBe(true);
        expect(result.data[0].isOneOfMany).toBe(false);
      }
    });

    it("should default optional fields", async () => {
      const { FilterSplitResponseSchema } =
        await import("./filter-split.schema");

      const result = FilterSplitResponseSchema.safeParse([
        {
          plainText: "Test",
          isOneOfMany: false,
          isInformative: false,
          isRelevant: false,
        },
      ]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].responsibleEntity).toBe("");
        expect(result.data[0].markdownText).toBe("");
      }
    });
  });

  describe("CategorizationResponseSchema", () => {
    it("should validate valid categorization response", async () => {
      const { CategorizationResponseSchema } =
        await import("./categorize.schema");

      const result = CategorizationResponseSchema.safeParse({
        categories: ["water", "construction-and-repairs"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categories).toContain("water");
        expect(result.data.categories).toContain("construction-and-repairs");
      }
    });

    it("should reject invalid categories", async () => {
      const { CategorizationResponseSchema } =
        await import("./categorize.schema");

      const result = CategorizationResponseSchema.safeParse({
        categories: ["invalid-category"],
      });
      expect(result.success).toBe(false);
    });

    it("should validate all predefined categories", async () => {
      const { CategorizationResponseSchema } =
        await import("./categorize.schema");

      const allCategories = [
        "air-quality",
        "art",
        "bicycles",
        "construction-and-repairs",
        "culture",
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
        expect(result.data.categories).toHaveLength(17);
      }
    });
  });

  describe("ExtractedLocationsSchema", () => {
    it("should validate valid extraction response", async () => {
      const { ExtractedLocationsSchema } =
        await import("./extract-locations.schema");

      const mockResponse = {
        withSpecificAddress: true,
        busStops: ["0001"],
        cityWide: false,
        pins: [
          {
            address: "бул. Витоша 1",
            timespans: [{ start: "01.01.2026 08:00", end: "01.01.2026 12:00" }],
          },
        ],
        streets: [],
        cadastralProperties: [],
      };

      const result = ExtractedLocationsSchema.safeParse(mockResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.withSpecificAddress).toBe(true);
        expect(result.data.pins).toHaveLength(1);
        expect(result.data.pins[0].address).toBe("бул. Витоша 1");
      }
    });

    it("should default array fields", async () => {
      const { ExtractedLocationsSchema } =
        await import("./extract-locations.schema");

      const result = ExtractedLocationsSchema.safeParse({
        withSpecificAddress: false,
        cityWide: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.busStops).toEqual([]);
        expect(result.data.pins).toEqual([]);
        expect(result.data.streets).toEqual([]);
        expect(result.data.cadastralProperties).toEqual([]);
      }
    });
  });
});

describe("summarize()", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GOOGLE_AI_MODEL = "gemini-1.5-flash";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    delete process.env.MOCK_GEMINI_API;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for text shorter than default threshold (1000)", async () => {
    delete process.env.SUMMARIZE_MIN_LENGTH;
    const { summarize } = await import("./ai-service");
    const result = await summarize("x".repeat(999));
    expect(result).toBeNull();
  });

  it("returns null for text exactly at threshold (strict less-than check)", async () => {
    process.env.SUMMARIZE_MIN_LENGTH = "50";
    const { summarize } = await import("./ai-service");
    const result = await summarize("x".repeat(49));
    expect(result).toBeNull();
  });

  it("calls API and returns parsed summary when text meets threshold", async () => {
    process.env.SUMMARIZE_MIN_LENGTH = "10";
    vi.doMock("./ai-client", () => ({
      callGeminiApi: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ summary: "Резюме: кратко описание." }),
        ),
    }));
    const { summarize } = await import("./ai-service");
    const result = await summarize("x".repeat(11));
    expect(result).toEqual({ summary: "Резюме: кратко описание." });
  });

  it("calls API when SUMMARIZE_MIN_LENGTH=0 even for very short text", async () => {
    process.env.SUMMARIZE_MIN_LENGTH = "0";
    vi.doMock("./ai-client", () => ({
      callGeminiApi: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ summary: "Кратко." })),
    }));
    const { summarize } = await import("./ai-service");
    const result = await summarize("hi");
    expect(result).toEqual({ summary: "Кратко." });
  });

  it("returns null when the Gemini API call returns null", async () => {
    process.env.SUMMARIZE_MIN_LENGTH = "10";
    vi.doMock("./ai-client", () => ({
      callGeminiApi: vi.fn().mockResolvedValue(null),
    }));
    const { summarize } = await import("./ai-service");
    const result = await summarize("x".repeat(11));
    expect(result).toBeNull();
  });

  it("exports SUMMARIZE_MIN_LENGTH parsed from env", async () => {
    process.env.SUMMARIZE_MIN_LENGTH = "500";
    const { SUMMARIZE_MIN_LENGTH } = await import("./ai-service");
    expect(SUMMARIZE_MIN_LENGTH).toBe(500);
  });

  it("defaults SUMMARIZE_MIN_LENGTH to 1000 when env is not a number", async () => {
    process.env.SUMMARIZE_MIN_LENGTH = "not-a-number";
    const { SUMMARIZE_MIN_LENGTH } = await import("./ai-service");
    expect(SUMMARIZE_MIN_LENGTH).toBe(1000);
  });
});
