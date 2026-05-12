import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtractedLocations } from "@/lib/extract-locations.schema";
import type { CategorizationResult } from "@/lib/categorize.schema";
import type { FilterSplitResult } from "@/lib/filter-split.schema";
import type { SummarizeResult } from "@/lib/summarize.schema";

interface FixtureMap {
  [key: string]: any;
}

export class GeminiMockService {
  private filterSplitFixtures: FixtureMap = {};
  private categorizeFixtures: FixtureMap = {};
  private extractFixtures: FixtureMap = {};
  private customFixturePath: string | null = null;

  constructor() {
    this.loadFixtures();
    this.customFixturePath = process.env.GEMINI_FIXTURE_PATH || null;
  }

  private loadFixtures(): void {
    const fixtureDir = join(__dirname, "../fixtures/gemini");

    try {
      this.filterSplitFixtures = {
        water: JSON.parse(
          readFileSync(join(fixtureDir, "filter-split-water.json"), "utf-8"),
        ),
        traffic: JSON.parse(
          readFileSync(join(fixtureDir, "filter-split-traffic.json"), "utf-8"),
        ),
        construction: JSON.parse(
          readFileSync(
            join(fixtureDir, "filter-split-construction.json"),
            "utf-8",
          ),
        ),
        irrelevant: JSON.parse(
          readFileSync(
            join(fixtureDir, "filter-split-irrelevant.json"),
            "utf-8",
          ),
        ),
      };

      this.categorizeFixtures = {
        water: JSON.parse(
          readFileSync(
            join(fixtureDir, "categorize-water-disruption.json"),
            "utf-8",
          ),
        ),
        traffic: JSON.parse(
          readFileSync(
            join(fixtureDir, "categorize-traffic-block.json"),
            "utf-8",
          ),
        ),
        construction: JSON.parse(
          readFileSync(
            join(fixtureDir, "categorize-construction.json"),
            "utf-8",
          ),
        ),
      };

      this.extractFixtures = {
        pins: JSON.parse(
          readFileSync(join(fixtureDir, "extract-pins-streets.json"), "utf-8"),
        ),
        cadastral: JSON.parse(
          readFileSync(join(fixtureDir, "extract-cadastral.json"), "utf-8"),
        ),
      };
    } catch (error) {
      console.warn("[GeminiMockService] Failed to load fixtures:", error);
    }
  }

  private matchPattern(text: string): string {
    const lowerText = text.toLowerCase();

    if (lowerText.includes("вод") || lowerText.includes("water")) {
      return "water";
    }
    if (
      lowerText.includes("движение") ||
      lowerText.includes("трафик") ||
      lowerText.includes("traffic")
    ) {
      return "traffic";
    }
    if (
      lowerText.includes("ремонт") ||
      lowerText.includes("строителст") ||
      lowerText.includes("construction")
    ) {
      return "construction";
    }
    return "irrelevant"; // default fallback for unmatched patterns
  }

  async filterAndSplit(text: string): Promise<FilterSplitResult | null> {
    if (this.customFixturePath) {
      return JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
    }

    const pattern = this.matchPattern(text);
    return this.filterSplitFixtures[pattern] ?? null;
  }

  async categorize(text: string): Promise<CategorizationResult | null> {
    if (this.customFixturePath) {
      return JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
    }

    const pattern = this.matchPattern(text);
    // Irrelevant messages skip categorization stage
    if (pattern === "irrelevant") {
      return null;
    }
    return this.categorizeFixtures[pattern] ?? null;
  }

  async extractLocations(text: string): Promise<ExtractedLocations | null> {
    if (this.customFixturePath) {
      return JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
    }

    const pattern = this.matchPattern(text);
    // Irrelevant messages skip extraction stage
    if (pattern === "irrelevant") {
      return null;
    }

    const lowerText = text.toLowerCase();

    if (
      lowerText.includes("упи") ||
      lowerText.includes("кв.") ||
      lowerText.includes("cadastral")
    ) {
      return this.extractFixtures.cadastral ?? null;
    }

    // Default to pins and streets
    return this.extractFixtures.pins ?? null;
  }

  async summarize(text: string): Promise<SummarizeResult | null> {
    if (this.customFixturePath) {
      return JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
    }

    return {
      summary: `Резюме: ${text.slice(0, 50)}...`,
    };
  }
}
