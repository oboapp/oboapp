import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "sredec-sofia-org",
  "https://sredec-sofia.org/category/%d0%bf%d1%83%d0%b1%d0%bb%d0%b8%d0%ba%d0%b0%d1%86%d0%b8%d0%b8/%d0%bf%d0%be%d0%bb%d0%b5%d0%b7%d0%bd%d0%b0-%d0%b8%d0%bd%d1%84%d0%be%d1%80%d0%bc%d0%b0%d1%86%d0%b8%d1%8f/feed/",
  "hybrid",
  () => import("./index"),
  () => import("./extractors"),
);
