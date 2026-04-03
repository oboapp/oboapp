#!/usr/bin/env tsx
/**
 * Manually pre-cache a single geocoded location for a given message.
 *
 * Reads geocoded data (pins and street geometries) from a message's
 * process[] geocoding step (populated during ingestion), and stores the
 * result in the geocode cache collection so future ingestion runs skip
 * the API call entirely.
 *
 * Usage:
 *   # Cache a pin address (reads from message.process[] geocoding step, falls back to message.addresses[])
 *   pnpm tsx ingest/scripts/geocode-cache-add.ts \
 *     --message <messageId> --address "ул. Граф Игнатиев 10" --type pin
 *
 *   # Cache a full street geometry (reads from message.process[] geocoding step)
 *   pnpm tsx ingest/scripts/geocode-cache-add.ts \
 *     --message <messageId> --address "бул. Витоша" --type street
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import type { Feature, MultiLineString } from "geojson";
import { normalizePinAddress } from "@oboapp/shared";
import type { Address, StreetSection } from "@/lib/types";
import type {
  GeocodingPinEntry,
  GeocodingStreetEntry,
} from "@/messageIngest/geocoding-progress-tracker";
import { isRecord } from "@/lib/record-fields";

function isGeocodingPinEntry(v: unknown): v is GeocodingPinEntry {
  return (
    isRecord(v) &&
    typeof v["key"] === "string" &&
    typeof v["originalText"] === "string" &&
    typeof v["formattedAddress"] === "string" &&
    isRecord(v["coordinates"]) &&
    typeof v["coordinates"]["lat"] === "number" &&
    typeof v["coordinates"]["lng"] === "number"
  );
}

function isGeocodingStreetEntry(v: unknown): v is GeocodingStreetEntry {
  return (
    isRecord(v) &&
    typeof v["key"] === "string" &&
    typeof v["originalName"] === "string" &&
    typeof v["geometry"] === "string"
  );
}

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Extract geocoded pins and streets from a message's process[] array.
 * Prefers the final `geocoding` step. For interrupted runs (no `geocoding` step),
 * falls back to merging all `geocodingBatch` entries for the most recent runId.
 */
function extractGeocodingData(msg: Record<string, unknown>): {
  pins: GeocodingPinEntry[];
  streets: GeocodingStreetEntry[];
} {
  const rawProcess = msg["process"];
  if (!Array.isArray(rawProcess)) return { pins: [], streets: [] };

  const steps = rawProcess.filter(
    (s): s is Record<string, unknown> =>
      isRecord(s) && typeof s["step"] === "string",
  );

  // Prefer last completed geocoding step
  const geocodingSteps = steps.filter((s) => s["step"] === "geocoding");
  if (geocodingSteps.length > 0) {
    const last = geocodingSteps[geocodingSteps.length - 1];
    return {
      pins: Array.isArray(last["pins"])
        ? last["pins"].filter(isGeocodingPinEntry)
        : [],
      streets: Array.isArray(last["streets"])
        ? last["streets"].filter(isGeocodingStreetEntry)
        : [],
    };
  }

  // Fall back: merge geocodingBatch entries for the most recent runId (interrupted run)
  const batchSteps = steps.filter(
    (s): s is Record<string, unknown> & { runId: string } =>
      s["step"] === "geocodingBatch" && typeof s["runId"] === "string",
  );
  if (batchSteps.length > 0) {
    const lastRunId = batchSteps[batchSteps.length - 1].runId;
    const batchesForRun = batchSteps.filter((s) => s["runId"] === lastRunId);
    return {
      pins: batchesForRun.flatMap((s) =>
        Array.isArray(s["pins"]) ? s["pins"].filter(isGeocodingPinEntry) : [],
      ),
      streets: batchesForRun.flatMap((s) =>
        Array.isArray(s["streets"])
          ? s["streets"].filter(isGeocodingStreetEntry)
          : [],
      ),
    };
  }

  return { pins: [], streets: [] };
}

async function cachePin(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  messageId: string,
  address: string,
): Promise<void> {
  const msg = await db.messages.findById(messageId);
  if (!msg) {
    console.error(`❌ Message "${messageId}" not found`);
    process.exitCode = 1;
    return;
  }

  const normalized = normalizePinAddress(address);

  // Primary source: geocoding process step (supports both complete and interrupted runs)
  const { pins } = extractGeocodingData(msg);
  let match = pins.find((p) => p.key === normalized);

  // Fallback: message.addresses[] (for messages ingested before the geocoding step was added)
  if (!match) {
    const legacyAddresses = (msg.addresses ?? []) as Address[];
    const legacyMatch = legacyAddresses.find(
      (a) =>
        normalizePinAddress(a.originalText) === normalized ||
        normalizePinAddress(a.formattedAddress) === normalized,
    );
    if (legacyMatch) {
      match = {
        key: normalized,
        originalText: legacyMatch.originalText,
        formattedAddress: legacyMatch.formattedAddress,
        coordinates: legacyMatch.coordinates,
        geoJson: legacyMatch.geoJson,
      };
    }
  }

  if (!match) {
    const hasPins = pins.length > 0;
    console.error(
      `❌ Address "${address}" (normalized: "${normalized}") not found in ${
        hasPins ? "geocoding step pins" : "message addresses"
      }.`,
    );
    if (hasPins) {
      console.error(`   Available pins:`);
      for (const p of pins) {
        console.error(`   - "${p.originalText}" / "${p.formattedAddress}"`);
      }
    } else {
      const legacyAddresses = (msg.addresses ?? []) as Address[];
      if (legacyAddresses.length > 0) {
        console.error(`   Available addresses:`);
        for (const a of legacyAddresses) {
          console.error(`   - "${a.originalText}" / "${a.formattedAddress}"`);
        }
      } else {
        console.error(`   Message has no geocoded data. Has it been ingested?`);
      }
    }
    process.exitCode = 1;
    return;
  }

  const existing = await db.geocodeCachePins.findByKey(normalized);
  if (existing) {
    console.error(
      `❌ Key "${normalized}" already exists in cache (id: ${existing._id as string}). Remove it first to re-cache.`,
    );
    process.exitCode = 1;
    return;
  }

  if (!match.geoJson) {
    console.error(`❌ Matched address has no GeoJSON geometry stored.`);
    process.exitCode = 1;
    return;
  }

  await db.geocodeCachePins.insertOne({
    key: normalized,
    originalText: match.originalText,
    formattedAddress: match.formattedAddress,
    coordinates: match.coordinates,
    geoJson: match.geoJson,
    sourceService: "google",
    sourceMessageId: messageId,
    cachedAt: new Date(),
  });

  const count = await db.geocodeCachePins.count();
  console.log(`✅ Cached pin "${normalized}" from message "${messageId}"`);
  console.log(
    `   Coordinates: ${match.coordinates.lat}, ${match.coordinates.lng}`,
  );
  console.log(`   Total pins in cache: ${count}`);
}

async function cacheStreet(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  messageId: string,
  streetName: string,
): Promise<void> {
  const msg = await db.messages.findById(messageId);
  if (!msg) {
    console.error(`❌ Message "${messageId}" not found`);
    process.exitCode = 1;
    return;
  }

  const normalized = normalizePinAddress(streetName);

  // Read street geometry from the geocoding process step
  const { streets } = extractGeocodingData(msg);
  const storedEntry = streets.find((g) => g.key === normalized);

  if (!storedEntry) {
    console.error(
      `❌ No geometry found for "${streetName}" (normalized: "${normalized}") in message.process.`,
    );
    if (streets.length > 0) {
      console.error(`   Available streets:`);
      for (const s of streets) {
        console.error(`   - "${s.originalName}"`);
      }
    } else {
      console.error(
        `   Message has no geocoded street geometries. Re-ingest the message first.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const existing = await db.geocodeCacheStreets.findByKey(normalized);
  if (existing) {
    console.error(
      `❌ Key "${normalized}" already exists in cache (id: ${existing._id as string}). Remove it first to re-cache.`,
    );
    process.exitCode = 1;
    return;
  }

  let geometry: Feature<MultiLineString>;
  try {
    const parsed: unknown = JSON.parse(storedEntry.geometry);
    if (
      !isRecord(parsed) ||
      parsed["type"] !== "Feature" ||
      !isRecord(parsed["geometry"]) ||
      parsed["geometry"]["type"] !== "MultiLineString"
    ) {
      console.error(
        `❌ Stored geometry for "${normalized}" is not a GeoJSON Feature<MultiLineString>. Check the data and try again.`,
      );
      process.exitCode = 1;
      return;
    }
    geometry = parsed as unknown as Feature<MultiLineString>;
  } catch {
    console.error(
      `❌ Invalid street geometry value in message.process for messageId "${messageId}" and key "${normalized}".`,
    );
    console.error(
      `   The stored geometry value could not be parsed as JSON. Check the data and try again.`,
    );
    process.exitCode = 1;
    return;
  }

  const streets2 = (msg.streets ?? []) as StreetSection[];
  const matchedStreet = streets2.find(
    (s) => normalizePinAddress(s.street) === normalized,
  );

  await db.geocodeCacheStreets.insertOne({
    key: normalized,
    originalText: matchedStreet?.street ?? storedEntry.originalName,
    geoJson: geometry,
    sourceService: "overpass",
    sourceMessageId: messageId,
    cachedAt: new Date(),
  });

  const count = await db.geocodeCacheStreets.count();
  console.log(`✅ Cached street "${normalized}" from message "${messageId}"`);
  console.log(
    `   Geometry: ${geometry.geometry.coordinates.length} line segment(s)`,
  );
  console.log(`   Total streets in cache: ${count}`);
}

async function main(opts: {
  message: string;
  address: string;
  type: "pin" | "street";
}): Promise<void> {
  const { getDb, closeDb } = await import("@/lib/db");
  const db = await getDb();

  try {
    if (opts.type === "pin") {
      await cachePin(db, opts.message, opts.address);
    } else {
      await cacheStreet(db, opts.message, opts.address);
    }
  } finally {
    await closeDb();
  }
}

const program = new Command();

program
  .name("geocode-cache-add")
  .description("Pre-cache a geocoded pin or street geometry in the database")
  .requiredOption("--message <id>", "Message ID to use as the source")
  .requiredOption(
    "--address <text>",
    "Address or street name to cache (must exist in the message)",
  )
  .requiredOption("--type <pin|street>", "Type of location to cache")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm tsx ingest/scripts/geocode-cache-add.ts --message abc123 --address "ул. Граф Игнатиев 10" --type pin
  $ pnpm tsx ingest/scripts/geocode-cache-add.ts --message abc123 --address "бул. Витоша" --type street
`,
  )
  .action(async (opts: { message: string; address: string; type: string }) => {
    if (opts.type !== "pin" && opts.type !== "street") {
      console.error(`❌ --type must be "pin" or "street", got "${opts.type}"`);
      process.exit(1);
    }
    await main({ ...opts, type: opts.type as "pin" | "street" });
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
