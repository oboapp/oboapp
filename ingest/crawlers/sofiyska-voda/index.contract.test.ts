// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSource } from "@oboapp/source-sofiyska-voda";
import { metadata } from "@oboapp/source-sofiyska-voda/metadata";
import sourceDefinition from "../../../shared/src/sources/sofiyska-voda";
import { crawl } from "./index";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  runSource: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/sources/run-source", () => ({ runSource: mocks.runSource }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info } }));
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.runSource.mockResolvedValue({ saved: 1, skipped: 2, failed: 0 });
});

describe("Sofiyska Voda package entrypoint", () => {
  it("keeps catalog identity and runs the published factory through the platform", async () => {
    await crawl();

    expect(metadata).toEqual(sourceDefinition);
    expect(metadata).toEqual({
      id: "sofiyska-voda",
      name: "Софийска вода",
      url: "https://sofiyskavoda.bg/water-stops",
      localities: ["bg.sofia"],
      emergent: true,
    });
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(mocks.db, metadata, createSource);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("Crawl complete", {
      sourceType: "sofiyska-voda",
      saved: 1,
      skipped: 2,
      failed: 0,
    });
  });

  it.each([
    { saved: 1, skipped: 0, failed: 1 },
    { saved: 0, skipped: 1, failed: 1 },
    { saved: 0, skipped: 0, failed: 0 },
  ])("reports a completed scan with $saved saved, $skipped skipped and $failed failed", async (summary) => {
    mocks.runSource.mockResolvedValue(summary);

    await expect(crawl()).resolves.toBeUndefined();

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("Crawl complete", {
      sourceType: "sofiyska-voda",
      ...summary,
    });
  });

  it("keeps the failed-job signal when every interruption fails", async () => {
    mocks.runSource.mockResolvedValue({ saved: 0, skipped: 0, failed: 2 });

    await expect(crawl()).rejects.toThrow("All Sofiyska Voda interruptions failed to process");

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("Crawl complete", {
      sourceType: "sofiyska-voda",
      saved: 0,
      skipped: 0,
      failed: 2,
    });
  });

  it("propagates listing failures without reporting completed scan totals", async () => {
    mocks.runSource.mockRejectedValueOnce(new Error("ArcGIS listing unavailable"));

    await expect(crawl()).rejects.toThrow("ArcGIS listing unavailable");

    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("propagates database initialization failures before starting collection", async () => {
    mocks.getDb.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(crawl()).rejects.toThrow("Storage unavailable");

    expect(mocks.runSource).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
