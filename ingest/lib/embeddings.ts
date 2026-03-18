import { GoogleGenAI } from "@google/genai";
import { delay } from "./delay";
import { logger } from "./logger";

const EMBEDDING_MODEL =
  process.env.GOOGLE_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const RATE_LIMIT_MS = 200;

let ai: GoogleGenAI | null = null;
let lastCallTime = 0;

/**
 * Serialization queue: each call chains onto this promise so that only one
 * embedding request is in-flight at a time, making the 200 ms rate limit
 * concurrency-safe even when multiple callers race.
 */
let queue: Promise<unknown> = Promise.resolve();

function getClient(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || "" });
  }
  return ai;
}

export interface EmbeddingContext {
  readonly messageId?: string;
  readonly source?: string;
}

/**
 * Generate a text embedding via Gemini gemini-embedding-001.
 * Rate-limited to 200ms between calls; serialized via an internal queue so
 * concurrent callers never bypass the delay.
 * Returns null on failure (does not throw).
 */
export function generateEmbedding(
  text: string,
  context?: EmbeddingContext,
): Promise<number[] | null> {
  if (!text.trim()) return Promise.resolve(null);

  if (!process.env.GOOGLE_AI_API_KEY) {
    return Promise.resolve(null);
  }

  // Chain onto the shared queue so calls are always serialized.
  const result = queue.then(() => _doGenerate(text, context));
  // Swallow rejections on the queue tail so a failure doesn't break later callers.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function _doGenerate(
  text: string,
  context?: EmbeddingContext,
): Promise<number[] | null> {
  // Rate limiting: enforce minimum gap between API calls.
  const elapsed = Date.now() - lastCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await delay(RATE_LIMIT_MS - elapsed);
  }

  const logContext = {
    model: EMBEDDING_MODEL,
    textLength: text.length,
    messageId: context?.messageId,
    source: context?.source,
  };

  try {
    const client = getClient();
    lastCallTime = Date.now();

    const response = await client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values?.length) {
      logger.warn("Embedding response missing values", logContext);
      return null;
    }

    return values;
  } catch (error) {
    logger.error("Failed to generate embedding", { ...logContext, error });
    return null;
  }
}

/** Exported for testing */
export const _testInternals = {
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  RATE_LIMIT_MS,
  resetClient: () => {
    ai = null;
    lastCallTime = 0;
    queue = Promise.resolve();
  },
};
