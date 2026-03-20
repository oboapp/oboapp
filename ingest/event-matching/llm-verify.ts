import { callGeminiApi } from "@/lib/ai-client";
import { loadPrompt } from "@/lib/ai-prompts";
import { validateModelConfig } from "@/lib/ai-validation";
import { VerifyEventMatchResponseSchema } from "./schemas/verify-event-match.schema";
import type { VerifyEventMatchResult } from "./schemas/verify-event-match.schema";
import { logger } from "@/lib/logger";

let promptCache: string | null = null;

function getVerifyPrompt(): string {
  if (!promptCache) {
    promptCache = loadPrompt("verify-event-match.md");
  }
  return promptCache;
}

export interface LlmVerifyInput {
  readonly messageText: string;
  readonly eventText: string;
  readonly locationContext?: string;
  readonly timeContext?: string;
}

/**
 * Ask Gemini to verify whether two texts describe the same real-world incident.
 * Returns the result, or null on any failure (API error, invalid response, timeout).
 * Callers should fall back to score-only decision when null is returned.
 */
export async function verifyEventMatch(
  input: LlmVerifyInput,
): Promise<VerifyEventMatchResult | null> {
  const modelConfig = validateModelConfig();
  if (!modelConfig.isValid) {
    logger.warn("LLM verify skipped: model config invalid");
    return null;
  }

  let prompt: string;
  try {
    prompt = getVerifyPrompt();
  } catch (error) {
    logger.warn("LLM verify skipped: failed to load prompt", { error });
    return null;
  }

  const contents = JSON.stringify({
    messageA: input.messageText,
    messageB: input.eventText,
    locationContext: input.locationContext ?? "",
    timeContext: input.timeContext ?? "",
  });

  const responseText = await callGeminiApi({
    model: modelConfig.model!,
    contents,
    systemInstruction: prompt,
  });

  if (!responseText) {
    return null;
  }

  try {
    const parsed = JSON.parse(responseText);
    const result = VerifyEventMatchResponseSchema.safeParse(parsed);

    if (!result.success) {
      logger.warn("LLM verify response failed schema validation", {
        errors: result.error.issues,
      });
      return null;
    }

    return result.data;
  } catch {
    logger.warn("LLM verify response is not valid JSON", {
      response: responseText.slice(0, 200),
    });
    return null;
  }
}
