import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSource } from "@oboapp/source-sdk";
import type { createSource } from "@oboapp/source-rayon-oborishte-bg";
import { metadata } from "@oboapp/source-rayon-oborishte-bg/metadata";
import { crawl } from "./index";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  runSource: vi.fn(),
  info: vi.fn(),
  reportSourceWarning: vi.fn(),
  createSource: vi.fn<typeof createSource>(),
}));
vi.mock("@oboapp/source-rayon-oborishte-bg", () => ({
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
vi.mock("@/lib/sentry", () => ({
  reportSourceWarning: mocks.reportSourceWarning,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.runSource.mockResolvedValue({ saved: 1, skipped: 2, failed: 0 });
});

describe("Oborishte package entrypoint", () => {
  it("runs the package with its historical identity and reports totals", async () => {
    await crawl();
    expect(metadata.id).toBe("rayon-oborishte-bg");
    expect(metadata.localities).toEqual(["bg.sofia"]);
    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      metadata,
      expect.any(Function),
    );
    expect(mocks.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: "rayon-oborishte-bg",
      saved: 1,
      skipped: 2,
      failed: 0,
    });
  });

  it("forwards source context and reports the original RSS failure through factory options", async () => {
    await crawl();
    const factory: CreateSource = mocks.runSource.mock.calls[0][2];
    const context = { locality: "bg.sofia" };
    const source = { discoverItems: vi.fn(), fetchItem: vi.fn() };
    mocks.createSource.mockReturnValue(source);

    expect(factory(context)).toBe(source);

    expect(mocks.createSource).toHaveBeenCalledExactlyOnceWith(context, {
      onRssFailure: expect.any(Function),
    });
    const onRssFailure = mocks.createSource.mock.calls[0][1]?.onRssFailure;
    if (!onRssFailure) {
      throw new Error("The RSS failure callback was not configured");
    }
    const error = new Error("RSS response contains an error page");

    await onRssFailure(error);

    expect(mocks.reportSourceWarning).toHaveBeenCalledExactlyOnceWith(
      "RSS discovery failed; trying WordPress posts API",
      {
        sourceType: "rayon-oborishte-bg",
        diagnosticCode: "rss-discovery-failure",
        feedUrl: "https://rayon-oborishte.bg/feed/",
        fallback: "wordpress-posts-api",
        error,
      },
    );
  });

  it("propagates a failed scan to the scheduler", async () => {
    mocks.runSource.mockRejectedValueOnce(new Error("Feed unavailable"));
    await expect(crawl()).rejects.toThrow("Feed unavailable");
  });
});
