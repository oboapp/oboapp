import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSource } from "@oboapp/source-sdk";
import sourceDefinition from "../../../shared/src/sources/lozenets-sofia-bg";
import type { createSource } from "@oboapp/source-lozenets-sofia-bg";
import { metadata } from "@oboapp/source-lozenets-sofia-bg/metadata";
import { crawl } from "./index";

const mocks = vi.hoisted(() => {
  return {
    db: {},
    getDb: vi.fn(),
    runSource: vi.fn(),
    info: vi.fn(),
    createSource: vi.fn<typeof createSource>(),
    reportSourceBreadcrumb: vi.fn(),
  };
});

vi.mock("@oboapp/source-lozenets-sofia-bg", () => ({
  createSource: mocks.createSource,
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));
vi.mock("@/sources/run-source", () => ({
  runSource: mocks.runSource,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info },
}));
vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
}));
vi.mock("@/lib/sentry", () => ({
  reportSourceBreadcrumb: mocks.reportSourceBreadcrumb,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.runSource.mockResolvedValue({ saved: 1, skipped: 2, failed: 0 });
});

describe("Lozenets package entrypoint", () => {
  it("keeps catalog metadata and runs the published factory with the existing database", async () => {
    await crawl();

    expect(metadata.id).toBe("lozenets-sofia-bg");
    expect(metadata.localities).toEqual(["bg.sofia"]);
    expect(metadata).toEqual(sourceDefinition);
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(mocks.db, metadata, expect.any(Function));
    expect(mocks.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: "lozenets-sofia-bg",
      saved: 1,
      skipped: 2,
      failed: 0,
    });
  });

  it("forwards source context and maps feed events to flat retry and recovery diagnostics", async () => {
    await crawl();
    const factory: CreateSource = mocks.runSource.mock.calls[0][2];
    const context = { locality: "bg.sofia" };
    const source = { discoverItems: vi.fn(), fetchItem: vi.fn() };
    mocks.createSource.mockReturnValue(source);

    expect(factory(context)).toBe(source);
    expect(mocks.createSource).toHaveBeenCalledExactlyOnceWith(context, {
      onEvent: expect.any(Function),
    });
    const onEvent = mocks.createSource.mock.calls[0][1]?.onEvent;
    if (!onEvent) {
      throw new Error("The feed diagnostics callback was not configured");
    }
    const feedUrl = "https://lozenets.sofia.bg/feed/?paged=2";

    onEvent({
      type: "retry",
      url: feedUrl,
      pagination: "paged=2",
      attempt: 1,
      nextAttempt: 2,
      delayMs: 2_000,
      reason: "network",
      code: "ECONNRESET",
    });
    onEvent({
      type: "retry",
      url: feedUrl,
      pagination: "paged=2",
      attempt: 1,
      nextAttempt: 2,
      delayMs: 3_000,
      reason: "http",
      status: 503,
    });
    onEvent({ type: "recovered", url: feedUrl, pagination: "paged=2", attempts: 2 });

    expect(mocks.reportSourceBreadcrumb.mock.calls).toEqual([
      ["RSS feed retry scheduled", expect.objectContaining({
        sourceType: "lozenets-sofia-bg",
        diagnosticCode: "rss-feed-retry",
        feedUrl,
        pagination: "paged=2",
        feedAttempt: 1,
        nextFeedAttempt: 2,
        retryDelayMs: 2_000,
        retryReason: "network",
        networkCode: "ECONNRESET",
      }), "warning"],
      ["RSS feed retry scheduled", expect.objectContaining({
        sourceType: "lozenets-sofia-bg",
        diagnosticCode: "rss-feed-retry",
        feedUrl,
        feedAttempt: 1,
        nextFeedAttempt: 2,
        retryDelayMs: 3_000,
        retryReason: "http",
        httpStatus: 503,
      }), "warning"],
      ["RSS feed recovered after retry", {
        sourceType: "lozenets-sofia-bg",
        diagnosticCode: "rss-feed-recovered",
        feedUrl,
        pagination: "paged=2",
        feedAttempts: 2,
      }, "info"],
    ]);
  });

  it("propagates a failed scan to the existing scheduler", async () => {
    mocks.runSource.mockRejectedValueOnce(new Error("Feed unavailable"));

    await expect(crawl()).rejects.toThrow("Feed unavailable");

    expect(mocks.info).not.toHaveBeenCalled();
  });
});
