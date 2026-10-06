import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("rayon-ilinden-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "rayon-ilinden-bg",
    "https://ilinden.sofia.bg/category/%d0%be%d0%b1%d1%89%d0%b8%d0%bd%d0%b0/",
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
