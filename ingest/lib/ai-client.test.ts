import { describe, it, expect, vi, beforeEach } from "vitest";

// Single shared mock so the ai-client singleton always references the same function
const mockGenerateContent = vi.fn();

// Mock the @google/genai module before imports
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

// Mock the delay function to avoid actual waiting in tests
vi.mock("./delay", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { delay } from "./delay";
import { callGeminiApi, isRetryableError } from "./ai-client";
import type { IngestErrorRecorder } from "./ingest-errors";

function makeRecorder(): IngestErrorRecorder & {
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    warn: (text: string) => warnings.push(text),
    error: (text: string) => errors.push(text),
    exception: vi.fn(),
  };
}

describe("isRetryableError", () => {
  it("returns true for 503 UNAVAILABLE errors", () => {
    const err = new Error(
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
    );
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for 429 RESOURCE_EXHAUSTED errors", () => {
    const err = new Error(
      '{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}',
    );
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true for 500 errors", () => {
    const err = new Error('{"error":{"code":500,"message":"internal error"}}');
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true when status is UNAVAILABLE", () => {
    const err = new Error('some error with "status":"UNAVAILABLE" in message');
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns true when status is RESOURCE_EXHAUSTED", () => {
    const err = new Error(
      'some error with "status":"RESOURCE_EXHAUSTED" in message',
    );
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns false for 400 bad request errors", () => {
    const err = new Error('{"error":{"code":400,"message":"bad request"}}');
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns false for 401 unauthorized errors", () => {
    const err = new Error('{"error":{"code":401,"message":"unauthorized"}}');
    expect(isRetryableError(err)).toBe(false);
  });

  it("returns false for generic errors", () => {
    expect(isRetryableError(new Error("Something went wrong"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("callGeminiApi", () => {
  const options = {
    model: "gemini-1.5-flash",
    contents: "Test message",
    systemInstruction: "You are a helpful assistant",
  };

  beforeEach(() => {
    mockGenerateContent.mockClear();
    vi.mocked(delay).mockClear();
  });

  it("returns response text on success", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "success response" });

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBe("success response");
    expect(recorder.errors).toHaveLength(0);
    expect(recorder.warnings).toHaveLength(0);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("returns empty string when response.text is falsy", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "" });

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBe("");
    expect(recorder.errors).toHaveLength(0);
  });

  it("retries on 503 UNAVAILABLE and succeeds on second attempt", async () => {
    const transientError = new Error(
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
    );
    mockGenerateContent
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ text: "success after retry" });

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBe("success after retry");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(recorder.warnings).toHaveLength(1);
    expect(recorder.warnings[0]).toContain("retry 1/3");
    expect(recorder.errors).toHaveLength(0);
    expect(vi.mocked(delay)).toHaveBeenCalledWith(1000);
  });

  it("retries on 429 RESOURCE_EXHAUSTED with exponential backoff", async () => {
    const rateLimitError = new Error(
      '{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}',
    );
    mockGenerateContent
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ text: "success on third attempt" });

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBe("success on third attempt");
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(recorder.warnings).toHaveLength(2);
    expect(recorder.warnings[0]).toContain("retry 1/3");
    expect(recorder.warnings[1]).toContain("retry 2/3");
    expect(recorder.errors).toHaveLength(0);
    // Exponential backoff: 1000ms, then 2000ms
    expect(vi.mocked(delay)).toHaveBeenCalledWith(1000);
    expect(vi.mocked(delay)).toHaveBeenCalledWith(2000);
  });

  it("exhausts all retries and returns null after persistent 503 errors", async () => {
    const transientError = new Error(
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
    );
    mockGenerateContent.mockRejectedValue(transientError);

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBeNull();
    // 4 total attempts (initial + 3 retries)
    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    // 3 retry warnings + 1 final error
    expect(recorder.warnings).toHaveLength(3);
    expect(recorder.errors).toHaveLength(1);
    expect(recorder.errors[0]).toContain("Error calling Gemini API");
  });

  it("does not retry on non-retryable errors (400)", async () => {
    const badRequestError = new Error(
      '{"error":{"code":400,"message":"bad request"}}',
    );
    mockGenerateContent.mockRejectedValueOnce(badRequestError);

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(recorder.warnings).toHaveLength(0);
    expect(recorder.errors).toHaveLength(1);
    expect(vi.mocked(delay)).not.toHaveBeenCalled();
  });

  it("does not retry on generic errors", async () => {
    const genericError = new Error("Network error");
    mockGenerateContent.mockRejectedValueOnce(genericError);

    const recorder = makeRecorder();
    const result = await callGeminiApi(options, recorder);

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(recorder.warnings).toHaveLength(0);
    expect(recorder.errors).toHaveLength(1);
    expect(vi.mocked(delay)).not.toHaveBeenCalled();
  });

  it("uses correct exponential backoff delays (1s, 2s, 4s)", async () => {
    const transientError = new Error(
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
    );
    mockGenerateContent.mockRejectedValue(transientError);

    const recorder = makeRecorder();
    await callGeminiApi(options, recorder);

    expect(vi.mocked(delay)).toHaveBeenNthCalledWith(1, 1000);
    expect(vi.mocked(delay)).toHaveBeenNthCalledWith(2, 2000);
    expect(vi.mocked(delay)).toHaveBeenNthCalledWith(3, 4000);
    expect(vi.mocked(delay)).toHaveBeenCalledTimes(3);
  });

  it("works without an ingestErrors recorder", async () => {
    const transientError = new Error(
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
    );
    mockGenerateContent
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ text: "recovered" });

    // Should not throw even without a recorder
    const result = await callGeminiApi(options);
    expect(result).toBe("recovered");
  });

  it("passes responseJsonSchema to config when responseSchema is provided", async () => {
    const schema = { type: "array", items: { type: "object" } };
    mockGenerateContent.mockResolvedValueOnce({ text: "[]" });

    await callGeminiApi({ ...options, responseSchema: schema });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        }),
      }),
    );
  });

  it("does not include responseJsonSchema when responseSchema is omitted", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "ok" });

    await callGeminiApi(options);

    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(callConfig).not.toHaveProperty("responseJsonSchema");
  });
});
