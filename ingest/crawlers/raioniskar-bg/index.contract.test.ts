import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("raioniskar-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "raioniskar-bg",
    "https://raioniskar.bg/?c=pages/static&template=home&lang=bg",
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
