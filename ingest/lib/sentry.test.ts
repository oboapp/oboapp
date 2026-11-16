import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  flush: vi.fn(),
  setExtra: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setErrorReporter: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  init: mocks.init,
  flush: mocks.flush,
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  withScope: (callback: (scope: { setExtra: typeof mocks.setExtra }) => void) => {
    callback({ setExtra: mocks.setExtra });
  },
}));

vi.mock("@/lib/logger", () => ({
  setErrorReporter: mocks.setErrorReporter,
}));

import { flushSentry, initSentry } from "./sentry";

function getReporter(): (message: string, extra?: Record<string, unknown>) => void {
  return mocks.setErrorReporter.mock.calls[0][0];
}

describe("ingest Sentry reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes after the environment is configured", () => {
    initSentry();

    expect(mocks.init).toHaveBeenCalledWith({
      dsn: "https://public@example.test/1",
      environment: "test",
      tracesSampleRate: 0.1,
    });
    expect(mocks.setErrorReporter).toHaveBeenCalledOnce();
  });

  it("does not register a reporter without a DSN", () => {
    vi.stubEnv("SENTRY_DSN", "");

    initSentry();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.setErrorReporter).not.toHaveBeenCalled();
  });

  it("captures a sanitized exception with its stack and nested network cause", () => {
    initSentry();
    const url = "https://user:password@example.test/feed?token=secret#private";
    const cause = Object.assign(new Error(`connect failed ${url}`), {
      code: "ECONNRESET",
      credentials: "private-error-property",
    });
    const error = new TypeError("fetch failed", { cause });
    error.stack = `TypeError: fetch failed\n    at request (${url})`;

    getReporter()("Source failed", {
      error,
      sourceType: "lozenets-sofia-bg",
      cloudRunExecution: "crawl-lozenets-test",
      cloudRunTaskAttempt: "1",
    });

    const captured: Error = mocks.captureException.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured).not.toBe(error);
    expect(captured.name).toBe("TypeError");
    expect(captured.message).toBe("fetch failed");
    expect(captured.stack).toContain("at request");
    expect(captured.cause).toBeInstanceOf(Error);
    expect(captured.cause).toMatchObject({ code: "ECONNRESET" });
    expect(mocks.setExtra).toHaveBeenCalledWith("error", expect.objectContaining({
      name: "TypeError",
      message: "fetch failed",
      cause: expect.objectContaining({ code: "ECONNRESET" }),
    }));
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunExecution", "crawl-lozenets-test");
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunTaskAttempt", "1");
    const reported = JSON.stringify(mocks.setExtra.mock.calls);
    for (const secret of ["password", "token=secret", "#private", "private-error-property"]) {
      expect(reported).not.toContain(secret);
      expect(captured.stack).not.toContain(secret);
      expect((captured.cause as Error).message).not.toContain(secret);
    }
    expect(error.stack).toContain("token=secret");
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("captures message-only failures with sanitized URL metadata", () => {
    initSentry();
    const url = "https://user:password@example.test/feed?token=secret#private";

    getReporter()(`Failed ${url}`, { error: "connection closed", feedUrl: url });

    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).toHaveBeenCalledWith("Failed https://example.test/feed", "error");
    expect(mocks.setExtra).toHaveBeenCalledWith("loggerMessage", "Failed https://example.test/feed");
    expect(mocks.setExtra).toHaveBeenCalledWith("feedUrl", "https://example.test/feed");
    expect(mocks.setExtra).toHaveBeenCalledWith("error", "connection closed");
  });

  it("captures failures without metadata", () => {
    initSentry();

    getReporter()("Source failed");

    expect(mocks.captureMessage).toHaveBeenCalledWith("Source failed", "error");
  });

  it("flushes pending events before exit", async () => {
    mocks.flush.mockResolvedValue(true);

    await flushSentry();

    expect(mocks.flush).toHaveBeenCalledWith(5000);
  });
});
