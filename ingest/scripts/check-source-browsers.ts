import { createRequire } from "node:module";

const browserSources = [
  "@oboapp/source-rayon-oborishte-bg",
  "@oboapp/source-so-slatina-org",
];

async function main(): Promise<void> {
  for (const source of browserSources) {
    try {
      const sourceRequire = createRequire(require.resolve(source));
      const playwright: typeof import("playwright") = sourceRequire("playwright");
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

main().catch((error: unknown) => {
  console.error("Source Chromium check failed", error);
  process.exitCode = 1;
});
