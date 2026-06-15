#!/usr/bin/env tsx
/**
 * Manually geocode a street location for a given message using an alternate query.
 *
 * The geocoded geometry is written to the message's process[] array, making it
 * immediately visible in the geometry panel. The operator can then review the
 * result and decide whether to cache it via `geocode-cache:add`.
 *
 * Usage:
 *   pnpm geocode-cache:geocode \
 *     --street "ул. Ген. Гурко" \
 *     --query "Gen. Yosif V. Gurko, Centre, Sofia, Sredec" \
 *     --message "BPTN9bdd"
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePinAddress } from "@oboapp/shared";
import type { GeocodingStreetEntry } from "@/messageIngest/geocoding-progress-tracker";
import { isRecord } from "@/lib/record-fields";

function isGeocodingStreetEntry(v: unknown): v is GeocodingStreetEntry {
  return (
    isRecord(v) &&
    typeof v["key"] === "string" &&
    typeof v["originalName"] === "string" &&
    typeof v["geometry"] === "string"
  );
}

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function geocodeStreet(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  messageId: string,
  streetName: string,
  query: string,
): Promise<void> {
  const msg = await db.messages.findById(messageId);
  if (!msg) {
    console.error(`❌ Message "${messageId}" not found`);
    process.exitCode = 1;
    return;
  }

  const normalized = normalizePinAddress(streetName);

  // Geocode the query
  const { getStreetGeometryFromOverpass } =
    await import("@/geocoding/overpass/service");
  const geometry = await getStreetGeometryFromOverpass(query);

  if (!geometry) {
    console.error(
      `❌ Geocoding failed for query "${query}". Overpass API returned no results.`,
    );
    process.exitCode = 1;
    return;
  }

  // Build the geocoding street entry
  const entry: GeocodingStreetEntry = {
    key: normalized,
    originalName: streetName,
    geometry: JSON.stringify(geometry),
  };

  // Read-modify-write on process[]
  const rawProcess = Array.isArray(msg.process) ? msg.process : [];
  const steps = rawProcess.filter(
    (s): s is Record<string, unknown> =>
      isRecord(s) && typeof s["step"] === "string",
  );

  const { updateMessage } = await import("@/messageIngest/db");

  // Prefer last completed geocoding step
  const geocodingSteps = steps.filter((s) => s["step"] === "geocoding");
  if (geocodingSteps.length > 0) {
    const lastGeocodingStep = geocodingSteps[geocodingSteps.length - 1];

    // Replace or add the street entry in this step
    const streets: GeocodingStreetEntry[] = Array.isArray(
      lastGeocodingStep["streets"],
    )
      ? lastGeocodingStep["streets"].filter(isGeocodingStreetEntry)
      : [];

    // Replace entry with same key, or append if not found
    const existingIndex = streets.findIndex((s) => s.key === normalized);
    if (existingIndex >= 0) {
      streets[existingIndex] = entry;
    } else {
      streets.push(entry);
    }

    // Rebuild the process array with the updated geocoding step
    const updatedProcess = rawProcess.map((s) => {
      if (isRecord(s) && s["step"] === "geocoding" && s === lastGeocodingStep) {
        return {
          ...lastGeocodingStep,
          streets,
        };
      }
      return s;
    });

    await updateMessage(messageId, { $set: { process: updatedProcess } });
    console.log(
      `✅ Updated street "${normalized}" in existing geocoding step for message "${messageId}"`,
    );
    console.log(
      `   Geometry: ${geometry.geometry.coordinates.length} line segment(s)`,
    );
    return;
  }

  // No geocoding step exists — append a new geocodingBatch
  const newRunId = randomUUID();
  const newBatch = {
    step: "geocodingBatch",
    runId: newRunId,
    timestamp: new Date().toISOString(),
    progress: { toDo: 1, done: 1 },
    pins: [],
    streets: [entry],
  };

  await updateMessage(messageId, { $addToSet: { process: newBatch } });
  console.log(
    `✅ Added new geocoding batch for street "${normalized}" to message "${messageId}"`,
  );
  console.log(
    `   Geometry: ${geometry.geometry.coordinates.length} line segment(s)`,
  );
}

async function main(opts: {
  street: string;
  query: string;
  message: string;
}): Promise<void> {
  const { getDb, closeDb } = await import("@/lib/db");
  const db = await getDb();

  try {
    await geocodeStreet(db, opts.message, opts.street, opts.query);
  } finally {
    await closeDb();
  }
}

const program = new Command();

program
  .name("geocode-cache-geocode")
  .description(
    "Manually geocode a street location and write it to the message's process array",
  )
  .requiredOption(
    "--street <text>",
    "Original street name as it appears in the message",
  )
  .requiredOption(
    "--query <text>",
    "Alternate geocoding query to use for Overpass (e.g., formal street name with district)",
  )
  .requiredOption("--message <id>", "Message ID to update")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm geocode-cache:geocode --street "ул. Ген. Гурко" --query "Gen. Yosif V. Gurko, Centre, Sofia" --message abc123
  $ pnpm geocode-cache:geocode --street "бул. Витоша" --query "Boulevard Vitosha, Sofia, Bulgaria" --message abc123
`,
  )
  .action(async (opts: { street: string; query: string; message: string }) => {
    await main(opts);
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
