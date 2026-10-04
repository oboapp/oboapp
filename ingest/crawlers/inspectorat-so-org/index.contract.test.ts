import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("inspectorat-so-org crawl contract", () => {
  const contract = sourceWrapperContract(
    "inspectorat-so-org",
    "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8",
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
