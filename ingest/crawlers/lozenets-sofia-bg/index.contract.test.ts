import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("lozenets-sofia-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "lozenets-sofia-bg",
    "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/",
    "hybrid",
    () => import("./index"),
    () => import("./extractors"),
  );

  it("wires discovery, source identity, locality and detail processing", async () => {
    await contract.assertWiring();
  });

  it("propagates orchestration failures to the runner", async () => {
    await contract.assertFailurePropagation();
  });
});
