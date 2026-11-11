import { beforeEach, describe, expect, it, vi } from "vitest";
import sourceDefinition from "../../../shared/src/sources/mladost-bg";
import { createSource } from "@oboapp/source-mladost-bg";
import { metadata } from "@oboapp/source-mladost-bg/metadata";
import { crawl } from "./index";

const mocks = vi.hoisted(() => {
  return {
    db: {},
    getDb: vi.fn(),
    runSource: vi.fn(),
    info: vi.fn(),
  };
});

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.runSource.mockResolvedValue({ saved: 1, skipped: 2, failed: 0 });
});

describe("mladost-bg package entrypoint", () => {
  it("keeps catalog metadata and runs the package factory with the existing database", async () => {
    await crawl();

    expect(metadata.id).toBe("mladost-bg");
    expect(metadata.localities).toEqual(["bg.sofia"]);
    expect(metadata).toEqual(sourceDefinition);
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(mocks.db, metadata, createSource);
    expect(mocks.info).toHaveBeenCalledWith("Crawl complete", {
      sourceType: "mladost-bg",
      saved: 1,
      skipped: 2,
      failed: 0,
    });
  });

  it("propagates a failed scan to the existing scheduler", async () => {
    mocks.runSource.mockRejectedValueOnce(new Error("Listing unavailable"));

    await expect(crawl()).rejects.toThrow("Listing unavailable");

    expect(mocks.info).not.toHaveBeenCalled();
  });
});
