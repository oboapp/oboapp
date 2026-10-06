import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("nadezhda-org crawl contract", () => {
  const contract = sourceWrapperContract(
    "nadezhda-org",
    "https://nadezhda.sofia.bg/%D0%BE%D0%B1%D1%8F%D0%B2%D0%B8-%D0%B8-%D1%81%D1%8A%D0%BE%D0%B1%D1%89%D0%B5%D0%BD%D0%B8%D1%8F",
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
