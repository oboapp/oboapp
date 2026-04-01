import { GoogleGenAI } from "@google/genai";
import {
  formatIngestErrorText,
  getIngestErrorRecorder,
  type IngestErrorRecorder,
} from "./ingest-errors";
import { delay } from "./delay";

let ai: GoogleGenAI | null = null;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

// HTTP status codes that indicate a transient error worth retrying
const RETRYABLE_STATUS_CODES = [429, 500, 503];

/**
 * Gets or creates the Gemini AI client instance
 */
function getAiClient(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || "" });
  }
  return ai;
}

export interface GeminiApiOptions {
  readonly model: string;
  readonly contents: string;
  readonly systemInstruction: string;
  readonly responseSchema?: unknown;
}

/**
 * Returns true if the error is transient and the request should be retried.
 * Handles GoogleGenAI errors which include the HTTP status code in the message.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  const text = error instanceof Error ? error.message : String(error);
  return (
    RETRYABLE_STATUS_CODES.some((code) => text.includes(`"code":${code}`)) ||
    text.includes('"status":"UNAVAILABLE"') ||
    text.includes('"status":"RESOURCE_EXHAUSTED"')
  );
}

/**
 * Calls the Gemini API with the provided options.
 * Retries up to MAX_RETRIES times with exponential backoff on transient errors.
 */
export async function callGeminiApi(
  options: GeminiApiOptions,
  ingestErrors?: IngestErrorRecorder,
): Promise<string | null> {
  const recorder = getIngestErrorRecorder(ingestErrors);
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = getAiClient();
      const response = await client.models.generateContent({
        model: options.model,
        contents: options.contents,
        config: {
          systemInstruction: options.systemInstruction,
          responseMimeType: "application/json",
          ...(options.responseSchema
            ? { responseJsonSchema: options.responseSchema }
            : {}),
        },
      });

      return response.text || "";
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        recorder.warn(
          `Gemini API call failed (retry ${attempt + 1}/${MAX_RETRIES}), retrying in ${delayMs}ms: ${formatIngestErrorText(error)}`,
        );
        await delay(delayMs);
      } else {
        break;
      }
    }
  }

  recorder.error(
    `Error calling Gemini API: ${formatIngestErrorText(lastError)}`,
  );
  return null;
}
