import { createRequire } from "node:module";

const browserSources = [
  { source: "@oboapp/source-rayon-oborishte-bg" },
  { source: "@oboapp/source-so-slatina-org" },
  { source: "@oboapp/source-lozenets-sofia-bg", browserDependency: "@oboapp/source-web-utils" },
  { source: "@oboapp/source-studentski-bg", browserDependency: "@oboapp/source-web-utils" },
  { source: "@oboapp/source-sredec-sofia-org", browserDependency: "@oboapp/source-web-utils" },
  { source: "@oboapp/source-rayon-ilinden-bg", browserDependency: "@oboapp/source-web-utils" },
  { source: "@oboapp/source-nadezhda-org", browserDependency: "@oboapp/source-web-utils" },
  { source: "@oboapp/source-raioniskar-bg", browserDependency: "@oboapp/source-web-utils" },
];

export async function checkSourceBrowsers(): Promise<void> {
  for (const { source, browserDependency } of browserSources) {
    try {
      const sourceRequire = createRequire(require.resolve(source));
      const browserRequire = browserDependency
        ? createRequire(sourceRequire.resolve(browserDependency))
        : sourceRequire;
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
      throw new Error(`Chromium check failed for ${source}`, { cause: error });
    }

    console.log(`Chromium check passed for ${source}`);
  }
}

export async function runSourceBrowserChecks(): Promise<void> {
  try {
    await checkSourceBrowsers();
  } catch (error: unknown) {
    console.error("Source Chromium check failed", error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runSourceBrowserChecks();
}
