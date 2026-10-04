import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "sofia-capital-of-sport",
  "https://sofia2018.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/",
  "hybrid",
  () => import("./index"),
);
