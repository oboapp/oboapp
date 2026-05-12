import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/lib/logger";
import { applyLocalityContext } from "@/lib/locality-context";
import { hasCode } from "@/lib/record-fields";

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
      hasCode(error) && typeof error.code === "string"
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
 * Cache of loaded prompt templates, keyed by filename.
 */
const promptCache: Record<string, string> = {};

function getCachedPrompt(promptFile: string): string {
  if (!promptCache[promptFile]) {
    promptCache[promptFile] = loadPrompt(promptFile);
  }
  return promptCache[promptFile];
}

/** Gets the filter & split prompt template (cached) — Step 1 */
export const getFilterSplitPrompt = (): string => getCachedPrompt("filter-split.md");

/** Gets the categorization prompt template (cached) — Step 2 */
export const getCategorizePrompt = (): string => getCachedPrompt("categorize.md");

/** Gets the location extraction prompt template (cached) — Step 3 */
export const getExtractLocationsPrompt = (): string => getCachedPrompt("extract-locations.md");

/** Gets the summarization prompt template (cached) */
export const getSummarizePrompt = (): string => getCachedPrompt("summarize.md");
