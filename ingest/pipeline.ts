#!/usr/bin/env node

import { Command } from "commander";
import { resolve, join } from "node:path";
import dotenv from "dotenv";
import { verifyEnvSet, verifyDbEnv } from "@/lib/verify-env";
import { readdirSync, statSync } from "node:fs";
import { logger } from "@/lib/logger";
import { initSentry } from "@/lib/sentry";

const program = new Command();

// Define crawler groups
const EMERGENT_CRAWLERS = ["erm-zapad", "toplo-bg", "sofiyska-voda", "sensor-community"];

/**
 * Get available crawler sources by reading the crawlers directory
 */
function getAvailableSources(): string[] {
  const crawlersDir = join(__dirname, "crawlers");
  const entries = readdirSync(crawlersDir);

  return entries.filter((entry) => {
    const fullPath = join(crawlersDir, entry);
    const isDirectory = statSync(fullPath).isDirectory();
    // Exclude 'shared' directory
    return isDirectory && entry !== "shared";
  });
}

async function runCrawler(source: string): Promise<boolean> {
  logger.info(`Running crawler: ${source}`, { step: "crawl", source });
  try {
    const crawlerPath = `./crawlers/${source}/index.js`;
    const crawler = await import(crawlerPath);
    await crawler.crawl();
    logger.info(`Crawler ${source} completed`, { step: "crawl", source });
    return true;
  } catch (error) {
    logger.error(
      `Crawler ${source} failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        step: "crawl",
        source,
      },
    );
    return false;
  }
}

async function runIngest(): Promise<void> {
  logger.info("Running ingest pipeline", { step: "ingest" });
  try {
    const { ingest } = await import("./messageIngest/from-sources");
    await ingest({});
    logger.info("Ingest completed", { step: "ingest" });
  } catch (error) {
    logger.error(
      `Ingest failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        step: "ingest",
      },
    );
    throw error;
  }
}

async function runNotify(): Promise<void> {
  logger.info("Running notification matching", { step: "notify" });
  try {
    const { main } = await import("./notifications/match-and-notify");
    await main();
    logger.info("Notify completed", { step: "notify" });
  } catch (error) {
    logger.error(
      `Notify failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        step: "notify",
      },
    );
    throw error;
  }
}

async function runPipeline(crawlers: string[], pipelineName: string) {
  logger.info(`Starting ${pipelineName} pipeline`, {
    pipeline: pipelineName,
    crawlers,
  });

  const results: Array<{ source: string; success: boolean }> = [];

  try {
    // Run all crawlers sequentially, track successes and failures
    for (const crawler of crawlers) {
      const success = await runCrawler(crawler);
      results.push({ source: crawler, success });
    }

    // Report crawler results
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    logger.info(
      `Crawler results: ${successful.length} succeeded, ${failed.length} failed`,
      {
        pipeline: pipelineName,
        succeeded: successful.map((r) => r.source),
        failed: failed.map((r) => r.source),
      },
    );

    // Continue with ingest and notify even if some crawlers failed
    // This ensures that successfully crawled data is processed
    await runIngest();
    await runNotify();

    if (failed.length > 0) {
      logger.error(
        `${pipelineName} pipeline completed with ${failed.length} crawler failure(s)`,
        {
          pipeline: pipelineName,
          failedCrawlers: failed.map((r) => r.source),
        },
      );
      process.exit(1); // Exit with error to signal partial failure
    } else {
      logger.info(`${pipelineName} pipeline completed successfully`, {
        pipeline: pipelineName,
      });
      process.exit(0);
    }
  } catch (error) {
    logger.error(
      `${pipelineName} pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        pipeline: pipelineName,
      },
    );
    process.exit(1);
  }
}

program
  .name("pipeline")
  .description("Run data ingestion pipeline with crawlers, ingest, and notify")
  .option(
    "--emergent",
    "Run only emergent crawlers (ERM, Toplo, Sofiyska Voda)",
  )
  .option("--all", "Run all crawlers")
  .addHelpText("after", () => {
    const longFlowCrawlers = getAvailableSources().filter(
      (crawler) => !EMERGENT_CRAWLERS.includes(crawler),
    );
    return `
Crawler Groups:
  Emergent crawlers (short-lived messages, run every 30 minutes):
    ${EMERGENT_CRAWLERS.map((c) => `- ${c}`).join("\n    ")}
  
  Long-flow crawlers (WordPress-based, run 3x daily):
    ${longFlowCrawlers.map((c) => `- ${c}`).join("\n    ")}

Examples:
  $ npx tsx pipeline --emergent
  $ npx tsx pipeline --all
`;
  })
  .action(async (options) => {
    // Ensure environment variables are loaded and required keys are present
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    initSentry();
    verifyDbEnv();
    verifyEnvSet([
      "GOOGLE_AI_API_KEY",
      "GOOGLE_AI_MODEL",
      "GOOGLE_MAPS_API_KEY",
    ]);

    // Validate that exactly one option is provided
    if (options.emergent && options.all) {
      logger.error("Cannot use both --emergent and --all options");
      process.exit(1);
    }

    if (!options.emergent && !options.all) {
      logger.error("Must specify either --emergent or --all");
      program.help();
    }

    if (options.emergent) {
      await runPipeline(EMERGENT_CRAWLERS, "EMERGENT");
    } else if (options.all) {
      const allCrawlers = getAvailableSources();
      await runPipeline(allCrawlers, "FULL");
    }
  });

program.parse();
