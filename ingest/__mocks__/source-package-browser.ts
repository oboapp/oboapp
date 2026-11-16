import { createRequire } from "node:module";

const consumerRequire = createRequire(import.meta.url);

/** Resolve the source's own Playwright instance when pnpm installs multiple versions. */
export function getPackagedChromium(
  sourcePackage: string,
  ...dependencyPath: string[]
): typeof import("playwright").chromium {
  let packageRequire = createRequire(consumerRequire.resolve(sourcePackage));
  for (const dependency of dependencyPath) {
    packageRequire = createRequire(packageRequire.resolve(dependency));
  }

  const { chromium } = packageRequire("playwright") as typeof import("playwright");
  return chromium;
}
