import { createRequire } from "node:module";
import { join } from "node:path";
import {
  readInstalledPackageManifest,
  readInstalledSourcePackages,
  type InstalledSourcePackageDetails,
} from "@/sources/installed-packages";
import { getSelectedSourceIds } from "@/sources/registry";

function getBrowserRequire(source: InstalledSourcePackageDetails): NodeJS.Require | undefined {
  const sourceRequire = createRequire(join(source.directory, "package.json"));
  if (Object.hasOwn(source.dependencies, "playwright")) {
    return sourceRequire;
  }
  const helperName = "@oboapp/source-web-utils";
  if (!Object.hasOwn(source.dependencies, helperName)) {
    return undefined;
  }
  const helper = readInstalledPackageManifest(helperName, sourceRequire.resolve(helperName));
  if (!Object.hasOwn(helper.dependencies, "playwright")) {
    return undefined;
  }
  return createRequire(join(helper.directory, "package.json"));
}

function getIngestDirectory(): string {
  return readInstalledPackageManifest("oboapp-ingest", __filename).directory;
}

export async function checkSourceBrowsers(ingestDirectory = getIngestDirectory()): Promise<void> {
  const selectedIds = new Set(getSelectedSourceIds());
  const packages = readInstalledSourcePackages(ingestDirectory)
    .filter((source) => selectedIds.has(source.metadata.id));
  for (const source of packages) {
    try {
      const browserRequire = getBrowserRequire(source);
      if (!browserRequire) {
        continue;
      }
      const playwright: typeof import("playwright") = browserRequire("playwright");
      const browser = await playwright.chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      try {
        const page = await browser.newPage();
        await page.setContent("<p>Browser check</p>");
        const text = await page.textContent("p");
        if (text !== "Browser check") {
          throw new Error("Failed to render a page");
        }
      } finally {
        await browser.close();
      }
    } catch (error) {
      throw new Error(`Chromium check failed for ${source.name}`, { cause: error });
    }

    console.log(`Chromium check passed for ${source.name}`);
  }
}

export async function runSourceBrowserChecks(ingestDirectory = getIngestDirectory()): Promise<void> {
  try {
    await checkSourceBrowsers(ingestDirectory);
  } catch (error: unknown) {
    console.error("Source Chromium check failed", error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runSourceBrowserChecks();
}
