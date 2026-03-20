import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { isWithinBounds } from "@oboapp/shared";
import { getLocality } from "../../lib/target-locality";
import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";
import { logger } from "@/lib/logger";

const GTFS_URL = "https://gtfs.sofiatraffic.bg/api/v1/static";

export interface GTFSStop {
  stopCode: string;
  stopName: string;
  lat: number;
  lng: number;
}

/**
 * Download and extract GTFS ZIP file, returning stops.txt content
 */
async function downloadAndExtractGTFS(): Promise<string> {
  logger.info("Downloading GTFS data", { url: GTFS_URL });

  const response = await fetch(GTFS_URL);

  if (!response.ok) {
    throw new Error(
      `Failed to download GTFS: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  logger.info("Extracting stops.txt from ZIP archive");
  const zip = new AdmZip(buffer);
  const stopsEntry = zip.getEntry("stops.txt");

  if (!stopsEntry) {
    throw new Error("stops.txt not found in GTFS archive");
  }

  return stopsEntry.getData().toString("utf-8");
}

/**
 * Parse stops.txt CSV content into GTFSStop objects
 * Validates coordinates are within target locality and rounds to 6 decimals
 */
export function parseStopsFile(csvContent: string): GTFSStop[] {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const locality = getLocality();
  const stops: GTFSStop[] = [];
  let skippedOutOfBounds = 0;
  let skippedNoCode = 0;

  for (const record of records) {
    const stopCode = record.stop_code?.trim();
    const stopName = record.stop_name?.trim();
    const lat = Number.parseFloat(record.stop_lat);
    const lng = Number.parseFloat(record.stop_lon);

    // Skip stops without a stop_code
    if (!stopCode) {
      skippedNoCode++;
      continue;
    }

    // Validate coordinates
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      logger.warn("Invalid coordinates for stop", {
        stopCode,
        lat: record.stop_lat,
        lng: record.stop_lon,
      });
      continue;
    }

    // Validate within target locality boundaries
    if (!isWithinBounds(locality, lat, lng)) {
      skippedOutOfBounds++;
      continue;
    }

    stops.push({
      stopCode,
      stopName: stopName || stopCode,
      lat: roundCoordinate(lat),
      lng: roundCoordinate(lng),
    });
  }

  if (skippedNoCode > 0) {
    logger.info("Skipped stops without stop_code", { count: skippedNoCode });
  }
  if (skippedOutOfBounds > 0) {
    logger.info("Skipped stops outside Sofia boundaries", {
      count: skippedOutOfBounds,
    });
  }

  return stops;
}

/**
 * Sync GTFS stops to database in batches
 * Uses upsert (set with merge) to update existing records
 */
export async function syncGTFSStopsToFirestore(): Promise<void> {
  logger.info("Starting GTFS stops sync");

  const csvContent = await downloadAndExtractGTFS();
  const stops = parseStopsFile(csvContent);

  logger.info("Parsed valid stops", { count: stops.length });

  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  const stopBatch = stops.map((stop) => ({
    stopCode: stop.stopCode,
    data: {
      stopCode: stop.stopCode,
      stopName: stop.stopName,
      coordinates: {
        latitude: stop.lat,
        longitude: stop.lng,
      },
      lastUpdated: new Date(),
    },
  }));

  await db.gtfsStops.upsertBatch(stopBatch);

  logger.info("Successfully synced bus stops to database", {
    count: stops.length,
  });
}
