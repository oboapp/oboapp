import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("so-slatina-org crawl contract", () => {
  const contract = sourceWrapperContract(
    "so-slatina-org",
    "https://so-slatina.org/feed/",
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
