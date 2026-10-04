import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "krasna-polyana-org",
  "https://krasnapolyana.bg/home/latest-news",
  "webpage",
  () => import("./index"),
  () => import("./extractors"),
);
