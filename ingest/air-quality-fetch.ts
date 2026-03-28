#!/usr/bin/env node

/**
 * Air quality fetch job.
 *
 * Standalone entry point that runs every 15 minutes via Cloud Scheduler.
 * Fetches raw PM2.5/PM10 readings from sensor.community API,
 * stores them in a JSON file (GCS in production, local FS in development),
 * and prunes readings older than the retention window.
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";
import { getBoundsForLocality } from "@oboapp/shared";
import { parseSensorResponse } from "@/lib/air-quality/parse-sensor-response";
import { SENSOR_COMMUNITY_API_URL } from "@/lib/air-quality/constants";
import { createReadingsStore } from "@/lib/air-quality/readings-store";

async function main() {
  const locality = getLocality();
  const bounds = getBoundsForLocality(locality);
  const apiUrl = `${SENSOR_COMMUNITY_API_URL}${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  logger.info(`[air-quality-fetch] Fetching sensor.community data for ${locality}`);
  logger.info(`[air-quality-fetch] API URL: ${apiUrl}`);

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `sensor.community API returned ${response.status}: ${response.statusText}`,
    );
  }

  const apiData: unknown[] = await response.json();
  logger.info(`[air-quality-fetch] Received ${apiData.length} raw entries`);

  const readings = parseSensorResponse(apiData, locality);
  logger.info(`[air-quality-fetch] Parsed ${readings.length} valid readings`);

  const store = createReadingsStore();
  const { stored, cleaned } = await store.appendAndPrune(locality, readings);

  logger.info(
    `[air-quality-fetch] Done: ${stored} stored, ${cleaned} cleaned`,
  );
}

main().catch((err) => {
  logger.error("[air-quality-fetch] Fatal error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
