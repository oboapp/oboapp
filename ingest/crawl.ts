#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { verifyDbEnv } from "@/lib/verify-env";
import { logger } from "@/lib/logger";
import { initSentry, flushSentry } from "@/lib/sentry";
import { getSelectedSourceIds, runSelectedSource } from "@/sources/registry";

const program = new Command();

program
  .name("crawl")
  .description("Fetch data from a selected source")
  .requiredOption("-s, --source <name>", "Selected source to run")
  .addHelpText(
    "after",
    () => `
Selected sources:
${getSelectedSourceIds()
  .map((source) => `  - ${source}`)
  .join("\n")}
`,
  )
  .action(async (options: { source: string }) => {
    const availableSources = getSelectedSourceIds();

    // Validate source
    if (!availableSources.includes(options.source)) {
      logger.error("Source is not selected for this instance", {
        source: options.source,
        availableSources,
      });
      return process.exit(1);
    }

    // Configure the environment before loading any source implementation.
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    initSentry();
    verifyDbEnv();

    try {
      logger.info(`Running source: ${options.source}`, {
        step: "crawl",
        source: options.source,
      });

      await runSelectedSource(options.source);

      logger.info(`Source ${options.source} completed`, {
        step: "crawl",
        source: options.source,
      });
      await flushSentry();
      process.exit(0);
    } catch (error) {
      logger.error(
        `Source ${options.source} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          step: "crawl",
          source: options.source,
        },
      );
      await flushSentry();
      process.exit(1);
    }
  });

program.parse();
