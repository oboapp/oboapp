#!/usr/bin/env tsx
/**
 * Generate a geocode-cache frequency report.
 *
 * Scans all finalized messages for addresses (pins) and street sections,
 * counts how often each unique address appears, and records whether it is
 * already pre-cached. The resulting JSON is saved to GCS for the admin page.
 *
 * Usage:
 *   pnpm tsx ingest/scripts/geocode-frequency-report.ts
 *   pnpm tsx ingest/scripts/geocode-frequency-report.ts --dry-run  # print top uncached items, skip GCS upload
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { normalizePinAddress } from "@oboapp/shared";
import type { Pin, StreetSection } from "@/lib/types";
import type { FrequencyEntry } from "@/lib/geocode-cache/report-store";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function buildReport(dryRun: boolean): Promise<void> {
  const { getDb, closeDb } = await import("@/lib/db");
  const { saveFrequencyReport } =
    await import("@/lib/geocode-cache/report-store");

  const db = await getDb();

  try {
    // ── Fetch all finalized messages ────────────────────────────────────────
    console.log("Fetching messages...");
    const messages = await db.messages.findMany({
      where: [{ field: "finalizedAt", op: "!=", value: null }],
      select: ["_id", "pins", "streets"],
    });

    console.log(`Analyzing ${messages.length} messages...`);

    // ── Load current cache keys ─────────────────────────────────────────────
    const cachedPinEntries = await db.geocodeCachePins.findAll();
    const cachedStreetEntries = await db.geocodeCacheStreets.findAll();
    const cachedPinKeys = new Set(cachedPinEntries.map((e) => e.key as string));
    const cachedStreetKeys = new Set(
      cachedStreetEntries.map((e) => e.key as string),
    );

    // ── Aggregate pin frequencies ───────────────────────────────────────────
    const pinCounts = new Map<
      string,
      { originalText: string; count: number; messageIds: string[] }
    >();
    for (const msg of messages) {
      const msgId = msg._id as string;
      const pins = (msg.pins ?? []) as Pin[];
      const seen = new Set<string>();
      for (const pin of pins) {
        const key = normalizePinAddress(pin.address);
        if (!seen.has(key)) {
          seen.add(key);
          const existing = pinCounts.get(key);
          if (existing) {
            existing.count++;
            existing.messageIds.push(msgId);
          } else {
            pinCounts.set(key, {
              originalText: pin.address,
              count: 1,
              messageIds: [msgId],
            });
          }
        }
      }
    }

    // ── Aggregate street frequencies ────────────────────────────────────────
    const streetCounts = new Map<
      string,
      { originalText: string; count: number; messageIds: string[] }
    >();
    for (const msg of messages) {
      const msgId = msg._id as string;
      const streets = (msg.streets ?? []) as StreetSection[];
      const seen = new Set<string>();
      for (const s of streets) {
        const key = normalizePinAddress(s.street);
        if (!seen.has(key)) {
          seen.add(key);
          const existing = streetCounts.get(key);
          if (existing) {
            existing.count++;
            existing.messageIds.push(msgId);
          } else {
            streetCounts.set(key, {
              originalText: s.street,
              count: 1,
              messageIds: [msgId],
            });
          }
        }
      }
    }

    // ── Build sorted entries ────────────────────────────────────────────────
    const pins: FrequencyEntry[] = Array.from(pinCounts.entries())
      .map(([key, { originalText, count, messageIds }]) => ({
        key,
        originalText,
        count,
        cached: cachedPinKeys.has(key),
        messageIds,
      }))
      .sort((a, b) => b.count - a.count);

    const streets: FrequencyEntry[] = Array.from(streetCounts.entries())
      .map(([key, { originalText, count, messageIds }]) => ({
        key,
        originalText,
        count,
        cached: cachedStreetKeys.has(key),
        messageIds,
      }))
      .sort((a, b) => b.count - a.count);

    const report = {
      generatedAt: new Date().toISOString(),
      messagesAnalyzed: messages.length,
      pins,
      streets,
    };

    // ── Output ─────────────────────────────────────────────────────────────
    const topUncachedPins = pins.filter((p) => !p.cached).slice(0, 10);
    const topUncachedStreets = streets.filter((s) => !s.cached).slice(0, 10);

    console.log(
      `\n📍 Top uncached pins (${pins.filter((p) => !p.cached).length} total):`,
    );
    for (const p of topUncachedPins) {
      console.log(`   ${p.count}x  "${p.originalText}"  (key: ${p.key})`);
    }

    console.log(
      `\n🛣️  Top uncached streets (${streets.filter((s) => !s.cached).length} total):`,
    );
    for (const s of topUncachedStreets) {
      console.log(`   ${s.count}x  "${s.originalText}"  (key: ${s.key})`);
    }

    if (dryRun) {
      console.log("\n[dry-run] Report not saved to GCS.");
      return;
    }

    await saveFrequencyReport(report);
    console.log(
      `\n✅ Report saved (${pins.length} pins, ${streets.length} streets)`,
    );
  } finally {
    await closeDb();
  }
}

const program = new Command();
program
  .description("Generate geocode-cache frequency report and save to GCS")
  .option("--dry-run", "Print top uncached items to stdout without saving to GCS")
  .action(async (opts: { dryRun?: boolean }) => {
    await buildReport(opts.dryRun ?? false);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
