import { describe, expect, it, vi } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";
import { crawlHybridRss } from "../shared/rss-crawler";
import { discoverItems } from "./discovery";

describe("sredec-sofia-org crawl contract", () => {
  const contract = sourceWrapperContract(
    "sredec-sofia-org",
    "https://sredec-sofia.org/category/публикации/полезна-информация/feed/",
    "hybrid",
    () => import("./index"),
    () => import("./extractors"),
  );

  it("wires discovery, source identity, locality and detail processing", async () => {
    await contract.assertWiring();
    expect(vi.mocked(crawlHybridRss).mock.calls[0][0].discoverItems).toBe(
      discoverItems,
    );
  });

  it("propagates orchestration failures to the runner", async () => {
    await contract.assertFailurePropagation();
  });
});
