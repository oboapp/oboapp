import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "inspectorat-so-org",
  "https://inspectorat-so.org/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8",
  "webpage",
  () => import("./index"),
  () => import("./extractors"),
);
