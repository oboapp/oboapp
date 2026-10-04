import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("sredec-sofia-org crawl contract", () => {
  const contract = sourceWrapperContract(
    "sredec-sofia-org",
    "https://sredec-sofia.org/category/%d0%bf%d1%83%d0%b1%d0%bb%d0%b8%d0%ba%d0%b0%d1%86%d0%b8%d0%b8/%d0%bf%d0%be%d0%bb%d0%b5%d0%b7%d0%bd%d0%b0-%d0%b8%d0%bd%d1%84%d0%be%d1%80%d0%bc%d0%b0%d1%86%d0%b8%d1%8f/feed/",
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
