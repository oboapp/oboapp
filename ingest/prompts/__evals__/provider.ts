/**
 * Custom promptfoo provider that wraps the Gemini API client.
 * This ensures evals use the exact same call pattern as production:
 * - Same @google/genai SDK
 * - Same systemInstruction + responseMimeType: "application/json" config
 * - Same model from GOOGLE_AI_MODEL env var
 *
 * Usage in YAML configs:
 *   providers:
 *     - id: "file://provider.ts"
 *       config:
 *         promptFile: "filter-split.md"
 *
 * The class is instantiated by promptfoo with the provider options object.
 * config.promptFile determines which prompt from ingest/prompts/ to load.
 *
 * NOTE: This file is loaded by promptfoo with tsx as ESM loader
 * (NODE_OPTIONS="--import tsx/esm"). The Gemini call is inlined
 * using @google/genai directly to keep the provider self-contained.
 */

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { resolve } from "node:path";

// Load .env.local before anything reads process.env (AGENTS.md pattern)
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Loads the JSON schema matching a prompt file, for Gemini structured output.
 * Returns undefined if no schema is defined for the prompt.
 */
async function loadResponseSchema(
  promptFile: string,
): Promise<unknown | undefined> {
  switch (promptFile) {
    case "filter-split.md": {
      const { FILTER_SPLIT_JSON_SCHEMA } =
        await import("../../lib/filter-split.schema");
      return FILTER_SPLIT_JSON_SCHEMA;
    }
    case "categorize.md": {
      const { CATEGORIZE_JSON_SCHEMA } =
        await import("../../lib/categorize.schema");
      return CATEGORIZE_JSON_SCHEMA;
    }
    case "extract-locations.md": {
      const { EXTRACT_LOCATIONS_JSON_SCHEMA } =
        await import("../../lib/extract-locations.schema");
      return EXTRACT_LOCATIONS_JSON_SCHEMA;
    }
    case "summarize.md": {
      const { SUMMARIZE_JSON_SCHEMA } =
        await import("../../lib/summarize.schema");
      return SUMMARIZE_JSON_SCHEMA;
    }
    default:
      return undefined;
  }
}

// Lazy singleton — same pattern as production ai-client.ts
let ai: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || "" });
  }
  return ai;
}

interface ProviderOptions {
  readonly id?: string;
  readonly config?: {
    readonly promptFile?: string;
    readonly basePath?: string;
  };
}

interface ProviderResponse {
  output?: string;
  error?: string;
}

/**
 * Default export class — instantiated by promptfoo via `new Provider(options)`.
 * Reads config.promptFile to load the appropriate system instruction.
 */
class GeminiPipelineProvider {
  private readonly promptFile: string;
  private readonly providerId: string;

  constructor(options: ProviderOptions) {
    const promptFile = options.config?.promptFile;
    if (!promptFile) {
      throw new Error(
        "Provider config.promptFile is required (e.g., 'filter-split.md')",
      );
    }
    this.promptFile = promptFile;
    this.providerId = options.id ?? `gemini-pipeline:${promptFile}`;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const model = process.env.GOOGLE_AI_MODEL;
    if (!model) {
      return { error: "GOOGLE_AI_MODEL environment variable is not set" };
    }

    let systemInstruction: string;
    let responseSchema: unknown | undefined;

    try {
      const { loadPrompt } = await import("../../lib/ai-prompts");
      systemInstruction = loadPrompt(this.promptFile);
      responseSchema = await loadResponseSchema(this.promptFile);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        error: `Failed to load prompt configuration for '${this.promptFile}': ${msg}`,
      };
    }

    try {
      const client = getClient();
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          ...(responseSchema ? { responseJsonSchema: responseSchema } : {}),
        },
      });

      const text = response.text || "";
      return { output: text };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { error: `Gemini API error: ${msg}` };
    }
  }
}

export default GeminiPipelineProvider;
