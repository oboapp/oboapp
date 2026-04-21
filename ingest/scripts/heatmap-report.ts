#!/usr/bin/env tsx
/**
 * Generate a heatmap snapshot for the history page.
 *
 * Scans all finalized messages with GeoJSON, extracts coordinate points,
 * and saves a compact snapshot to GCS. The web heatmap route loads this
 * snapshot instead of querying Firestore on every request.
 *
 * Usage:
 *   pnpm tsx ingest/scripts/heatmap-report.ts
 *   pnpm tsx ingest/scripts/heatmap-report.ts --dry-run  # print stats, skip GCS write
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { center, lineString, polygon } from "@turf/turf";
import type { GeoJSONFeatureCollection, GeoJSONGeometry } from "@/lib/types";
import type { HeatmapMessage } from "@/lib/heatmap/snapshot-store";

type HeatmapPoint = [number, number]; // [lat, lng] (Leaflet convention)

function isGeoJsonFeatureCollection(
  value: unknown,
): value is GeoJSONFeatureCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    "features" in value &&
    Array.isArray((value as GeoJSONFeatureCollection).features)
  );
}

/**
 * Convert a single GeoJSON geometry to one or more heatmap [lat, lng] points.
 * Used when producing the GCS heatmap snapshot that the web heatmap route loads.
 */
function geometryToPoints(geometry: GeoJSONGeometry): HeatmapPoint[] {
  try {
    if (geometry.type === "MultiPoint") {
      return geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    }
    if (geometry.type === "Point") {
      const [lng, lat] = geometry.coordinates;
      return [[lat, lng]];
    }
    if (geometry.type === "LineString" && geometry.coordinates.length > 0) {
      const c = center(lineString(geometry.coordinates));
      const [lng, lat] = c.geometry.coordinates;
      return [[lat, lng]];
    }
    if (geometry.type === "Polygon" && geometry.coordinates.length > 0) {
      const c = center(polygon(geometry.coordinates));
      const [lng, lat] = c.geometry.coordinates;
      return [[lat, lng]];
    }
  } catch {
    // skip malformed geometries
  }
  return [];
}

function extractPoints(geoJson: GeoJSONFeatureCollection): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];
  for (const feature of geoJson.features) {
    if (feature?.geometry) {
      points.push(...geometryToPoints(feature.geometry));
    }
  }
  return points;
}

const program = new Command();

program
  .name("heatmap-report")
  .description("Generate a GCS heatmap snapshot from finalized messages")
  .option("--dry-run", "Print stats without writing to GCS")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm tsx ingest/scripts/heatmap-report.ts
  $ pnpm tsx ingest/scripts/heatmap-report.ts --dry-run
`,
  )
  .action(async (opts: { dryRun?: boolean }) => {
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });

    try {
      const { getDb, closeDb } = await import("@/lib/db");
      const { saveHeatmapSnapshot } =
        await import("@/lib/heatmap/snapshot-store");

      const db = await getDb();

      try {
        console.log("Fetching finalized messages...");
        const docs = await db.messages.findMany({
          where: [{ field: "finalizedAt", op: ">", value: new Date(0) }],
          select: [
            "_id",
            "geoJson",
            "cityWide",
            "finalizedAt",
            "categories",
            "source",
          ],
        });

        console.log(`Processing ${docs.length} finalized messages...`);

        const messages: HeatmapMessage[] = [];
        for (const doc of docs) {
          if (doc.cityWide) continue;

          const geoJson = isGeoJsonFeatureCollection(doc.geoJson)
            ? doc.geoJson
            : null;
          if (!geoJson) continue;

          const points = extractPoints(geoJson);
          if (points.length === 0) continue;

          const finalizedAt =
            doc.finalizedAt instanceof Date
              ? doc.finalizedAt.toISOString()
              : typeof doc.finalizedAt === "string"
                ? doc.finalizedAt
                : "";

          messages.push({
            id: String(doc._id),
            source: typeof doc.source === "string" ? doc.source : "",
            categories: Array.isArray(doc.categories) ? doc.categories : [],
            cityWide: false,
            finalizedAt,
            points,
          });
        }

        const snapshot = {
          generatedAt: new Date().toISOString(),
          messages,
        };

        console.log(
          `Snapshot: ${messages.length} messages with heatmap points`,
        );

        if (opts.dryRun) {
          console.log("Dry run — skipping GCS write");
        } else {
          await saveHeatmapSnapshot(snapshot);
          console.log("Heatmap snapshot saved to GCS");
        }
      } finally {
        await closeDb();
      }
    } catch (error) {
      console.error("Fatal error", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
