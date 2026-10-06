import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("studentski-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "studentski-bg",
    "https://studentski.bg/category/%d0%b3%d1%80%d0%b0%d1%84%d0%b8%d1%86%d0%b8/feed/",
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
