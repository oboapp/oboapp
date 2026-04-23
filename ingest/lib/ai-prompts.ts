import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/lib/logger";
import { applyLocalityContext } from "@/lib/locality-context";

/**
 * Loads a prompt template from the prompts directory and applies locality substitution.
 */
export function loadPrompt(filename: string): string {
  try {
    const template = readFileSync(
      join(process.cwd(), "prompts", filename),
      "utf-8",
    );
    return applyLocalityContext(template);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;

    logger.error("Failed to load prompt template", {
      filename,
      error: errorMessage,
      code: errorCode,
    });

    if (errorCode === "ENOENT") {
      throw new Error(`Prompt template file not found: ${filename}`, {
        cause: error,
      });
    }

    throw new Error(
      `Prompt template could not be loaded: ${filename}. ${errorMessage}`,
      { cause: error },
    );
  }
}

/**
 * Cached prompt templates
 */
let filterSplitPromptCache: string | null = null;
let categorizePromptCache: string | null = null;
let extractLocationsPromptCache: string | null = null;

/**
 * Gets the filter & split prompt template (cached) — Step 1
 */
export function getFilterSplitPrompt(): string {
  if (!filterSplitPromptCache) {
    filterSplitPromptCache = loadPrompt("filter-split.md");
  }
  return filterSplitPromptCache;
}

/**
 * Gets the categorization prompt template (cached) — Step 2
 */
export function getCategorizePrompt(): string {
  if (!categorizePromptCache) {
    categorizePromptCache = loadPrompt("categorize.md");
  }
  return categorizePromptCache;
}

/**
 * Gets the location extraction prompt template (cached) — Step 3
 */
export function getExtractLocationsPrompt(): string {
  if (!extractLocationsPromptCache) {
    extractLocationsPromptCache = loadPrompt("extract-locations.md");
  }
  return extractLocationsPromptCache;
}
