import type { IngestErrorRecorder } from "./ingest-errors";
import { getIngestErrorRecorder } from "./ingest-errors";
import { logger } from "@/lib/logger";

export interface TextValidationOptions {
  readonly maxLength: number;
  readonly purpose: string;
}

export interface ModelConfigValidation {
  readonly isValid: boolean;
  readonly model?: string;
}

/**
 * Validates text input for AI processing
 */
export function validateText(
  text: unknown,
  options: TextValidationOptions,
  ingestErrors?: IngestErrorRecorder,
): boolean {
  const recorder = getIngestErrorRecorder(ingestErrors);

  if (!text || typeof text !== "string") {
    recorder.error(`Invalid text parameter for ${options.purpose}`);
    return false;
  }

  if (text.length > options.maxLength) {
    recorder.error(
      `Text is too long for ${options.purpose} (max ${options.maxLength} characters)`,
    );
    return false;
  }

  return true;
}

/**
 * Validates and retrieves AI model configuration
 */
export function validateModelConfig(
  ingestErrors?: IngestErrorRecorder,
): ModelConfigValidation {
  const recorder = getIngestErrorRecorder(ingestErrors);
  const model = process.env.GOOGLE_AI_MODEL?.trim();

  if (!model) {
    recorder.error("GOOGLE_AI_MODEL environment variable is not set");
    return { isValid: false };
  }

  return { isValid: true, model };
}

export interface TruncationOptions {
  readonly maxLength: number;
  readonly truncateTo: number;
}

/**
 * Truncates text that exceeds maxLength, appending a notice.
 * Returns original text unchanged if within limit.
 */
export function truncateText(
  text: string,
  options: TruncationOptions,
): string {
  if (options.truncateTo >= options.maxLength) {
    throw new Error("truncateTo must be less than maxLength");
  }

  if (text.length <= options.maxLength) {
    return text;
  }

  const notice = `\n\n... [This message was originally ${text.length} characters long but was programmatically truncated. Some content is missing.]`;
  const maxContentLength = options.maxLength - notice.length;

  if (maxContentLength <= 0) {
    throw new Error("maxLength is too small to accommodate truncation notice");
  }

  const effectiveTruncateTo = Math.min(options.truncateTo, maxContentLength);

  logger.warn("Truncating long text for AI processing", {
    originalLength: text.length,
    truncatedTo: effectiveTruncateTo,
    maxLength: options.maxLength,
  });

  const truncated = text.slice(0, effectiveTruncateTo);
  return `${truncated}${notice}`;
}

/**
 * Sanitizes text to prevent prompt injection
 */
export function sanitizeText(text: string): string {
  return text.replace(/[\n\r]/g, " ").trim();
}
