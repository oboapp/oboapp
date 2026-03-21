#!/usr/bin/env node
import { resolve } from "node:path";
import dotenv from "dotenv";
import { delay } from "@/lib/delay";
import { validateAndFixGeoJSON } from "../shared/geojson-validation";
import { launchBrowser } from "../shared/browser";
import { saveSourceDocumentIfNew } from "../shared/firestore";
import { parseBulgarianDateTime } from "../shared/date-utils";
import {
  buildGeoJSON,
  buildPlainTextMessage,
  buildMarkdownMessage,
  buildTitle,
} from "./builders";
import { extractPinRecords } from "./extractors";
import { deduplicatePinRecords } from "./deduplication";
import { parseTimespans } from "./timespan-parsing";
import { groupPinsByEventId } from "./grouping";
import { logger } from "@/lib/logger";
import type {
  ApiResponse,
  CrawlSummary,
  ErmZapadSourceDocument,
  Municipality,
  PinRecord,
  RawIncident,
} from "./types";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const BASE_URL = "https://info.ermzapad.bg";
const INDEX_URL = `${BASE_URL}/webint/vok/avplan.php`;
const API_URL = INDEX_URL;
const SOURCE_TYPE = "erm-zapad";
const LOCALITY = "bg.sofia";

/**
 * Discover active София-град municipalities from the index page
 */
async function discoverMunicipalities(): Promise<Municipality[]> {
  logger.debug("Discovering София-град municipalities", { sourceType: SOURCE_TYPE });

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(INDEX_URL, { waitUntil: "networkidle" });

    const municipalities = await page.evaluate(() => {
      const results: Municipality[] = [];

      // Find the Sofia-City region card
      const headers = Array.from(document.querySelectorAll("h5.card-title"));
      const sofiaHeader = headers.find((h) =>
        h.textContent?.includes("Област София-град"),
      );

      if (!sofiaHeader) {
        return results;
      }

      // Get the parent card-body
      const cardBody = sofiaHeader.closest("div.card-body");
      if (!cardBody) {
        return results;
      }

      // Find all municipality list items
      const listItems = cardBody.querySelectorAll("ul.list-group li");

      listItems.forEach((li) => {
        const onclick = li.getAttribute("onclick");
        if (!onclick) return;

        // Extract municipality code from onclick="show_obstina('SOF16','SOF'); ..."
        const match = /show_obstina\('([^']+)'/.exec(onclick);
        if (!match) return;

        const code = match[1];

        // Extract municipality name from text content
        const text = li.textContent?.trim() || "";
        // Format: "  община ПАНЧАРЕВО" or "  община КРАСНО СЕЛО" - extract just the name
        const nameMatch = /община\s+(.+)/i.exec(text);
        const name = nameMatch ? nameMatch[1].trim() : text;

        if (code && name) {
          results.push({ code, name });
        }
      });

      return results;
    });

    logger.debug("Found municipalities", {
      sourceType: SOURCE_TYPE,
      count: municipalities.length,
      municipalities: municipalities.map((m) => `${m.code}: ${m.name}`),
    });

    return municipalities;
  } finally {
    await browser.close();
  }
}

/**
 * Fetch incidents for a specific municipality
 */
async function fetchMunicipalityIncidents(
  code: string,
): Promise<RawIncident[]> {
  const formData = new URLSearchParams({
    action: "draw",
    gm_obstina: code,
    lat: "0",
    lon: "0",
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch incidents for ${code}: ${response.status} ${response.statusText}`,
    );
  }

  const data: ApiResponse = await response.json();

  // Convert object to array of incidents
  const incidents: RawIncident[] = [];
  for (const [, incident] of Object.entries(data)) {
    if (incident && typeof incident === "object") {
      incidents.push(incident);
    }
  }

  return incidents;
}

/**
 * Convert pins for the same incident to a single source document
 */
function buildSourceDocument(pins: PinRecord[]): ErmZapadSourceDocument | null {
  if (pins.length === 0) {
    logger.warn("Skipping empty pin array", { sourceType: SOURCE_TYPE });
    return null;
  }

  // Use first pin for metadata (all pins from same incident share these fields)
  const pin = pins[0];

  // Validate required fields
  if (!pin.eventId || typeof pin.eventId !== "string") {
    logger.warn("Skipping pin without eventId", { sourceType: SOURCE_TYPE });
    return null;
  }

  // Build GeoJSON with all pins for this incident
  const geoJson = buildGeoJSON(pins);
  if (!geoJson) {
    logger.warn("Skipping incident without geometry", { sourceType: SOURCE_TYPE, eventId: pin.eventId });
    return null;
  }

  // Validate and fix GeoJSON
  const validation = validateAndFixGeoJSON(geoJson, pin.eventId);
  if (!validation.isValid || !validation.geoJson) {
    logger.warn("Invalid GeoJSON for incident", {
      sourceType: SOURCE_TYPE,
      eventId: pin.eventId,
      errors: validation.errors,
    });
    return null;
  }

  // Log any coordinate fixes
  if (validation.warnings.length > 0) {
    logger.warn("Fixed GeoJSON for incident", {
      sourceType: SOURCE_TYPE,
      eventId: pin.eventId,
      warnings: validation.warnings,
    });
  }

  const url = `${BASE_URL}/incidents/${pin.eventId}`;
  const title = buildTitle(pin);
  const message = buildPlainTextMessage(pin);
  const markdownText = buildMarkdownMessage(pin);

  // Use pin start time as published date, fallback to current time
  let datePublished = new Date().toISOString();
  if (pin.begin_event) {
    try {
      datePublished = parseBulgarianDateTime(pin.begin_event).toISOString();
    } catch {
      logger.warn("Invalid date format", {
        sourceType: SOURCE_TYPE,
        eventId: pin.eventId,
        beginEvent: pin.begin_event,
      });
    }
  }

  const { timespanStart, timespanEnd } = parseTimespans(pin);

  return {
    url,
    deepLinkUrl: "", // erm-zapad does not have individual incident pages
    datePublished,
    title,
    message,
    markdownText,
    sourceType: SOURCE_TYPE,
    locality: LOCALITY,
    crawledAt: new Date(),
    geoJson: JSON.stringify(validation.geoJson),
    categories: ["electricity"],
    isRelevant: true,
    timespanStart,
    timespanEnd,
  };
}

/**
 * Process incidents for a municipality and return pin records
 */
async function processMunicipality(
  municipality: Municipality,
): Promise<PinRecord[]> {
  logger.debug("Processing municipality", {
    sourceType: SOURCE_TYPE,
    name: municipality.name,
    code: municipality.code,
  });

  try {
    const incidents = await fetchMunicipalityIncidents(municipality.code);
    logger.debug("Found incidents for municipality", {
      sourceType: SOURCE_TYPE,
      municipality: municipality.name,
      count: incidents.length,
    });

    if (incidents.length === 0) {
      return [];
    }

    // Extract pin records from all incidents
    const allPins: PinRecord[] = [];
    for (const incident of incidents) {
      const pins = extractPinRecords(incident);
      allPins.push(...pins);
    }

    logger.debug("Extracted pins", { sourceType: SOURCE_TYPE, municipality: municipality.name, count: allPins.length });
    return allPins;
  } catch (error) {
    logger.error("Failed to fetch incidents for municipality", {
      sourceType: SOURCE_TYPE,
      code: municipality.code,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Re-throw to fail the crawl
  }
}

/**
 * Save incidents to database and update summary
 */
async function saveIncidents(
  incidentMap: Map<string, PinRecord[]>,
  db: import("@oboapp/db").OboDb,
  summary: CrawlSummary,
): Promise<void> {
  for (const [eventId, pins] of incidentMap) {
    try {
      const doc = buildSourceDocument(pins);
      if (!doc) {
        summary.skipped++;
        continue;
      }

      const saved = await saveSourceDocumentIfNew(doc, db);
      if (saved) {
        logger.debug("Saved incident", {
          sourceType: SOURCE_TYPE,
          title: doc.title,
          pinCount: pins.length,
        });
        summary.saved++;
      } else {
        summary.skipped++;
      }
    } catch (error) {
      logger.error("Failed to process incident", {
        sourceType: SOURCE_TYPE,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      summary.failed++;
    }
  }
}

/**
 * Main crawler function
 */
async function crawl(): Promise<void> {
  logger.info("Starting crawler", { sourceType: SOURCE_TYPE });

  const startTime = Date.now();
  const totalSummary: CrawlSummary = { saved: 0, skipped: 0, failed: 0 };

  try {
    // Discover municipalities
    const municipalities = await discoverMunicipalities();

    if (municipalities.length === 0) {
      logger.warn("No София-град municipalities found", { sourceType: SOURCE_TYPE });
      return;
    }

    // Collect all pins from all municipalities
    const allPins: PinRecord[] = [];
    for (const municipality of municipalities) {
      const pins = await processMunicipality(municipality);
      allPins.push(...pins);

      // Delay between municipalities
      if (municipality !== municipalities.at(-1)) {
        await delay(2000); // 2 second delay
      }
    }

    logger.debug("Total pins extracted", { sourceType: SOURCE_TYPE, count: allPins.length });

    // Deduplicate globally across all municipalities
    const uniquePins = deduplicatePinRecords(allPins);
    logger.debug("Unique pins after deduplication", {
      sourceType: SOURCE_TYPE,
      uniqueCount: uniquePins.length,
      removedDuplicates: allPins.length - uniquePins.length,
    });

    // Group pins by eventId to handle potential duplicates across municipalities
    const incidentMap = groupPinsByEventId(uniquePins);

    logger.debug("Incidents after grouping", {
      sourceType: SOURCE_TYPE,
      incidentCount: incidentMap.size,
      totalPins: uniquePins.length,
    });

    // Dynamic import after dotenv.config
    const { getDb } = await import("@/lib/db");
    const db = await getDb();

    // Save all incidents
    await saveIncidents(incidentMap, db, totalSummary);

    // Final summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info("Crawl complete", {
      sourceType: SOURCE_TYPE,
      durationSeconds: duration,
      municipalities: municipalities.length,
      incidents: incidentMap.size,
      saved: totalSummary.saved,
      skipped: totalSummary.skipped,
      failed: totalSummary.failed,
    });

    // Exit with error if all failed
    if (
      totalSummary.failed > 0 &&
      totalSummary.saved === 0 &&
      totalSummary.skipped === 0
    ) {
      logger.error("All pins failed to process", { sourceType: SOURCE_TYPE });
      process.exit(1);
    }
  } catch (error) {
    logger.error("Crawl failed", {
      sourceType: SOURCE_TYPE,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  void crawl();
}

export { crawl };
