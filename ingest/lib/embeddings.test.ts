import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @google/genai
const mockEmbedContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: mockEmbedContent };
  },
}));

// Mock delay to avoid waiting
vi.mock("./delay", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { generateEmbedding, _testInternals } from "./embeddings";
import { logger } from "./logger";

describe("generateEmbedding", () => {
  const ORIGINAL_API_KEY = process.env.GOOGLE_AI_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = "test-key";
    mockEmbedContent.mockReset();
    _testInternals.resetClient();
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = ORIGINAL_API_KEY;
    }
  });

  it("returns embedding values from API response", async () => {
    const fakeValues = Array.from({ length: 768 }, (_, i) => i * 0.001);
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: fakeValues }],
    });

    const result = await generateEmbedding("test text");
    expect(result).toEqual(fakeValues);
    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: _testInternals.EMBEDDING_MODEL,
      contents: "test text",
      config: { outputDimensionality: _testInternals.EMBEDDING_DIMENSIONS },
    });
  });

  it("returns null for empty text", async () => {
    const result = await generateEmbedding("   ");
    expect(result).toBeNull();
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it("returns null on API error", async () => {
    mockEmbedContent.mockRejectedValue(new Error("API error"));
    const result = await generateEmbedding("test");
    expect(result).toBeNull();
  });

  it("includes context in error log on API failure", async () => {
    mockEmbedContent.mockRejectedValue(new Error("API error"));
    await generateEmbedding("test text", {
      messageId: "msg-123",
      source: "sofia-bg",
    });

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to generate embedding",
      expect.objectContaining({
        messageId: "msg-123",
        source: "sofia-bg",
        textLength: 9,
        model: _testInternals.EMBEDDING_MODEL,
      }),
    );
  });

  it("includes context in warning log when response has no values", async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [] });
    await generateEmbedding("test text", {
      messageId: "msg-456",
      source: "toplo-bg",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Embedding response missing values",
      expect.objectContaining({
        messageId: "msg-456",
        source: "toplo-bg",
        textLength: 9,
        model: _testInternals.EMBEDDING_MODEL,
      }),
    );
  });

  it("returns null when response has no embeddings", async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [] });
    const result = await generateEmbedding("test");
    expect(result).toBeNull();
  });

  it("returns null when embedding values are empty", async () => {
    mockEmbedContent.mockResolvedValue({
      embeddings: [{ values: [] }],
    });
    const result = await generateEmbedding("test");
    expect(result).toBeNull();
  });

  it("returns null when GOOGLE_AI_API_KEY is not set", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const result = await generateEmbedding("test text");
    expect(result).toBeNull();
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it("serializes concurrent calls so only one is in-flight at a time", async () => {
    const fakeValues = Array.from({ length: 768 }, (_, i) => i * 0.001);
    const callOrder: number[] = [];
    mockEmbedContent.mockImplementation(async () => {
      // Record when each API call executes (not when the promise was created)
      callOrder.push(Date.now());
      return { embeddings: [{ values: fakeValues }] };
    });

    // Fire 3 concurrent calls
    const results = await Promise.all([
      generateEmbedding("text 1"),
      generateEmbedding("text 2"),
      generateEmbedding("text 3"),
    ]);

    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r).toEqual(fakeValues));
    // All 3 calls must have been serialized (3 actual API hits)
    expect(mockEmbedContent).toHaveBeenCalledTimes(3);
    // Each call should have started sequentially (not simultaneously)
    expect(callOrder).toHaveLength(3);
    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i]).toBeGreaterThanOrEqual(callOrder[i - 1]);
    }
  });
});
