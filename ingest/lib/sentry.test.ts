import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  isInitialized: vi.fn(),
  flush: vi.fn(),
  setExtra: vi.fn(),
  setLevel: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setErrorReporter: vi.fn(),
  getCloudRunContext: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  init: mocks.init,
  isInitialized: mocks.isInitialized,
  flush: mocks.flush,
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  addBreadcrumb: mocks.addBreadcrumb,
  withScope: (callback: (scope: {
    setExtra: typeof mocks.setExtra;
    setLevel: typeof mocks.setLevel;
    setTag: typeof mocks.setTag;
  }) => void) => {
    callback({
      setExtra: mocks.setExtra,
      setLevel: mocks.setLevel,
      setTag: mocks.setTag,
    });
  },
}));

vi.mock("@/lib/logger", () => ({
  setErrorReporter: mocks.setErrorReporter,
  getCloudRunContext: mocks.getCloudRunContext,
  logger: { warn: mocks.warn, info: mocks.info },
}));

import { flushSentry, initSentry, reportSourceBreadcrumb, reportSourceWarning } from "./sentry";

function getReporter(): (message: string, extra?: Record<string, unknown>) => void {
  return mocks.setErrorReporter.mock.calls[0][0];
}

describe("ingest Sentry reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInitialized.mockReturnValue(true);
    mocks.getCloudRunContext.mockReturnValue({});
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
    expect(mocks.setLevel).toHaveBeenCalledWith("error");
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

  it("reports recoverable source exceptions as warnings with bounded tags and scheduler context", () => {
    const privateUrl = "https://reader:password@provider.example/feed/?token=private#fragment";
    const cause = Object.assign(new Error(`Connection reset for ${privateUrl}`), {
      code: "ECONNRESET",
      authorization: "private-error-property",
    });
    const error = new TypeError("fetch failed", { cause });
    mocks.getCloudRunContext.mockReturnValue({
      cloudRunJob: "crawl-oborishte",
      cloudRunExecution: "crawl-oborishte-recovery",
      cloudRunTaskIndex: "0",
      cloudRunTaskAttempt: "1",
    });

    reportSourceWarning("RSS discovery failed; trying WordPress posts API", {
      sourceType: "rayon-oborishte-bg",
      diagnosticCode: "rss-discovery-failure",
      feedUrl: privateUrl,
      error,
    });

    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.setLevel).toHaveBeenCalledWith("warning");
    expect(mocks.setTag.mock.calls).toEqual([
      ["sourceType", "rayon-oborishte-bg"],
      ["diagnosticCode", "rss-discovery-failure"],
    ]);
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunExecution", "crawl-oborishte-recovery");
    expect(mocks.setExtra).toHaveBeenCalledWith("cloudRunTaskAttempt", "1");
    expect(mocks.setExtra).toHaveBeenCalledWith("feedUrl", "https://provider.example/feed/");
    expect(mocks.captureException).toHaveBeenCalledOnce();
    const captured: Error = mocks.captureException.mock.calls[0][0];
    expect(captured).not.toBe(error);
    expect(captured.cause).toMatchObject({
      message: "Connection reset for https://provider.example/feed/",
      code: "ECONNRESET",
    });
    const diagnostics = JSON.stringify(mocks.setExtra.mock.calls)
      + captured.stack + (captured.cause as Error).stack;
    for (const secret of ["reader:", "password", "token=private", "#fragment", "private-error-property"]) {
      expect(diagnostics).not.toContain(secret);
    }
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(cause.message).toContain(privateUrl);
  });

  it("reports non-Error source warnings with sanitized metadata", () => {
    const privateUrl = "https://reader:password@provider.example/feed/?token=private#fragment";

    reportSourceWarning(`RSS failed for ${privateUrl}`, {
      sourceType: "rayon-oborishte-bg",
      diagnosticCode: "rss-discovery-failure",
      error: { message: `Connection reset for ${privateUrl}`, code: "ECONNRESET", authorization: "private" },
    });

    expect(mocks.captureMessage).toHaveBeenCalledExactlyOnceWith(
      "RSS failed for https://provider.example/feed/",
      "warning",
    );
    expect(mocks.setExtra).toHaveBeenCalledWith("error", {
      message: "Connection reset for https://provider.example/feed/",
      code: "ECONNRESET",
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("keeps warning logs available before Sentry is initialized", () => {
    mocks.isInitialized.mockReturnValue(false);

    reportSourceWarning("RSS discovery failed", {
      sourceType: "rayon-oborishte-bg",
      diagnosticCode: "rss-discovery-failure",
      error: new Error("Provider unavailable"),
    });

    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("keeps source recovery running when Sentry capture fails", () => {
    mocks.captureException.mockImplementationOnce(() => {
      throw new Error("Telemetry unavailable");
    });

    expect(() => {
      reportSourceWarning("RSS discovery failed", {
        sourceType: "rayon-oborishte-bg",
        diagnosticCode: "rss-discovery-failure",
        error: new Error("Provider unavailable"),
      });
    }).not.toThrow();

    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("flushes pending events before exit", async () => {
    mocks.flush.mockResolvedValue(true);

    await flushSentry();

    expect(mocks.flush).toHaveBeenCalledWith(5000);
  });

  it.each(["warning", "info"] as const)("records sanitized flat %s breadcrumbs with scheduler context", (level) => {
    const privateUrl = "https://reader:password@provider.example/feed/?token=private#fragment";
    mocks.getCloudRunContext.mockReturnValue({
      cloudRunJob: "crawl-lozenets",
      cloudRunExecution: "crawl-lozenets-recovery",
      cloudRunTaskIndex: "0",
      cloudRunTaskAttempt: "1",
    });

    reportSourceBreadcrumb(`Feed event for ${privateUrl}`, {
      sourceType: "lozenets-sofia-bg",
      diagnosticCode: "rss-feed-retry",
      feedUrl: privateUrl,
      pagination: "paged=2",
      feedAttempt: 1,
      nextFeedAttempt: 2,
      retryDelayMs: 2_000,
      retryReason: "network",
      networkCode: "ECONNRESET",
    }, level);

    expect(level === "warning" ? mocks.warn : mocks.info).toHaveBeenCalledOnce();
    expect(mocks.addBreadcrumb).toHaveBeenCalledExactlyOnceWith({
      category: "source.rss",
      level,
      message: "Feed event for https://provider.example/feed/",
      data: {
        sourceType: "lozenets-sofia-bg",
        diagnosticCode: "rss-feed-retry",
        feedUrl: "https://provider.example/feed/",
        pagination: "paged=2",
        feedAttempt: 1,
        nextFeedAttempt: 2,
        retryDelayMs: 2_000,
        retryReason: "network",
        networkCode: "ECONNRESET",
        cloudRunJob: "crawl-lozenets",
        cloudRunExecution: "crawl-lozenets-recovery",
        cloudRunTaskIndex: "0",
        cloudRunTaskAttempt: "1",
      },
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
    expect(mocks.setExtra).not.toHaveBeenCalled();
  });

  it("keeps retry logs available before Sentry is initialized", () => {
    mocks.isInitialized.mockReturnValue(false);

    reportSourceBreadcrumb("RSS feed retry scheduled", {
      sourceType: "lozenets-sofia-bg",
      diagnosticCode: "rss-feed-retry",
      feedAttempt: 1,
    }, "warning");

    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.addBreadcrumb).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("keeps feed recovery running when adding a breadcrumb fails", () => {
    mocks.addBreadcrumb.mockImplementationOnce(() => {
      throw new Error("Telemetry unavailable");
    });

    expect(() => {
      reportSourceBreadcrumb("RSS feed recovered after retry", {
        sourceType: "lozenets-sofia-bg",
        diagnosticCode: "rss-feed-recovered",
        feedAttempts: 2,
      }, "info");
    }).not.toThrow();

    expect(mocks.info).toHaveBeenCalledOnce();
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });
});
