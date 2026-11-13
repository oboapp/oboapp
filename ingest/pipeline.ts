#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { verifyEnvSet, verifyDbEnv } from "@/lib/verify-env";
import { logger } from "@/lib/logger";
import { initSentry, flushSentry } from "@/lib/sentry";
import {
  getSelectedSourceIds,
  getEmergentSourceIds,
  runSelectedSource,
} from "@/sources/registry";

const program = new Command();

async function runCrawler(source: string): Promise<boolean> {
  logger.info(`Running crawler: ${source}`, { step: "crawl", source });
  try {
    await runSelectedSource(source);
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
      await flushSentry();
      process.exit(1); // Exit with error to signal partial failure
    } else {
      logger.info(`${pipelineName} pipeline completed successfully`, {
        pipeline: pipelineName,
      });
      await flushSentry();
      process.exit(0);
    }
  } catch (error) {
    logger.error(
      `${pipelineName} pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        pipeline: pipelineName,
      },
    );
    await flushSentry();
    process.exit(1);
  }
}

program
  .name("pipeline")
  .description("Collect selected source data, ingest messages, and send notifications")
  .option(
    "--emergent",
    "Run selected sources on the emergent schedule",
  )
  .option("--all", "Run all selected sources")
  .addHelpText("after", () => {
    const emergentSources = getEmergentSourceIds();
    const longFlowCrawlers = getSelectedSourceIds().filter(
      (source) => !emergentSources.includes(source),
    );
    return `
Selected source groups:
  Emergent sources (run every 30 minutes):
    ${emergentSources.map((source) => `- ${source}`).join("\n    ")}
  
  Other sources (run 3x daily):
    ${longFlowCrawlers.map((source) => `- ${source}`).join("\n    ")}

Examples:
  $ npx tsx pipeline --emergent
  $ npx tsx pipeline --all
`;
  })
  .action(async (options: { emergent?: boolean; all?: boolean }) => {
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
      return process.exit(1);
    }

    if (!options.emergent && !options.all) {
      logger.error("Must specify either --emergent or --all");
      program.help();
    }

    if (options.emergent) {
      await runPipeline(getEmergentSourceIds(), "EMERGENT");
    } else if (options.all) {
      const allCrawlers = getSelectedSourceIds();
      await runPipeline(allCrawlers, "FULL");
    }
  });

program.parse();
