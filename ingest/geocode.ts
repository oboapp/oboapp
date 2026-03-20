#!/usr/bin/env node
/**
 * Dry-run geocoding for testing extracted location data.
 *
 * Reads the JSON output from `pnpm ingestable --json` and geocodes
 * the extracted locations without storing anything.
 *
 * Usage:
 *   pnpm geocode ./tmp/output.json
 *   pnpm geocode ./tmp/output.json --json ./tmp/geocoded.json
 */
import { Command } from "commander";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import type { ExtractedLocations } from "./lib/types";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const program = new Command();

program
  .name("geocode")
  .description(
    "Geocode extracted locations from ingestable output (dry-run, no storage)",
  )
  .argument("<file>", "Path to a JSON file (output from pnpm ingestable --json)")
  .option("--json <path>", "Write geocoded output to a JSON file")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm geocode ./tmp/output.json
  $ pnpm geocode ./tmp/output.json --json ./tmp/geocoded.json
`,
  )
  .action(async (file: string, options) => {
    // GOOGLE_MAPS_API_KEY is needed for Google geocoding (pins).
    // Overpass (streets) and Cadastre don't need API keys.
    // We warn instead of failing so partial geocoding still works.
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      console.warn(
        "⚠️  GOOGLE_MAPS_API_KEY not set — Google geocoding (pins) will fail. Street/cadastral geocoding will still work.\n",
      );
    }

    const filePath = resolve(process.cwd(), file);
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));

    // Accept either the full ingestable output or a bare extractLocations array
    const extractedArray: unknown[] = Array.isArray(raw.extractLocations)
      ? raw.extractLocations
      : Array.isArray(raw)
        ? raw
        : [raw];

    if (extractedArray.length === 0 || extractedArray.every((e) => !e)) {
      console.error("Error: no extracted location data found in input.");
      process.exit(1);
    }

    const {
      geocodeAddressesFromExtractedData,
      convertMessageGeocodingToGeoJson,
    } = await import("./messageIngest/index");

    const results: unknown[] = [];

    for (let i = 0; i < extractedArray.length; i++) {
      const extracted = extractedArray[i];
      if (!extracted) {
        console.log(`\nMessage ${i + 1}: skipped (no extracted data)\n`);
        results.push(null);
        continue;
      }

      console.log("━".repeat(60));
      console.log(`Geocoding message ${i + 1}/${extractedArray.length}`);
      console.log("━".repeat(60));

      try {
        const { ExtractedLocationsSchema } = await import("./lib/extract-locations.schema");
        const parseResult = ExtractedLocationsSchema.safeParse(extracted);
        const typedExtracted: ExtractedLocations | null = parseResult.success
          ? parseResult.data
          : null;
        if (!typedExtracted) {
          console.log("  ⚠️  Could not parse extracted location data — skipping");
          results.push(null);
          continue;
        }
        const geocodingResult = await geocodeAddressesFromExtractedData(
          typedExtracted,
        );

        console.log(`  Addresses resolved: ${geocodingResult.addresses.length}`);
        console.log(`  Pre-geocoded: ${geocodingResult.preGeocodedMap.size}`);
        if (geocodingResult.cadastralGeometries) {
          console.log(`  Cadastral geometries: ${geocodingResult.cadastralGeometries.size}`);
        }

        for (const addr of geocodingResult.addresses) {
          console.log(`    📍 ${addr.formattedAddress} → (${addr.coordinates.lat}, ${addr.coordinates.lng})`);
        }

        // Convert to GeoJSON
        const geoJson = await convertMessageGeocodingToGeoJson(
          typedExtracted,
          geocodingResult.preGeocodedMap,
          geocodingResult.cadastralGeometries,
        );

        if (geoJson) {
          console.log(`  GeoJSON features: ${geoJson.features.length}`);
        } else {
          console.log("  ⚠️  No GeoJSON produced");
        }

        results.push({
          addresses: geocodingResult.addresses,
          geoJson,
        });
        console.log();
      } catch (error) {
        console.error(
          `  ❌ Geocoding failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        results.push({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (options.json) {
      const outPath = resolve(process.cwd(), options.json);
      writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
      console.log(`💾 Output written to: ${outPath}`);
    }
  });

program.parse();
