import { describe, it } from "vitest";
import { sourceWrapperContract } from "@/__mocks__/source-wrapper-contract";

describe("rayon-pancharevo-bg crawl contract", () => {
  const contract = sourceWrapperContract(
    "rayon-pancharevo-bg",
    "https://www.pancharevo.org/%D1%80%D0%B5%D0%BC%D0%BE%D0%BD%D1%82%D0%B8-%D0%B8-%D0%B8%D0%BD%D1%84%D1%80%D0%B0%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0",
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
