import type { FilterSplitResult } from "./filter-split.schema";
import type { CategorizationResult } from "./categorize.schema";
import type { ExtractedLocations } from "./extract-locations.schema";
import type { IngestErrorRecorder } from "./ingest-errors";
import { logger } from "@/lib/logger";
import { GeminiMockService } from "../__mocks__/services/gemini-mock-service";
import {
  validateText,
  validateModelConfig,
  sanitizeText,
  truncateText,
} from "./ai-validation";
import {
  parseFilterSplitResponse,
  parseCategorizeResponse,
  parseExtractLocationsResponse,
} from "./ai-response-parser";
import {
  getFilterSplitPrompt,
  getCategorizePrompt,
  getExtractLocationsPrompt,
} from "./ai-prompts";
import { callGeminiApi } from "./ai-client";

// Check if mocking is enabled
const USE_MOCK = process.env.MOCK_GEMINI_API === "true";
const mockService = USE_MOCK ? new GeminiMockService() : null;

/**
 * Step 1: Filter & Split
 * Splits a notification into individual messages, assesses relevance,
 * normalizes text, and extracts metadata (responsibleEntity, markdownText).
 */
const FILTER_SPLIT_MAX_LENGTH = 30000;
const FILTER_SPLIT_TRUNCATE_TO = 15000;

export async function filterAndSplit(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<FilterSplitResult | null> {
  const processedText = truncateText(text, {
    maxLength: FILTER_SPLIT_MAX_LENGTH,
    truncateTo: FILTER_SPLIT_TRUNCATE_TO,
  });

  if (processedText !== text) {
    logger.warn("Filter & split input was truncated", {
      originalLength: text.length,
      truncatedLength: processedText.length,
    });
  }

  if (
    !validateText(
      processedText,
      { maxLength: FILTER_SPLIT_MAX_LENGTH, purpose: "filter & split" },
      ingestErrors,
    )
  ) {
    return null;
  }

  if (USE_MOCK && mockService) {
    logger.info("Using Gemini mock for filter & split");
    return mockService.filterAndSplit(processedText);
  }

  const modelConfig = validateModelConfig(ingestErrors);
  if (!modelConfig.isValid) {
    return null;
  }

  const responseText = await callGeminiApi(
    {
      model: modelConfig.model!,
      contents: processedText,
      systemInstruction: getFilterSplitPrompt(),
    },
    ingestErrors,
  );

  if (!responseText) {
    return null;
  }

  return parseFilterSplitResponse(responseText, ingestErrors);
}

/**
 * Step 2: Categorize
 * Classifies a single pre-split message into categories.
 * Input should be a plainText from Step 1.
 */
export async function categorize(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<CategorizationResult | null> {
  if (USE_MOCK && mockService) {
    logger.info("Using Gemini mock for categorization");
    return mockService.categorize(text);
  }

  if (
    !validateText(
      text,
      { maxLength: 10000, purpose: "message categorization" },
      ingestErrors,
    )
  ) {
    return null;
  }

  const modelConfig = validateModelConfig(ingestErrors);
  if (!modelConfig.isValid) {
    return null;
  }

  const responseText = await callGeminiApi(
    {
      model: modelConfig.model!,
      contents: text,
      systemInstruction: getCategorizePrompt(),
    },
    ingestErrors,
  );

  if (!responseText) {
    return null;
  }

  return parseCategorizeResponse(responseText, ingestErrors);
}

/**
 * Step 3: Extract Locations
 * Extracts all location data from a single pre-split message:
 * pins, streets, cadastralProperties, busStops, cityWide, withSpecificAddress.
 * Input should be a plainText from Step 1.
 */
export async function extractLocations(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<ExtractedLocations | null> {
  if (USE_MOCK && mockService) {
    logger.info("Using Gemini mock for location extraction");
    return mockService.extractLocations(text);
  }

  if (
    !validateText(
      text,
      { maxLength: 5000, purpose: "location extraction" },
      ingestErrors,
    )
  ) {
    return null;
  }

  const sanitizedText = sanitizeText(text);

  const modelConfig = validateModelConfig(ingestErrors);
  if (!modelConfig.isValid) {
    return null;
  }

  const responseText = await callGeminiApi(
    {
      model: modelConfig.model!,
      contents: sanitizedText,
      systemInstruction: getExtractLocationsPrompt(),
    },
    ingestErrors,
  );

  if (!responseText) {
    return null;
  }

  return parseExtractLocationsResponse(responseText, ingestErrors);
}
