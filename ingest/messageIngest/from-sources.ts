#!/usr/bin/env node

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import type { OboDb } from "@oboapp/db";
import { GeoJSONFeatureCollection } from "@/lib/types";
import { isWithinBoundaries, loadBoundaries } from "@/lib/boundary-utils";
import { logger } from "@/lib/logger";
import {
  getString,
  getOptionalString,
  getOptionalBoolean,
  getStringArray,
  isFeatureCollection,
} from "@/lib/record-fields";

interface SourceDocument {
  url: string;
  datePublished: string;
  title: string;
  message: string;
  sourceType: string;
  crawledAt: Date;
  geoJson?: string | GeoJSONFeatureCollection; // Can be stored as string in Firestore
  markdownText?: string; // Markdown-formatted message for display
  categories?: string[]; // Categories for precomputed GeoJSON sources
  isRelevant?: boolean; // Whether source is relevant for precomputed GeoJSON sources
  timespanStart?: Date; // Optional timespan start from source
  timespanEnd?: Date; // Optional timespan end from source
  cityWide?: boolean; // Whether source applies to entire city (hidden from map)
  locality?: string; // Locality identifier (e.g., 'bg.sofia')
  deepLinkUrl?: string; // User-facing URL override. Empty string = no deeplink. Omit to use url field.
}

interface IngestOptions {
  boundariesPath?: string;
  dryRun?: boolean;
  sourceType?: string;
  limit?: number;
}

interface IngestSummary {
  total: number;
  tooOld: number;
  withinBounds: number;
  outsideBounds: number;
  ingested: number;
  alreadyIngested: number;
  filtered: number;
  failed: number;
  errors: Array<{ url: string; error: string }>;
}



function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

async function fetchSources(
  db: OboDb,
  options: IngestOptions,
): Promise<SourceDocument[]> {
  const where: { field: string; op: "=="; value: unknown }[] = [];
  const filters: string[] = [];

  if (options.sourceType) {
    where.push({ field: "sourceType", op: "==", value: options.sourceType });
    filters.push(`sourceType=${options.sourceType}`);
  }

  if (options.limit) {
    filters.push(`limit=${options.limit}`);
  }

  const docs = await db.sources.findMany({
    where: where.length > 0 ? where : undefined,
    limit: options.limit,
  });

  const sources: SourceDocument[] = docs.map((data) => ({
    url: getString(data.url),
    datePublished: getString(data.datePublished),
    title: getString(data.title),
    message: getString(data.message),
    sourceType: getString(data.sourceType),
    crawledAt:
      data.crawledAt instanceof Date
        ? data.crawledAt
        : new Date(getString(data.crawledAt) || Date.now()),
    geoJson: isFeatureCollection(data.geoJson) ? data.geoJson
      : getOptionalString(data.geoJson),
    markdownText: getOptionalString(data.markdownText),
    categories: getStringArray(data.categories),
    isRelevant: getOptionalBoolean(data.isRelevant),
    timespanStart: toDate(data.timespanStart),
    timespanEnd: toDate(data.timespanEnd),
    cityWide: getOptionalBoolean(data.cityWide),
    locality: getOptionalString(data.locality),
    deepLinkUrl: getOptionalString(data.deepLinkUrl),
  }));

  const filterInfo = filters.length > 0 ? ` (${filters.join(", ")})` : "";
  logger.info("Fetched sources", {
    count: sources.length,
    filters: filterInfo || undefined,
  });
  return sources;
}

async function getAlreadyIngestedSet(
  db: OboDb,
  sources: SourceDocument[],
): Promise<Set<string>> {
  if (sources.length === 0) {
    return new Set();
  }

  const { encodeDocumentId } = await import("../crawlers/shared/firestore");
  const sourceDocumentIds = sources.map((s) => encodeDocumentId(s.url));

  const docs = await db.messages.findBySourceDocumentIds(sourceDocumentIds, [
    "sourceDocumentId",
  ]);

  const alreadyIngestedIds = new Set<string>();
  for (const doc of docs) {
    const sourceDocId = getOptionalString(doc.sourceDocumentId);
    if (sourceDocId) {
      alreadyIngestedIds.add(sourceDocId);
    }
  }

  return alreadyIngestedIds;
}

async function ingestSource(
  source: SourceDocument,
  _db: OboDb,
  dryRun: boolean,
  boundaries: GeoJSONFeatureCollection | null,
  sourceDocumentId: string,
): Promise<boolean> {
  if (dryRun) {
    logger.info("[dry-run] Would ingest source", { title: source.title });
    return true;
  }

  const logMeta: Record<string, unknown> = {
    title: source.title,
    url: source.url,
    sourceType: source.sourceType,
  };
  if (source.timespanStart && source.timespanEnd) {
    logMeta.timespanStart = source.timespanStart.toISOString();
    logMeta.timespanEnd = source.timespanEnd.toISOString();
  } else if (source.geoJson) {
    logMeta.warning =
      "Source has precomputed GeoJSON but missing timespans (will fallback to crawledAt)";
  }
  logger.info("Processing message", logMeta);

  // Parse geoJson if it's a string
  let geoJson: GeoJSONFeatureCollection | null = null;
  if (source.geoJson) {
    if (typeof source.geoJson === "string") {
      const parsed: unknown = JSON.parse(source.geoJson);
      geoJson = isFeatureCollection(parsed) ? parsed : null;
    } else {
      geoJson = source.geoJson;
    }
  }

  // Dynamically import messageIngest to avoid loading firebase-admin at startup
  const { messageIngest } = await import("./index");

  if (!source.locality) {
    throw new Error(`Source missing required locality field: ${source.url}`);
  }

  // Use the sourceType as the source identifier for messageIngest
  // sourceDocumentId always derives from source.url for correct deduplication.
  // sourceUrl carries the user-facing URL: use deepLinkUrl if explicitly set
  // (empty string = no user-facing link), otherwise fall back to source.url.
  const userFacingUrl =
    source.deepLinkUrl === undefined
      ? source.url
      : source.deepLinkUrl || undefined;
  const result = await messageIngest(source.message, source.sourceType, {
    precomputedGeoJson: geoJson,
    sourceUrl: userFacingUrl,
    sourceDocumentId,
    boundaryFilter: boundaries ?? undefined,
    crawledAt: source.crawledAt,
    markdownText: source.markdownText,
    categories: source.categories,
    isRelevant: source.isRelevant,
    timespanStart: source.timespanStart,
    timespanEnd: source.timespanEnd,
    cityWide: source.cityWide,
    locality: source.locality,
  });

  logger.info("Completed processing source", {
    title: source.title,
    messagesCreated: result.messages.length,
    totalCategorized: result.totalCategorized,
    totalRelevant: result.totalRelevant,
    totalIrrelevant: result.totalIrrelevant,
    messageIds: result.messages.map((m) => m.id),
  });
  return true;
}

async function filterByAge(
  sources: SourceDocument[],
  maxAgeInDays: number = 90,
): Promise<{ recentSources: SourceDocument[]; tooOld: number }> {
  const recentSources: SourceDocument[] = [];
  let tooOld = 0;

  // Normalize to midnight UTC to avoid timezone/time-of-day issues
  const nowDate = new Date();
  nowDate.setUTCHours(0, 0, 0, 0);
  const now = nowDate.getTime();
  const maxAgeMs = maxAgeInDays * 24 * 60 * 60 * 1000;

  for (const source of sources) {
    const publishedDate = new Date(source.datePublished);
    const ageMs = now - publishedDate.getTime();

    if (ageMs >= maxAgeMs) {
      tooOld++;
    } else {
      recentSources.push(source);
    }
  }

  if (tooOld > 0) {
    logger.info("Age filter applied", {
      recent: recentSources.length,
      tooOld,
      maxAgeInDays,
    });
  }

  return { recentSources, tooOld };
}

async function filterByBoundaries(
  sources: SourceDocument[],
  boundaries: GeoJSONFeatureCollection | null,
): Promise<{ withinBounds: SourceDocument[]; outsideBounds: number }> {
  if (!boundaries) {
    return { withinBounds: sources, outsideBounds: 0 };
  }

  const withinBounds: SourceDocument[] = [];
  let outsideBounds = 0;

  for (const source of sources) {
    if (!source.geoJson) {
      // If no geoJson, we can't check boundaries, include it
      withinBounds.push(source);
      continue;
    }

    const parsed: unknown = typeof source.geoJson === "string"
      ? JSON.parse(source.geoJson)
      : source.geoJson;
    const geoJson = isFeatureCollection(parsed) ? parsed : null;

    // Validate GeoJSON structure
    if (
      !geoJson ||
      typeof geoJson !== "object" ||
      !Array.isArray(geoJson.features)
    ) {
      logger.warn("Invalid GeoJSON for source", { url: source.url });
      // Include sources with invalid GeoJSON to avoid skipping them
      withinBounds.push(source);
      continue;
    }

    if (isWithinBoundaries(geoJson, boundaries)) {
      withinBounds.push(source);
    } else {
      outsideBounds++;
    }
  }

  logger.info("Boundary filter applied", {
    withinBounds: withinBounds.length,
    outsideBounds,
  });

  return { withinBounds, outsideBounds };
}

async function maybeInitDb(): Promise<OboDb> {
  const { getDb } = await import("@/lib/db");
  return getDb();
}

export async function ingest(
  options: IngestOptions = {},
): Promise<IngestSummary> {
  logger.info("Starting source ingestion", {
    mode: options.dryRun ? "dry-run" : "production",
  });

  const boundaries = loadBoundaries(options.boundariesPath);
  if (boundaries) {
    logger.info("Using boundary filtering");
  }
  const db = await maybeInitDb();

  const allSources = await fetchSources(db, options);

  // Filter by age first (skip sources older than 90 days)
  const { recentSources, tooOld } = await filterByAge(allSources);

  // Note: For sources WITH precomputed geoJson (toplo-bg, sofiyska-voda),
  // we still do the boundary filtering here at the source level
  // For sources WITHOUT geoJson (rayon-oborishte-bg, sofia-bg),
  // filtering will happen during messageIngest after geocoding
  const { withinBounds, outsideBounds } = await filterByBoundaries(
    recentSources,
    boundaries,
  );

  // Batch-check which sources are already ingested (avoids 1371 sequential DB queries!)
  const { encodeDocumentId } = await import("../crawlers/shared/firestore");
  const alreadyIngestedSet = await getAlreadyIngestedSet(db, withinBounds);
  const sourcesToIngest = withinBounds.filter(
    (s) => !alreadyIngestedSet.has(encodeDocumentId(s.url)),
  );
  const alreadyIngestedCount = withinBounds.length - sourcesToIngest.length;

  if (alreadyIngestedCount > 0) {
    logger.info("Skipping already-ingested sources", {
      count: alreadyIngestedCount,
    });
  }

  const summary: IngestSummary = {
    total: allSources.length,
    tooOld,
    withinBounds: withinBounds.length,
    outsideBounds,
    ingested: 0,
    alreadyIngested: alreadyIngestedCount,
    filtered: 0,
    failed: 0,
    errors: [],
  };

  for (const source of sourcesToIngest) {
    const sourceDocumentId = encodeDocumentId(source.url);
    try {
      const wasIngested = await ingestSource(
        source,
        db,
        options.dryRun ?? false,
        boundaries,
        sourceDocumentId,
      );
      if (wasIngested) {
        summary.ingested++;
      }
    } catch (error) {
      summary.failed++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Don't log as error if it's just outside boundaries or filtered as irrelevant
      if (errorMessage.includes("No features within specified boundaries")) {
        logger.info("Source outside boundaries after geocoding", {
          title: source.title,
        });
      } else if (errorMessage.includes("Message filtering failed")) {
        summary.filtered++;
        logger.info("Source filtered as irrelevant", { title: source.title });
      } else {
        summary.errors.push({ url: source.url, error: errorMessage });
        logger.error("Failed to ingest source", {
          title: source.title,
          error: errorMessage,
          url: source.url,
        });
      }
    }
  }

  logSummary(summary, options.dryRun ?? false);
  return summary;
}

function logSummary(summary: IngestSummary, dryRun: boolean): void {
  const summaryData: Record<string, unknown> = {
    total: summary.total,
    dryRun,
  };

  if (summary.tooOld > 0) {
    summaryData.tooOld = summary.tooOld;
  }
  if (summary.withinBounds < summary.total - summary.tooOld) {
    summaryData.withinBounds = summary.withinBounds;
    summaryData.outsideBounds = summary.outsideBounds;
  }
  if (dryRun) {
    summaryData.wouldIngest = summary.withinBounds - summary.alreadyIngested;
  } else {
    summaryData.ingested = summary.ingested;
    summaryData.alreadyIngested = summary.alreadyIngested;
    if (summary.filtered > 0) {
      summaryData.filtered = summary.filtered;
      summaryData.filterPercentage = (
        (summary.filtered / summary.withinBounds) *
        100
      ).toFixed(1);
    }
    if (summary.failed > 0) {
      summaryData.failed = summary.failed;
    }
  }

  logger.info("Ingestion summary", summaryData);

  if (summary.errors.length > 0) {
    logger.error("Ingestion errors", { errors: summary.errors });
  }
}
// Run only when executed directly
if (require.main === module) {
  const program = new Command();

  program
    .name("ingest:from-sources")
    .description("Ingest source documents from the database into messages")
    .option("-b, --boundaries <path>", "Path to GeoJSON boundaries file")
    .option("--dry-run", "Preview ingestion without actually writing")
    .option("-s, --source-type <type>", "Only ingest sources of this type")
    .option("-l, --limit <n>", "Maximum number of sources to process", parseInt)
    .addHelpText(
      "after",
      `
Examples:
  $ npx tsx ingest/messageIngest/from-sources
  $ npx tsx ingest/messageIngest/from-sources --source-type rayon-oborishte-bg
  $ npx tsx ingest/messageIngest/from-sources --dry-run --limit 10
`,
    )
    .action(async (opts) => {
      dotenv.config({ path: resolve(process.cwd(), ".env.local"), debug: false });
      const options: IngestOptions = {
        boundariesPath: opts.boundaries,
        dryRun: opts.dryRun,
        sourceType: opts.sourceType,
        limit: opts.limit,
      };
      await ingest(options);
    });

  program.parseAsync().catch((error) => {
    logger.error("Ingestion failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
