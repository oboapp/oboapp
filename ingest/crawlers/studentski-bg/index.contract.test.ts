import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "studentski-bg",
  "https://studentski.bg/category/%d0%b3%d1%80%d0%b0%d1%84%d0%b8%d1%86%d0%b8/feed/",
  "hybrid",
  () => import("./index"),
  () => import("./extractors"),
);
