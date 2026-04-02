import type { FilterSplitResult } from "./filter-split.schema";
import { FILTER_SPLIT_JSON_SCHEMA } from "./filter-split.schema";
import type { CategorizationResult } from "./categorize.schema";
import { CATEGORIZE_JSON_SCHEMA } from "./categorize.schema";
import type { ExtractedLocations } from "./extract-locations.schema";
import { EXTRACT_LOCATIONS_JSON_SCHEMA } from "./extract-locations.schema";
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
      responseSchema: FILTER_SPLIT_JSON_SCHEMA,
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
const CATEGORIZE_MAX_LENGTH = 30000;
const CATEGORIZE_TRUNCATE_TO = 8000;

export async function categorize(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<CategorizationResult | null> {
  const processedText = truncateText(text, {
    maxLength: CATEGORIZE_MAX_LENGTH,
    truncateTo: CATEGORIZE_TRUNCATE_TO,
  });

  if (
    !validateText(
      processedText,
      { maxLength: CATEGORIZE_MAX_LENGTH, purpose: "message categorization" },
      ingestErrors,
    )
  ) {
    return null;
  }

  if (USE_MOCK && mockService) {
    logger.info("Using Gemini mock for categorization");
    return mockService.categorize(processedText);
  }

  const modelConfig = validateModelConfig(ingestErrors);
  if (!modelConfig.isValid) {
    return null;
  }

  const responseText = await callGeminiApi(
    {
      model: modelConfig.model!,
      contents: processedText,
      systemInstruction: getCategorizePrompt(),
      responseSchema: CATEGORIZE_JSON_SCHEMA,
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
const EXTRACT_LOCATIONS_MAX_LENGTH = 30000;
const EXTRACT_LOCATIONS_TRUNCATE_TO = 4000;

export async function extractLocations(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<ExtractedLocations | null> {
  const processedText = truncateText(text, {
    maxLength: EXTRACT_LOCATIONS_MAX_LENGTH,
    truncateTo: EXTRACT_LOCATIONS_TRUNCATE_TO,
  });

  if (
    !validateText(
      processedText,
      {
        maxLength: EXTRACT_LOCATIONS_MAX_LENGTH,
        purpose: "location extraction",
      },
      ingestErrors,
    )
  ) {
    return null;
  }

  if (USE_MOCK && mockService) {
    logger.info("Using Gemini mock for location extraction");
    return mockService.extractLocations(processedText);
  }

  const sanitizedText = sanitizeText(processedText);

  const modelConfig = validateModelConfig(ingestErrors);
  if (!modelConfig.isValid) {
    return null;
  }

  const responseText = await callGeminiApi(
    {
      model: modelConfig.model!,
      contents: sanitizedText,
      systemInstruction: getExtractLocationsPrompt(),
      responseSchema: EXTRACT_LOCATIONS_JSON_SCHEMA,
    },
    ingestErrors,
  );

  if (!responseText) {
    return null;
  }

  return parseExtractLocationsResponse(responseText, ingestErrors);
}
