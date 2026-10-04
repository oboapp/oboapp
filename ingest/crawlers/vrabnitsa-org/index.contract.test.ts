import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "vrabnitsa-org",
  "https://vrabnitsa.sofia.bg/aktualno/news",
  "webpage",
  () => import("./index"),
  () => import("./extractors"),
);
