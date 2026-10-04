import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("mladost-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "mladost-bg",
    "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti",
    "webpage",
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
