/**
 * sensor-community crawler — emergent (30-min interval).
 *
 * Reads raw PM readings from the ReadingsStore (GCS in prod, local FS in dev),
 * groups them into ~4km grid cells, applies outlier filtering + NowCast AQI,
 * and triggers alerts when thresholds are breached.
 *
 * Design notes:
 * - Sustained alerts compare two non-overlapping halves of the evaluation window:
 *   [t-4h, t-2h) and [t-2h, now].
 * - windowTimestamp is floored to 30-minute boundaries for deterministic
 *   deduplication URLs.
 * - The minimum sensor count (MIN_SENSORS_PER_CELL) is enforced after outlier
 *   filtering so that only valid sensors contribute to the threshold check.
 */

import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";
import { getBoundsForLocality } from "@oboapp/shared";
import { saveSourceDocumentIfNew } from "../shared/firestore";
import type { SourceDocumentWithGeoJson } from "../shared/types";
import { buildGrid, assignToGridCell } from "@/lib/air-quality/grid";
import type { GridCell } from "@/lib/air-quality/grid";
import { filterOutliers } from "@/lib/air-quality/outlier-filter";
import type { ParsedReading } from "@/lib/air-quality/parse-sensor-response";
import { calculateNowCastAqi, getAqiLabel } from "@/lib/air-quality/aqi";
import {
  SOURCE_TYPE,
  EVALUATION_WINDOW_HOURS,
  HALF_WINDOW_HOURS,
  AQI_IMMEDIATE_THRESHOLD,
  AQI_SUSTAINED_THRESHOLD,
  MIN_SENSORS_PER_CELL,
  MIN_HOUR_COVERAGE,
  DEDUP_WINDOW_MS,
  MAX_STALENESS_MS,
} from "@/lib/air-quality/constants";

interface CellEvaluation {
  cell: GridCell;
  currentAqi: number;
  previousAqi: number;
  avgPm25: number;
  avgPm10: number;
  sensorCount: number;
  alertType: "immediate" | "sustained";
}

/**
 * Group readings by hourly bins and compute averages for NowCast.
 * Returns array of { pm25, pm10 } ordered most-recent first.
 */
function computeHourlyAverages(
  readings: ParsedReading[],
): { pm25: number; pm10: number }[] {
  const hourBins = new Map<number, { pm25Sum: number; pm10Sum: number; count: number }>();

  for (const r of readings) {
    const hour = r.timestamp.getTime();
    const hourKey = Math.floor(hour / 3_600_000);
    const bin = hourBins.get(hourKey) ?? { pm25Sum: 0, pm10Sum: 0, count: 0 };
    bin.pm25Sum += r.p2;
    bin.pm10Sum += r.p1;
    bin.count++;
    hourBins.set(hourKey, bin);
  }

  return [...hourBins.entries()]
    .sort(([a], [b]) => b - a)// most recent first
    .map(([, bin]) => ({
      pm25: bin.pm25Sum / bin.count,
      pm10: bin.pm10Sum / bin.count,
    }));
}

/**
 * Compute average PM values from readings.
 */
function computeAverages(readings: ParsedReading[]): { pm25: number; pm10: number } {
  if (readings.length === 0) return { pm25: 0, pm10: 0 };
  const pm25 = readings.reduce((sum, r) => sum + r.p2, 0) / readings.length;
  const pm10 = readings.reduce((sum, r) => sum + r.p1, 0) / readings.length;
  return { pm25, pm10 };
}

/**
 * Count unique sensors in a set of readings.
 */
function countUniqueSensors(readings: ParsedReading[]): number {
  return new Set(readings.map((r) => r.sensorId)).size;
}

/**
 * Build the deterministic dedup URL for a grid cell alert.
 * Uses 30-min floor timestamp so the same evaluation window produces the same URL.
 */
function buildAlertUrl(
  locality: string,
  cellId: string,
  now: number = Date.now(),
): string {
  const windowTimestamp = Math.floor(now / DEDUP_WINDOW_MS) * DEDUP_WINDOW_MS;
  return `sensor-community://${locality}/${cellId}/${windowTimestamp}`;
}

/**
 * Health guidance based on EAQI level.
 * Thresholds align with EEA recommendations.
 */
function getHealthGuidance(aqi: number): string {
  if (aqi >= 5) {
    return "Ограничи престоя на открито, особено при дихателни или сърдечни заболявания.";
  }
  return "Хора с дихателни или сърдечни заболявания може да усетят влошаване на симптомите.";
}

/**
 * Build notification text with AQI, PM values, sensor count, and health guidance.
 * The message is self-contained: explains what was detected, how (source + sensor count),
 * and what to do (health guidance) — so users trust the alert without needing a "learn more" link.
 */
function buildAlertText(
  eval_: CellEvaluation,
): { text: string; markdownText: string } {
  const label = getAqiLabel(eval_.currentAqi);
  const pm25Str = eval_.avgPm25.toFixed(1);
  const pm10Str = eval_.avgPm10.toFixed(0);
  const typeNote =
    eval_.alertType === "immediate"
      ? "Рязко влошаване"
      : "Продължително влошаване";
  const healthNote = getHealthGuidance(eval_.currentAqi);

  const text =
    `${typeNote} на качеството на въздуха. ` +
    `Европейски индекс: ${label}. ` +
    `PM2.5: ${pm25Str}, PM10: ${pm10Str} μg/m³. ` +
    `Измерено от ${eval_.sensorCount} сензора от мрежата sensor.community. ` +
    healthNote;

  const markdownText =
    `**${typeNote}** на качеството на въздуха\n\n` +
    `Данните от гражданската мрежа [sensor.community](https://sensor.community/) ` +
    `показват влошаване на качеството на въздуха в този район.\n\n` +
    `- Европейски индекс за качество на въздуха: **${label}**\n` +
    `- PM2.5: ${pm25Str} μg/m³\n` +
    `- PM10: ${pm10Str} μg/m³\n` +
    `- Измерено от ${eval_.sensorCount} независими сензора\n\n` +
    `⚠️ ${healthNote}`;

  return { text, markdownText };
}

export async function crawl(): Promise<void> {
  const locality = getLocality();
  const bounds = getBoundsForLocality(locality);
  const grid = buildGrid(bounds);

  logger.info("Starting crawler", {
    sourceType: SOURCE_TYPE,
    gridCells: grid.length,
  });

  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  const { createReadingsStore } = await import("@/lib/air-quality/readings-store");
  const store = createReadingsStore();

  const now = new Date();
  const windowStart = new Date(
    now.getTime() - EVALUATION_WINDOW_HOURS * 60 * 60 * 1000,
  );
  const halfPoint = new Date(
    now.getTime() - HALF_WINDOW_HOURS * 60 * 60 * 1000,
  );

  // Fetch all readings in the 4h evaluation window from the store
  const rawReadings = await store.getReadingsInRange(
    locality,
    windowStart,
    now,
  );

  logger.debug("Loaded readings", { sourceType: SOURCE_TYPE, count: rawReadings.length });

  if (rawReadings.length === 0) {
    logger.debug("No readings found, skipping", { sourceType: SOURCE_TYPE });
    return;
  }

  // Group readings by grid cell
  const cellReadings = new Map<string, ParsedReading[]>();
  for (const raw of rawReadings) {
    const reading: ParsedReading = { ...raw };

    const cell = assignToGridCell(grid, reading.lat, reading.lng);
    if (!cell) continue;

    const existing = cellReadings.get(cell.id) ?? [];
    existing.push(reading);
    cellReadings.set(cell.id, existing);
  }

  logger.debug("Readings distributed across grid cells", {
    sourceType: SOURCE_TYPE,
    cellCount: cellReadings.size,
  });

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const [cellId, readings] of cellReadings) {
    const cell = grid.find((c) => c.id === cellId);
    if (!cell) continue;

    // Apply outlier filtering
    const filtered = filterOutliers(readings);

    // Split into non-overlapping halves
    const previousHalf = filtered.filter(
      (r) => r.timestamp >= windowStart && r.timestamp < halfPoint,
    );
    const currentHalf = filtered.filter((r) => r.timestamp >= halfPoint);

    if (currentHalf.length === 0) continue;

    // Check sensor count from current half (the one used for alerts)
    const sensorCount = countUniqueSensors(currentHalf);
    if (sensorCount < MIN_SENSORS_PER_CELL) {
      logger.debug("Cell below sensor threshold, skipping", {
        sourceType: SOURCE_TYPE,
        cellId,
        sensorCount,
        minRequired: MIN_SENSORS_PER_CELL,
      });
      continue;
    }

    // Check hourly bin sparsity
    const currentHourly = computeHourlyAverages(currentHalf);
    const expectedHours = HALF_WINDOW_HOURS;
    if (currentHourly.length / expectedHours < MIN_HOUR_COVERAGE) {
      logger.debug("Cell below hour coverage, skipping", {
        sourceType: SOURCE_TYPE,
        cellId,
        hours: currentHourly.length,
        expectedHours,
      });
      continue;
    }

    // Freshness check: skip cell if newest reading in current half is stale
    const newestTimestamp = Math.max(...currentHalf.map((r) => r.timestamp.getTime()));
    if (now.getTime() - newestTimestamp > MAX_STALENESS_MS) {
      logger.debug("Cell data too stale, skipping", {
        sourceType: SOURCE_TYPE,
        cellId,
        stalenessMinutes: Math.round((now.getTime() - newestTimestamp) / 60_000),
      });
      continue;
    }

    const currentAqi = calculateNowCastAqi(currentHourly);

    // Compute previous half AQI once
    const previousHourly = computeHourlyAverages(previousHalf);
    const previousAqi =
      previousHourly.length > 0
        ? calculateNowCastAqi(previousHourly)
        : 0;

    // Determine alert type
    let alertType: "immediate" | "sustained" | null = null;

    if (currentAqi >= AQI_IMMEDIATE_THRESHOLD) {
      alertType = "immediate";
    } else if (currentAqi >= AQI_SUSTAINED_THRESHOLD) {
      // Need previous half to also exceed sustained threshold
      if (previousAqi >= AQI_SUSTAINED_THRESHOLD) {
        alertType = "sustained";
      }
    }

    if (!alertType) continue;
    const { pm25: avgPm25, pm10: avgPm10 } = computeAverages(currentHalf);

    const evaluation: CellEvaluation = {
      cell,
      currentAqi,
      previousAqi,
      avgPm25,
      avgPm10,
      sensorCount,
      alertType,
    };

    const url = buildAlertUrl(locality, cellId, now.getTime());
    const { text, markdownText } = buildAlertText(evaluation);

    const doc: SourceDocumentWithGeoJson = {
      url,
      deepLinkUrl: "",
      datePublished: now.toISOString(),
      title: `Влошено качество на въздуха – ${cellId}`,
      message: text,
      markdownText,
      sourceType: SOURCE_TYPE,
      locality,
      crawledAt: new Date(),
      geoJson: cell.geoJson,
      categories: ["air-quality"],
      isRelevant: true,
      timespanStart: halfPoint,
      timespanEnd: now,
    };

    try {
      const didSave = await saveSourceDocumentIfNew(doc, db);
      if (didSave) {
        logger.debug("Alert saved", {
          sourceType: SOURCE_TYPE,
          cellId,
          alertType,
          aqi: currentAqi,
          sensorCount,
        });
        saved++;
      } else {
        skipped++;
      }
    } catch (error) {
      logger.error("Failed to save alert", {
        sourceType: SOURCE_TYPE,
        cellId,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  logger.info("Crawl complete", {
    sourceType: SOURCE_TYPE,
    total: cellReadings.size,
    saved,
    skipped,
    failed,
  });
}
