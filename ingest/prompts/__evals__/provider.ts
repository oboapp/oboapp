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
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local before anything reads process.env (AGENTS.md pattern)
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const PROMPTS_DIR = join(__dirname, "..");

function loadPromptFile(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), "utf-8");
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

    const systemInstruction = loadPromptFile(this.promptFile);

    try {
      const client = getClient();
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
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
