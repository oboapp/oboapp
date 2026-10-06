import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("sdvr-mvr-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "sdvr-mvr-bg",
    "https://www.mvr.bg/sdvr/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BF%D1%80%D0%B5%D1%81%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8",
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
