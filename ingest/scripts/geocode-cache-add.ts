#!/usr/bin/env tsx
/**
 * Manually pre-cache a single geocoded location for a given message.
 *
 * Reads an existing geocoded address (pin) from a message document, or
 * fetches the full street geometry from Overpass for a street name that
 * appears in a message, and stores the result in the geocode cache
 * collection so future ingestion runs skip the API call entirely.
 *
 * Usage:
 *   # Cache a pin address (reads geometry from message.addresses[])
 *   pnpm tsx ingest/scripts/geocode-cache-add.ts \
 *     --message <messageId> --address "ул. Граф Игнатиев 10" --type pin
 *
 *   # Cache a full street geometry (fetches from Overpass once)
 *   pnpm tsx ingest/scripts/geocode-cache-add.ts \
 *     --message <messageId> --address "бул. Витоша" --type street
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import type { Address, StreetSection } from "@/lib/types";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function cachePin(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  messageId: string,
  address: string,
): Promise<void> {
  const { normalizePinAddress } = await import(
    "@/geocoding/shared/normalize-address"
  );

  const msg = await db.messages.findById(messageId);
  if (!msg) {
    console.error(`❌ Message "${messageId}" not found`);
    process.exitCode = 1;
    return;
  }

  const addresses = (msg.addresses ?? []) as Address[];
  if (addresses.length === 0) {
    console.error(
      `❌ Message "${messageId}" has no geocoded addresses. Has it been ingested?`,
    );
    process.exitCode = 1;
    return;
  }

  const normalized = normalizePinAddress(address);
  const match = addresses.find(
    (a) =>
      normalizePinAddress(a.originalText) === normalized ||
      normalizePinAddress(a.formattedAddress) === normalized,
  );

  if (!match) {
    console.error(
      `❌ Address "${address}" (normalized: "${normalized}") not found in message addresses.`,
    );
    console.error(`   Available addresses:`);
    for (const a of addresses) {
      console.error(`   - "${a.originalText}" / "${a.formattedAddress}"`);
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
  console.log(`   Coordinates: ${match.coordinates.lat}, ${match.coordinates.lng}`);
  console.log(`   Total pins in cache: ${count}`);
}

async function cacheStreet(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  messageId: string,
  streetName: string,
): Promise<void> {
  const { normalizePinAddress } = await import(
    "@/geocoding/shared/normalize-address"
  );
  const { getStreetGeometryFromOverpass } = await import(
    "@/geocoding/overpass/service"
  );

  const msg = await db.messages.findById(messageId);
  if (!msg) {
    console.error(`❌ Message "${messageId}" not found`);
    process.exitCode = 1;
    return;
  }

  const streets = (msg.streets ?? []) as StreetSection[];
  if (streets.length === 0) {
    console.error(
      `❌ Message "${messageId}" has no street sections. Has it been ingested?`,
    );
    process.exitCode = 1;
    return;
  }

  const normalized = normalizePinAddress(streetName);
  const matchedStreet = streets.find(
    (s) => normalizePinAddress(s.street) === normalized,
  );

  if (!matchedStreet) {
    console.error(
      `❌ Street "${streetName}" (normalized: "${normalized}") not found in message streets.`,
    );
    console.error(`   Available streets:`);
    for (const s of streets) {
      console.error(`   - "${s.street}"`);
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

  console.log(
    `Fetching full geometry for "${streetName}" from Overpass (one API call)...`,
  );
  const geometry = await getStreetGeometryFromOverpass(streetName);
  if (!geometry) {
    console.error(
      `❌ Overpass returned no geometry for "${streetName}". Street may not exist in OSM.`,
    );
    process.exitCode = 1;
    return;
  }

  await db.geocodeCacheStreets.insertOne({
    key: normalized,
    originalText: matchedStreet.street,
    geoJson: geometry,
    sourceService: "overpass",
    sourceMessageId: messageId,
    cachedAt: new Date(),
  });

  const count = await db.geocodeCacheStreets.count();
  console.log(
    `✅ Cached street "${normalized}" from message "${messageId}"`,
  );
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
