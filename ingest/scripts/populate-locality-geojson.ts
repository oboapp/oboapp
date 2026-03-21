#!/usr/bin/env tsx
import { Command } from "commander";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { transliterate } from "@/lib/transliterate";

const API_URL = "https://api.sofiaplan.bg/datasets/350";
const LOCALITIES_DIR = resolve(process.cwd(), "localities");

interface DistrictProperties {
  id: number;
  obns_num: string;
  obns_cyr: string;
  obns_lat: string;
}

interface DistrictFeature {
  type: "Feature";
  properties: DistrictProperties;
  geometry: {
    type: string;
    coordinates: number[][][][];
  };
}

interface DistrictFeatureCollection {
  type: "FeatureCollection";
  features: DistrictFeature[];
}

const program = new Command();

program
  .name("populate-locality-geojson")
  .description(
    "Fetch Sofia district boundaries and save as individual GeoJSON files",
  )
  .addHelpText(
    "after",
    `
This command:
  - Fetches district boundaries from the Sofia Urban Data API
  - Saves each district as a separate GeoJSON FeatureCollection
  - Files are written to ingest/localities/ as bg.sofia.<district>.geojson
  - Rerunnable: overwrites existing files

Examples:
  $ npx tsx scripts/populate-locality-geojson.ts
`,
  )
  .action(async () => {
    console.log(`📥 Fetching district boundaries from ${API_URL}...\n`);

    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch districts: ${response.status} ${response.statusText}`,
      );
    }

    const data: DistrictFeatureCollection = await response.json();

    if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error("Invalid GeoJSON: expected a FeatureCollection");
    }

    console.log(`Found ${data.features.length} districts\n`);

    const written: string[] = [];

    for (const feature of data.features) {
      const { obns_cyr } = feature.properties;
      if (!obns_cyr) {
        console.warn(
          `⚠️  Skipping feature with missing obns_cyr:`,
          feature.properties,
        );
        continue;
      }

      const slug = transliterate(obns_cyr).toLowerCase().replace(/ /g, "-");
      const filename = `bg.sofia.${slug}.geojson`;
      const filePath = resolve(LOCALITIES_DIR, filename);

      const featureCollection = {
        type: "FeatureCollection",
        features: [feature],
      };

      writeFileSync(filePath, JSON.stringify(featureCollection, null, 2) + "\n");
      written.push(`  ${filename} (${obns_cyr})`);
    }

    console.log(
      `✅ Wrote ${written.length} district GeoJSON files to localities/:\n`,
    );
    for (const entry of written) {
      console.log(entry);
    }
  });

program.parse();
