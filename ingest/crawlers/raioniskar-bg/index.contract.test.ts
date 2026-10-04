import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "raioniskar-bg",
  "https://raioniskar.bg/?c=pages/static&template=home&lang=bg",
  "webpage",
  () => import("./index"),
);
