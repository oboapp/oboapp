import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSource } from "@oboapp/source-inspectorat-so-org";
import { metadata } from "@oboapp/source-inspectorat-so-org/metadata";
import { crawl } from "./index";

const mocks = vi.hoisted(() => {
  return {
    db: {},
    getDb: vi.fn(),
    runSource: vi.fn(),
    info: vi.fn(),
  };
});
vi.mock("@/lib/db", () => {
  return { getDb: mocks.getDb };
});
vi.mock("@/sources/run-source", () => {
  return { runSource: mocks.runSource };
});
vi.mock("@/lib/logger", () => {
  return { logger: { info: mocks.info } };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.runSource.mockResolvedValue({ saved: 1, skipped: 2, failed: 0 });
});

describe("inspectorat-so-org package entrypoint", () => {
  it("runs the published factory with its historical identity and reports totals", async () => {
    await crawl();
    expect(metadata.id).toBe("inspectorat-so-org");
    expect(metadata.localities).toEqual(["bg.sofia"]);
    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(mocks.db, metadata, createSource);
    expect(mocks.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: "inspectorat-so-org",
      saved: 1,
      skipped: 2,
      failed: 0,
    });
  });

  it("propagates failed scans to the existing scheduler", async () => {
    mocks.runSource.mockRejectedValueOnce(new Error("Listing unavailable"));
    await expect(crawl()).rejects.toThrow("Listing unavailable");
  });
});
