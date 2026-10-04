import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "lozenets-sofia-bg",
  "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/",
  "hybrid",
  () => import("./index"),
  () => import("./extractors"),
);
