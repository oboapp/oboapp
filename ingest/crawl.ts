#!/usr/bin/env node

import { Command } from "commander";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import dotenv from "dotenv";
import { verifyDbEnv } from "@/lib/verify-env";
import { logger } from "@/lib/logger";
import { initSentry } from "@/lib/sentry";

const program = new Command();

/**
 * Get available crawler sources by reading the crawlers directory
 */
function getAvailableSources(): string[] {
  const crawlersDir = join(__dirname, "crawlers");
  const entries = readdirSync(crawlersDir);

  return entries.filter((entry) => {
    const fullPath = join(crawlersDir, entry);
    const isDirectory = statSync(fullPath).isDirectory();
    // Exclude 'shared' and 'README.md'
    return isDirectory && entry !== "shared";
  });
}

program
  .name("crawl")
  .description("Run a web crawler to fetch data from external sources")
  .requiredOption("-s, --source <name>", "Source crawler to run")
  .addHelpText(
    "after",
    `
Available sources:
${getAvailableSources()
  .map((source) => `  - ${source}`)
  .join("\n")}

Examples:
  $ npx tsx crawl --source rayon-oborishte-bg
  $ npx tsx crawl --source sofia-bg
`,
  )
  .action(async (options) => {
    // Ensure environment variables are loaded and required keys are present
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    initSentry();
    verifyDbEnv();

    const availableSources = getAvailableSources();

    // Validate source
    if (!availableSources.includes(options.source)) {
      logger.error("Unknown source", {
        source: options.source,
        availableSources,
      });
      process.exit(1);
    }

    // Dynamically import and run the crawler
    try {
      const crawlerPath = `./crawlers/${options.source}/index.js`;
      logger.info(`Running crawler: ${options.source}`, {
        step: "crawl",
        source: options.source,
      });

      const crawler = await import(crawlerPath);
      await crawler.crawl();

      logger.info(`Crawler ${options.source} completed`, {
        step: "crawl",
        source: options.source,
      });
      process.exit(0);
    } catch (error) {
      logger.error(
        `Crawler ${options.source} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          step: "crawl",
          source: options.source,
        },
      );
      process.exit(1);
    }
  });

program.parse();
