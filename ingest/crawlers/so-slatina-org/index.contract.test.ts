import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "so-slatina-org",
  "https://so-slatina.org/feed/",
  "hybrid",
  () => import("./index"),
);
