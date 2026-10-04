import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "rayon-oborishte-bg",
  "https://rayon-oborishte.bg/feed/",
  "hybrid",
  () => import("./index"),
);
