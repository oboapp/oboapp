import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/lib/logger";
import { applyLocalityContext } from "@/lib/locality-context";
import { hasCode } from "@/lib/record-fields";

/**
 * Runtime context injected into every LLM system prompt.
 * Provides the LLM with the crawl date and source identity so it can
 * correctly infer missing years and understand the provenance of the text.
 */
export interface PromptContext {
  /** Date the source document was crawled — used as "today" for year inference. */
  currentDate: Date;
  /** Crawler / source identifier (e.g. "sdvr-mvr-bg"). */
  sourceType?: string;
  /** Base URL of the source (e.g. "https://www.mvr.bg/sdvr/…"). */
  sourceUrl?: string;
}

/** Fallback context used when no crawl metadata is available (e.g. CLI tools). */
const DEFAULT_PROMPT_CONTEXT: PromptContext = { currentDate: new Date() };

export function buildPromptExtras(ctx: PromptContext): Record<string, string> {
  const d = ctx.currentDate;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return {
    "{{CURRENT_DATE}}": `${day}.${month}.${year}`,
    "{{SOURCE_NAME}}": ctx.sourceType ?? "",
    "{{SOURCE_URL}}": ctx.sourceUrl ?? "",
  };
}

/**
 * Cache of raw prompt file contents (before placeholder substitution).
 * Locality and dynamic substitutions are applied fresh on every call.
 */
const rawPromptCache: Record<string, string> = {};

function getRawPromptContent(filename: string): string {
  if (!rawPromptCache[filename]) {
    try {
      rawPromptCache[filename] = readFileSync(
        join(process.cwd(), "prompts", filename),
        "utf-8",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
  return rawPromptCache[filename];
}

/**
 * Loads a prompt template and applies locality + dynamic substitution.
 * Not cached at the resolved level — dynamic values change per call.
 */
export function loadPrompt(
  filename: string,
  ctx: PromptContext = DEFAULT_PROMPT_CONTEXT,
): string {
  return applyLocalityContext(
    getRawPromptContent(filename),
    buildPromptExtras(ctx),
  );
}

/** Gets the filter & split prompt — Step 1 */
export function getFilterSplitPrompt(
  ctx: PromptContext = DEFAULT_PROMPT_CONTEXT,
): string {
  return loadPrompt("filter-split.md", ctx);
}

/** Gets the categorization prompt — Step 2 */
export function getCategorizePrompt(
  ctx: PromptContext = DEFAULT_PROMPT_CONTEXT,
): string {
  return loadPrompt("categorize.md", ctx);
}

/** Gets the location extraction prompt — Step 3 */
export function getExtractLocationsPrompt(
  ctx: PromptContext = DEFAULT_PROMPT_CONTEXT,
): string {
  return loadPrompt("extract-locations.md", ctx);
}

/** Gets the summarization prompt */
export function getSummarizePrompt(
  ctx: PromptContext = DEFAULT_PROMPT_CONTEXT,
): string {
  return loadPrompt("summarize.md", ctx);
}
