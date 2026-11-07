import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSource } from "@oboapp/source-rayon-oborishte-bg";
import { metadata } from "@oboapp/source-rayon-oborishte-bg/metadata";
import { crawl } from "./index";

const mocks = vi.hoisted(() => ({ db: {}, getDb: vi.fn(), runSource: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/sources/run-source", () => ({ runSource: mocks.runSource }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info } }));

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
    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(mocks.db, metadata, createSource);
    expect(mocks.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: "rayon-oborishte-bg",
      saved: 1,
      skipped: 2,
      failed: 0,
    });
  });

  it("propagates a failed scan to the scheduler", async () => {
    mocks.runSource.mockRejectedValueOnce(new Error("Feed unavailable"));
    await expect(crawl()).rejects.toThrow("Feed unavailable");
  });
});
