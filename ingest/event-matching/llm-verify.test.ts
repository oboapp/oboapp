import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyEventMatch } from "./llm-verify";

vi.mock("@/lib/ai-client", () => ({
  callGeminiApi: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ai-validation", () => ({
  validateModelConfig: vi
    .fn()
    .mockReturnValue({ isValid: true, model: "gemini-2.0-flash" }),
}));

vi.mock("@/lib/ai-prompts", () => ({
  loadPrompt: vi.fn().mockReturnValue("mock system prompt"),
}));

import { callGeminiApi } from "@/lib/ai-client";
import { validateModelConfig } from "@/lib/ai-validation";

describe("verifyEventMatch", () => {
  beforeEach(() => {
    vi.mocked(callGeminiApi).mockReset().mockResolvedValue(null);
    vi.mocked(validateModelConfig)
      .mockReset()
      .mockReturnValue({ isValid: true, model: "gemini-2.0-flash" });
  });

  const input = {
    messageText: "Спиране на водата на ул. Граф Игнатиев",
    eventText: "Прекъсване на водоподаването по Граф Игнатиев",
    locationContext: "Both: ул. Граф Игнатиев",
    timeContext: "Both: 2026-03-15",
  };

  it("returns parsed result on valid LLM response", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce(
      JSON.stringify({ isSameEvent: true, reasoning: "Same street and type" }),
    );

    const result = await verifyEventMatch(input);
    expect(result).toEqual({
      isSameEvent: true,
      reasoning: "Same street and type",
    });
  });

  it("passes correct contents to callGeminiApi", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce(
      JSON.stringify({ isSameEvent: false, reasoning: "Different" }),
    );

    await verifyEventMatch(input);

    expect(callGeminiApi).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.0-flash",
        systemInstruction: "mock system prompt",
      }),
    );

    const callArgs = vi.mocked(callGeminiApi).mock.calls[0]![0];
    const parsed = JSON.parse(callArgs.contents);
    expect(parsed.messageA).toBe(input.messageText);
    expect(parsed.messageB).toBe(input.eventText);
    expect(parsed.locationContext).toBe(input.locationContext);
    expect(parsed.timeContext).toBe(input.timeContext);
  });

  it("returns null when callGeminiApi returns null (API error)", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce(null);

    const result = await verifyEventMatch(input);
    expect(result).toBeNull();
  });

  it("returns null when LLM returns invalid JSON", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce("not json at all");

    const result = await verifyEventMatch(input);
    expect(result).toBeNull();
  });

  it("returns null when LLM response fails schema validation", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce(
      JSON.stringify({ wrongField: true }),
    );

    const result = await verifyEventMatch(input);
    expect(result).toBeNull();
  });

  it("returns null when model config is invalid", async () => {
    vi.mocked(validateModelConfig).mockReturnValueOnce({ isValid: false });

    const result = await verifyEventMatch(input);
    expect(result).toBeNull();
    expect(callGeminiApi).not.toHaveBeenCalled();
  });

  it("handles isSameEvent=false correctly", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce(
      JSON.stringify({
        isSameEvent: false,
        reasoning: "Different types of disruptions",
      }),
    );

    const result = await verifyEventMatch(input);
    expect(result).toEqual({
      isSameEvent: false,
      reasoning: "Different types of disruptions",
    });
  });

  it("uses empty string for optional context fields", async () => {
    vi.mocked(callGeminiApi).mockResolvedValueOnce(
      JSON.stringify({ isSameEvent: true, reasoning: "Match" }),
    );

    await verifyEventMatch({
      messageText: "text A",
      eventText: "text B",
    });

    const callArgs = vi.mocked(callGeminiApi).mock.calls[0]![0];
    const parsed = JSON.parse(callArgs.contents);
    expect(parsed.locationContext).toBe("");
    expect(parsed.timeContext).toBe("");
  });

  it("returns null when prompt loading fails", async () => {
    // Reset the prompt cache by re-importing with a failing loadPrompt
    vi.resetModules();
    vi.doMock("../ai-prompts", () => ({
      loadPrompt: vi.fn().mockImplementation(() => {
        throw new Error("File not found");
      }),
    }));
    vi.doMock("../ai-validation", () => ({
      validateModelConfig: vi
        .fn()
        .mockReturnValue({ isValid: true, model: "gemini-2.0-flash" }),
    }));
    vi.doMock("../ai-client", () => ({
      callGeminiApi: vi.fn().mockResolvedValue(null),
    }));

    const { verifyEventMatch: freshVerify } = await import("./llm-verify");
    const result = await freshVerify(input);
    expect(result).toBeNull();
  });
});
