import { sourceWrapperContract } from "@/__tests__/source-wrapper-contract";

sourceWrapperContract(
  "triaditsa-org",
  "https://triaditza.org/category/%D0%BD%D0%BE%D0%B2%D0%B8%D0%BD%D0%B8-%D0%B8-%D1%81%D1%8A%D0%B1%D0%B8%D1%82%D0%B8%D1%8F/feed/",
  "full",
  () => import("./index"),
);
