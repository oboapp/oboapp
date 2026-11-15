// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSource } from "@oboapp/source-nimh-severe-weather";
import { metadata } from "@oboapp/source-nimh-severe-weather/metadata";
import { crawl, main } from "./index";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  runSource: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
}));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));
vi.mock("@/sources/run-source", () => ({
  runSource: mocks.runSource,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, error: mocks.error },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(mocks.db);
  mocks.runSource.mockResolvedValue({ saved: 0, skipped: 0, failed: 0 });
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NIMH crawler job outcomes", () => {
  it.each([
    { saved: 1, skipped: 0, failed: 1 },
    { saved: 0, skipped: 1, failed: 1 },
  ])("allows partial success with $saved saved and $skipped skipped", async (summary) => {
    mocks.runSource.mockResolvedValue(summary);

    await crawl();

    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      metadata,
      createSource,
    );
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("Crawl complete", {
      sourceType: metadata.id,
      ...summary,
    });
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe("NIMH command entrypoint", () => {
  it("completes a warning-free scan without exiting with an error", async () => {
    await main();

    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      metadata,
      createSource,
    );
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("Crawl complete", {
      sourceType: metadata.id,
      saved: 0,
      skipped: 0,
      failed: 0,
    });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each([
    new Error("Database unavailable"),
    "Database unavailable",
  ])("reports a database setup rejection and fails the command: %s", async (error) => {
    mocks.getDb.mockRejectedValue(error);

    await main();

    expect(mocks.runSource).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Fatal error", {
      sourceType: metadata.id,
      error: "Database unavailable",
    });
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.error.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(process.exit).mock.invocationCallOrder[0],
    );
  });

  it("fails the command when every new warning failed to process", async () => {
    mocks.runSource.mockResolvedValue({ saved: 0, skipped: 0, failed: 2 });

    await main();

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Fatal error", {
      sourceType: metadata.id,
      error: "All NIMH warnings failed to process",
    });
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
