import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSource, SourceMetadata } from "@oboapp/source-sdk";
import { createSourceCrawler } from "./create-source-crawler";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  runSource: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("./run-source", () => ({ runSource: mocks.runSource }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info } }));

const metadata: SourceMetadata = {
  id: "example-source",
  name: "Example source",
  url: "https://example.com",
  localities: ["bg.sofia"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("packaged source entrypoint", () => {
  it("opens the database only when collection starts and reports its source totals", async () => {
    const db = {};
    const createSource = vi.fn<CreateSource>();
    const summary = { saved: 2, skipped: 3, failed: 1 };
    mocks.getDb.mockResolvedValue(db);
    mocks.runSource.mockResolvedValue(summary);

    const crawl = createSourceCrawler(metadata, createSource);
    expect(mocks.getDb).not.toHaveBeenCalled();

    await crawl();

    expect(mocks.runSource).toHaveBeenCalledExactlyOnceWith(db, metadata, createSource);
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("Crawl complete", {
      sourceType: "example-source",
      ...summary,
    });
  });

  it("propagates database initialization failure without opening the provider", async () => {
    const createSource = vi.fn<CreateSource>();
    mocks.getDb.mockRejectedValue(new Error("Database unavailable"));

    await expect(createSourceCrawler(metadata, createSource)()).rejects.toThrow("Database unavailable");

    expect(createSource).not.toHaveBeenCalled();
    expect(mocks.runSource).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
