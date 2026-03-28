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
  const sourceType = "sensor-community";
  const locality = getLocality();
  const bounds = getBoundsForLocality(locality);
  const apiUrl = `${SENSOR_COMMUNITY_API_URL}${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  logger.info("Starting air-quality-fetch", { sourceType, locality });
  logger.debug("Fetching sensor.community API", { sourceType, apiUrl });

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `sensor.community API returned ${response.status}: ${response.statusText}`,
    );
  }

  const apiDataRaw: unknown = await response.json();
  if (!Array.isArray(apiDataRaw)) {
    throw new Error(
      "sensor.community API returned non-array JSON payload",
    );
  }

  logger.debug("Received raw entries", { sourceType, count: apiDataRaw.length });

  const readings = parseSensorResponse(apiDataRaw, locality);
  logger.debug("Parsed valid readings", { sourceType, count: readings.length });

  const store = createReadingsStore();
  const { stored, cleaned } = await store.appendAndPrune(locality, readings);

  logger.info("Air quality fetch complete", { sourceType, locality, stored, cleaned });
}

main().catch((err) => {
  logger.error("[air-quality-fetch] Fatal error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
