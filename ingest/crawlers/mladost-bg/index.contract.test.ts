import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "mladost-bg",
  "https://mladost.bg/gradska-i-okolna-sreda/planovi-remonti",
  "webpage",
  () => import("./index"),
);
