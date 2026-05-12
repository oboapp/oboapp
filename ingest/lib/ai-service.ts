import type { FilterSplitResult } from "./filter-split.schema";
import { FILTER_SPLIT_JSON_SCHEMA } from "./filter-split.schema";
import type { CategorizationResult } from "./categorize.schema";
import { CATEGORIZE_JSON_SCHEMA } from "./categorize.schema";
import type { ExtractedLocations } from "./extract-locations.schema";
import { EXTRACT_LOCATIONS_JSON_SCHEMA } from "./extract-locations.schema";
import type { SummarizeResult } from "./summarize.schema";
import { SUMMARIZE_JSON_SCHEMA } from "./summarize.schema";
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
  parseSummarizeResponse,
} from "./ai-response-parser";
import {
  getFilterSplitPrompt,
  getCategorizePrompt,
  getExtractLocationsPrompt,
  getSummarizePrompt,
} from "./ai-prompts";
import { callGeminiApi } from "./ai-client";

// Check if mocking is enabled
const USE_MOCK = process.env.MOCK_GEMINI_API === "true";
const mockService = USE_MOCK ? new GeminiMockService() : null;

/**
 * Shared helper that handles the common Gemini call pattern:
 * truncate → validate → mock shortcut → validate model config → call API → parse.
 */
async function callAiStep<T>(
  text: string,
  options: {
    maxLength: number;
    truncateTo: number;
    purpose: string;
    sanitize?: boolean;
    mockLabel: string;
    mockFn: ((text: string) => Promise<T | null>) | null;
    getPrompt: () => string;
    schema: object;
    parse: (text: string, errors?: IngestErrorRecorder) => T | null;
  },
  ingestErrors?: IngestErrorRecorder,
): Promise<T | null> {
  const processedText = truncateText(text, {
    maxLength: options.maxLength,
    truncateTo: options.truncateTo,
  });

  if (
    !validateText(
      processedText,
      { maxLength: options.maxLength, purpose: options.purpose },
      ingestErrors,
    )
  ) {
    return null;
  }

  if (USE_MOCK && options.mockFn) {
    logger.info(`Using Gemini mock for ${options.mockLabel}`);
    return options.mockFn(processedText);
  }

  const modelConfig = validateModelConfig(ingestErrors);
  if (!modelConfig.isValid) {
    return null;
  }

  const apiInput = options.sanitize
    ? sanitizeText(processedText)
    : processedText;

  const responseText = await callGeminiApi(
    {
      model: modelConfig.model!,
      contents: apiInput,
      systemInstruction: options.getPrompt(),
      responseSchema: options.schema,
    },
    ingestErrors,
  );

  if (!responseText) {
    return null;
  }

  return options.parse(responseText, ingestErrors);
}

/**
 * Step 1: Filter & Split
 * Splits a notification into individual messages, assesses relevance,
 * normalizes text, and extracts metadata (responsibleEntity, markdownText).
 */
export async function filterAndSplit(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<FilterSplitResult | null> {
  return callAiStep(
    text,
    {
      maxLength: 30000,
      truncateTo: 15000,
      purpose: "filter & split",
      mockLabel: "filter & split",
      mockFn: mockService ? (t) => mockService.filterAndSplit(t) : null,
      getPrompt: getFilterSplitPrompt,
      schema: FILTER_SPLIT_JSON_SCHEMA,
      parse: parseFilterSplitResponse,
    },
    ingestErrors,
  );
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
  return callAiStep(
    text,
    {
      maxLength: 30000,
      truncateTo: 8000,
      purpose: "message categorization",
      mockLabel: "categorization",
      mockFn: mockService ? (t) => mockService.categorize(t) : null,
      getPrompt: getCategorizePrompt,
      schema: CATEGORIZE_JSON_SCHEMA,
      parse: parseCategorizeResponse,
    },
    ingestErrors,
  );
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
  return callAiStep(
    text,
    {
      maxLength: 30000,
      truncateTo: 4000,
      purpose: "location extraction",
      sanitize: true,
      mockLabel: "location extraction",
      mockFn: mockService ? (t) => mockService.extractLocations(t) : null,
      getPrompt: getExtractLocationsPrompt,
      schema: EXTRACT_LOCATIONS_JSON_SCHEMA,
      parse: parseExtractLocationsResponse,
    },
    ingestErrors,
  );
}

/**
 * Summarize: Create a brief summary for long messages.
 * Input should be plainText from Step 1.
 * Skipped if text is shorter than SUMMARIZE_MIN_LENGTH.
 */
const _parsedMinLength = parseInt(process.env.SUMMARIZE_MIN_LENGTH ?? "", 10);
export const SUMMARIZE_MIN_LENGTH = Number.isNaN(_parsedMinLength)
  ? 1000
  : _parsedMinLength;

export async function summarize(
  text: string,
  ingestErrors?: IngestErrorRecorder,
): Promise<SummarizeResult | null> {
  if (text.length < SUMMARIZE_MIN_LENGTH) {
    return null;
  }

  return callAiStep(
    text,
    {
      maxLength: 30000,
      truncateTo: 8000,
      purpose: "summarization",
      mockLabel: "summarization",
      mockFn: mockService ? (t) => mockService.summarize(t) : null,
      getPrompt: getSummarizePrompt,
      schema: SUMMARIZE_JSON_SCHEMA,
      parse: parseSummarizeResponse,
    },
    ingestErrors,
  );
}
