#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { verifyEnvSet, verifyDbEnv } from "@/lib/verify-env";
import { logger } from "@/lib/logger";
import { initSentry, flushSentry } from "@/lib/sentry";
import { getLocalityDataSources } from "@/lib/locality-data-sources";
import type { IngestOptions } from "@/lib/types";

const program = new Command();

program
  .name("ingest")
  .description(
    "Ingest source documents from Firestore into messages with geocoding",
  )
  .option("--dry-run", "Preview ingestion without creating messages")
  .option("--source-name <name>", "Filter by specific source type")
  .option(
    "--since <date>",
    "Only process sources published since this date (YYYY-MM-DD)",
  )
  .option(
    "--until <date>",
    "Only process sources published until this date (YYYY-MM-DD)",
  )
  .option(
    "--boundaries <path>",
    "Optional: Path to GeoJSON boundaries file for additional geographic filtering",
  )
  .option("--limit <number>", "Limit number of sources to process", parseInt)
  .addHelpText(
    "after",
    `
Examples:
  $ npx tsx ingest --dry-run
  $ npx tsx ingest --source-name rayon-oborishte-bg
  $ npx tsx ingest --since 2025-01-01 --until 2025-12-31
  $ npx tsx ingest --limit 10 --dry-run
`,
  )
  .action(async (options) => {
    // Ensure environment variables are loaded and required keys are present
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    initSentry();
    verifyDbEnv();
    verifyEnvSet(["GOOGLE_AI_API_KEY", "GOOGLE_AI_MODEL"]);

    try {
      // Validate geocoding resolver config early — fail fast on misconfiguration
      const dataSources = getLocalityDataSources();

      // Only require GOOGLE_MAPS_API_KEY when a resolver actually uses google
      const resolvers = Object.values(dataSources["geocoding-resolvers"]);
      if (resolvers.some((r) => r.provider === "google")) {
        verifyEnvSet(["GOOGLE_MAPS_API_KEY"]);
      }

      // Dynamically import to avoid loading dependencies at parse time
      const { ingest } = await import("./messageIngest/from-sources");

      const ingestOptions: IngestOptions = {
        dryRun: options.dryRun,
        sourceType: options.sourceName,
        boundariesPath: options.boundaries,
        limit: options.limit,
      };

      // Add date filters if provided
      if (options.since) {
        ingestOptions.since = new Date(options.since);
      }
      if (options.until) {
        ingestOptions.until = new Date(options.until);
      }

      await ingest(ingestOptions);

      await flushSentry();
      process.exit(0);
    } catch (error) {
      logger.error(
        `Ingestion failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          step: "ingest",
        },
      );
      await flushSentry();
      process.exit(1);
    }
  });

program
  .command("gtfs-stops")
  .description("Sync GTFS bus stops from the configured locality provider to Firestore")
  .action(async () => {
    // Ensure environment variables are loaded
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    verifyDbEnv();

    try {
      // Validate geocoding resolver config early — fail fast on misconfiguration
      getLocalityDataSources();

      // Dynamically import to avoid loading dependencies at parse time
      const { syncGTFSStopsToFirestore } = await import("./geocoding/gtfs/service");

      await syncGTFSStopsToFirestore();

      logger.info("✅ GTFS stops sync completed successfully", {
        step: "gtfs-sync",
      });
      await flushSentry();
      process.exit(0);
    } catch (error) {
      logger.error(
        `GTFS stops sync failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          step: "gtfs-sync",
        },
      );
      await flushSentry();
      process.exit(1);
    }
  });

program
  .command("educational-facilities-sync")
  .description("Sync schools and kindergartens from the configured locality provider to Firestore")
  .action(async () => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });
    verifyDbEnv();

    try {
      // Validate geocoding resolver config early — fail fast on misconfiguration
      getLocalityDataSources();

      const { syncEducationalFacilities } = await import(
        "./geocoding/educational-facilities/service"
      );

      await syncEducationalFacilities();

      logger.info("✅ Educational facilities sync completed successfully", {
        step: "educational-facilities-sync",
      });
      await flushSentry();
      process.exit(0);
    } catch (error) {
      logger.error(
        `Educational facilities sync failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          step: "educational-facilities-sync",
        },
      );
      await flushSentry();
      process.exit(1);
    }
  });

program.parse();
