import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "rayon-ilinden-bg",
  "https://ilinden.sofia.bg/category/%d0%be%d0%b1%d1%89%d0%b8%d0%bd%d0%b0/",
  "webpage",
  () => import("./index"),
);
