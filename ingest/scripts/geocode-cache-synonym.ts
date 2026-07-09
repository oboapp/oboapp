#!/usr/bin/env tsx
/**
 * Register a street name synonym in the geocode cache.
 *
 * A synonym tells the pipeline: "when you encounter <synonym>, use the
 * geometry already cached for <canonical> instead of making a new Overpass
 * API call." The canonical street must already exist in the geocodeCacheStreets
 * collection before a synonym can be added.
 *
 * Usage:
 *   pnpm geocode-cache:synonym \
 *     --synonym "ул. Гурко" \
 *     --canonical "ул. Ген. Гурко"
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { normalizePinAddress } from "@oboapp/shared";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function addSynonym(
  db: Awaited<ReturnType<typeof import("@/lib/db").getDb>>,
  synonymText: string,
  canonicalText: string,
): Promise<void> {
  const synonymKey = normalizePinAddress(synonymText);
  const canonicalKey = normalizePinAddress(canonicalText);

  if (synonymKey === canonicalKey) {
    console.error(
      `❌ Synonym and canonical normalize to the same key "${synonymKey}". Nothing to do.`,
    );
    process.exitCode = 1;
    return;
  }

  // Canonical must exist in the streets cache.
  const canonical = await db.geocodeCacheStreets.findByKey(canonicalKey);
  if (!canonical) {
    console.error(
      `❌ Canonical street "${canonicalText}" (key: "${canonicalKey}") not found in geocodeCacheStreets.`,
    );
    console.error(
      `   Cache the canonical street first with: pnpm geocode-cache:add --address "${canonicalText}" --type street --message <id>`,
    );
    process.exitCode = 1;
    return;
  }

  // Synonym must not already be cached as a street.
  const existingStreet = await db.geocodeCacheStreets.findByKey(synonymKey);
  if (existingStreet) {
    console.error(
      `❌ "${synonymText}" (key: "${synonymKey}") already exists as a street in geocodeCacheStreets.`,
    );
    console.error(
      `   Remove it first if you want to replace it with a synonym.`,
    );
    process.exitCode = 1;
    return;
  }

  // Synonym must not already be registered.
  const existingSynonym =
    await db.geocodeCacheStreetSynonyms.findBySynonymKey(synonymKey);
  if (existingSynonym) {
    console.error(
      `❌ Synonym key "${synonymKey}" already exists (id: ${existingSynonym._id as string}). Remove it first to re-register.`,
    );
    process.exitCode = 1;
    return;
  }

  await db.geocodeCacheStreetSynonyms.insertOne({
    synonymKey,
    synonymText,
    canonicalKey,
    canonicalText,
    createdAt: new Date(),
  });

  const count = await db.geocodeCacheStreetSynonyms.count();
  console.log(`✅ Registered synonym "${synonymText}" → "${canonicalText}"`);
  console.log(`   synonym key:   ${synonymKey}`);
  console.log(`   canonical key: ${canonicalKey}`);
  console.log(`   Total synonyms in cache: ${count}`);
}

async function main(opts: {
  synonym: string;
  canonical: string;
}): Promise<void> {
  const { getDb, closeDb } = await import("@/lib/db");
  const db = await getDb();

  try {
    await addSynonym(db, opts.synonym, opts.canonical);
  } finally {
    await closeDb();
  }
}

const program = new Command();

program
  .name("geocode-cache-synonym")
  .description(
    "Register a street name synonym so the pipeline uses an already-cached geometry",
  )
  .requiredOption(
    "--synonym <text>",
    "Alternative street name spelling to register as a synonym",
  )
  .requiredOption(
    "--canonical <text>",
    "Canonical street name whose geometry is already in the geocode cache",
  )
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm geocode-cache:synonym --synonym "ул. Гурко" --canonical "ул. Ген. Гурко"
  $ pnpm geocode-cache:synonym --synonym "бул. Евлоги и Христо Георгиеви" --canonical "бул. Евлоги Георгиев"
`,
  )
  .action(async (opts: { synonym: string; canonical: string }) => {
    await main(opts);
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
