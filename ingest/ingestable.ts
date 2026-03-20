#!/usr/bin/env node
/**
 * Dry-run ingestion pipeline for testing crawler output.
 *
 * Reads text from a file (or stdin) and runs the 3-step AI pipeline:
 *   1. Filter & Split
 *   2. Categorize
 *   3. Extract Locations
 *
 * No data is stored anywhere — this is purely for developer testing.
 *
 * Usage:
 *   pnpm ingestable ./tmp/some-page.txt
 *   pnpm ingestable ./tmp/some-page.txt --json ./tmp/output.json
 *   cat some-text.txt | pnpm ingestable --stdin
 */
import { Command } from "commander";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { verifyEnvSet } from "@/lib/verify-env";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const program = new Command();

program
  .name("ingestable")
  .description(
    "Test the AI ingestion pipeline (filter, categorize, extract) in dry-run mode",
  )
  .argument("[file]", "Path to a text file to process")
  .option("--stdin", "Read input from stdin instead of a file")
  .option("--json <path>", "Write structured output to a JSON file")
  .option("--step <step>", "Run only a specific step: filter, categorize, extract", "all")
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm ingestable ./tmp/page.txt
  $ pnpm ingestable ./tmp/page.txt --json ./tmp/output.json
  $ pnpm ingestable ./tmp/page.txt --step filter
  $ echo "Прекъсване на водата" | pnpm ingestable --stdin
`,
  )
  .action(async (file: string | undefined, options) => {
    verifyEnvSet(["GOOGLE_AI_API_KEY", "GOOGLE_AI_MODEL"]);

    const text = readInput(file, options.stdin);
    if (!text.trim()) {
      console.error("Error: empty input. Provide a file path or use --stdin.");
      process.exit(1);
    }

    console.log(`\n📄 Input (${text.length} chars):\n${text.substring(0, 200)}${text.length > 200 ? "..." : ""}\n`);

    const { filterAndSplit, categorize, extractLocations } = await import(
      "./lib/ai-service"
    );

    const output: Record<string, unknown> = { input: text };
    const step = String(options.step);

    // Step 1: Filter & Split
    if (step === "all" || step === "filter") {
      console.log("━".repeat(60));
      console.log("Step 1: Filter & Split");
      console.log("━".repeat(60));
      const filterResult = await filterAndSplit(text);
      output.filterAndSplit = filterResult;

      if (!filterResult || filterResult.length === 0) {
        console.log("  ❌ No results from filter & split\n");
      } else {
        for (let i = 0; i < filterResult.length; i++) {
          const msg = filterResult[i];
          console.log(`  Message ${i + 1}/${filterResult.length}:`);
          console.log(`    isRelevant: ${msg.isRelevant}`);
          console.log(`    responsibleEntity: ${msg.responsibleEntity ?? "(none)"}`);
          console.log(`    plainText: ${msg.plainText?.substring(0, 100) ?? "(empty)"}${(msg.plainText?.length ?? 0) > 100 ? "..." : ""}`);
          console.log();
        }
      }

      if (step === "filter") {
        return writeOutput(output, options.json);
      }

      // For subsequent steps, process each relevant message
      if (filterResult && filterResult.length > 0) {
        const relevantMessages = filterResult.filter((m) => m.isRelevant);

        if (relevantMessages.length === 0) {
          console.log("  No relevant messages — stopping pipeline.\n");
          return writeOutput(output, options.json);
        }

        const categorizeResults: unknown[] = [];
        const extractLocationsResults: unknown[] = [];
        output.categorize = categorizeResults;
        output.extractLocations = extractLocationsResults;

        for (let i = 0; i < relevantMessages.length; i++) {
          const msg = relevantMessages[i];
          const messageText = msg.plainText || text;

          // Step 2: Categorize
          if (step === "all" || step === "categorize") {
            console.log("━".repeat(60));
            console.log(`Step 2: Categorize (message ${i + 1}/${relevantMessages.length})`);
            console.log("━".repeat(60));
            const catResult = await categorize(messageText);
            categorizeResults.push(catResult);
            if (catResult) {
              console.log(`  categories: [${catResult.categories.join(", ")}]\n`);
            } else {
              console.log("  ❌ Categorization failed\n");
            }
          }

          // Step 3: Extract Locations
          if (step === "all" || step === "extract") {
            console.log("━".repeat(60));
            console.log(`Step 3: Extract Locations (message ${i + 1}/${relevantMessages.length})`);
            console.log("━".repeat(60));
            const locResult = await extractLocations(messageText);
            extractLocationsResults.push(locResult);
            if (locResult) {
              const pinCount = locResult.pins?.length ?? 0;
              const streetCount = locResult.streets?.length ?? 0;
              const cadastralCount = locResult.cadastralProperties?.length ?? 0;
              const busStopCount = locResult.busStops?.length ?? 0;
              console.log(`  pins: ${pinCount}, streets: ${streetCount}, cadastral: ${cadastralCount}, busStops: ${busStopCount}`);
              console.log(`  cityWide: ${locResult.cityWide ?? false}`);
              console.log(`  withSpecificAddress: ${locResult.withSpecificAddress ?? false}`);
              if (pinCount > 0) {
                for (const pin of locResult.pins!) {
                  console.log(`    📍 ${pin.address}${pin.coordinates ? ` (${pin.coordinates.lat}, ${pin.coordinates.lng})` : ""}`);
                }
              }
              if (streetCount > 0) {
                for (const s of locResult.streets!) {
                  console.log(`    🛣️  ${s.street} (${s.from} → ${s.to})`);
                }
              }
              console.log();
            } else {
              console.log("  ❌ Location extraction failed\n");
            }
          }
        }
      }
    }

    // Single-step modes (categorize or extract) that didn't go through filter
    if (step === "categorize") {
      console.log("━".repeat(60));
      console.log("Step 2: Categorize");
      console.log("━".repeat(60));
      const catResult = await categorize(text);
      output.categorize = catResult;
      if (catResult) {
        console.log(`  categories: [${catResult.categories.join(", ")}]\n`);
      } else {
        console.log("  ❌ Categorization failed\n");
      }
    }

    if (step === "extract") {
      console.log("━".repeat(60));
      console.log("Step 3: Extract Locations");
      console.log("━".repeat(60));
      const locResult = await extractLocations(text);
      output.extractLocations = locResult;
      if (locResult) {
        console.log(`  Result: ${JSON.stringify(locResult, null, 2)}\n`);
      } else {
        console.log("  ❌ Location extraction failed\n");
      }
    }

    writeOutput(output, options.json);
  });

function readInput(file: string | undefined, useStdin: boolean): string {
  if (useStdin) {
    return readFileSync(0, "utf-8");
  }
  if (!file) {
    console.error("Error: provide a file path or use --stdin.");
    process.exit(1);
  }
  const filePath = resolve(process.cwd(), file);
  return readFileSync(filePath, "utf-8");
}

function writeOutput(output: Record<string, unknown>, jsonPath?: string): void {
  if (jsonPath) {
    const outPath = resolve(process.cwd(), jsonPath);
    writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
    console.log(`\n💾 Output written to: ${outPath}`);
  }
}

program.parse();
