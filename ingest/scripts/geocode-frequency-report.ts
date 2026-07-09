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
import type {
  GeocodingPinEntry,
  GeocodingStreetEntry,
} from "@/messageIngest/geocoding-progress-tracker";
import { getString, isRecord } from "@/lib/record-fields";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

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

/**
 * Extract geocoded pins and streets from a message's process[] array.
 * Prefers the final `geocoding` step; falls back to `geocodingBatch` entries
 * for interrupted runs where finalize() was never called.
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

function toEpochMillis(iso: string | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value === "string") {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
  }
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? undefined : value.toISOString();
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    const ts = parsed.getTime();
    return Number.isNaN(ts) ? undefined : parsed.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    const withToDate = value as { toDate?: () => Date };
    if (typeof withToDate.toDate === "function") {
      const parsed = withToDate.toDate();
      const ts = parsed.getTime();
      return Number.isNaN(ts) ? undefined : parsed.toISOString();
    }

    const withSeconds = value as { _seconds?: number; seconds?: number };
    const seconds =
      typeof withSeconds.seconds === "number"
        ? withSeconds.seconds
        : withSeconds._seconds;
    if (typeof seconds === "number") {
      const parsed = new Date(seconds * 1000);
      const ts = parsed.getTime();
      return Number.isNaN(ts) ? undefined : parsed.toISOString();
    }
  }
  return undefined;
}

async function buildReport(dryRun: boolean): Promise<void> {
  const { getDb, closeDb } = await import("@/lib/db");
  const { saveFrequencyReport } =
    await import("@/lib/geocode-cache/report-store");

  const db = await getDb();

  try {
    // ── Fetch all messages ──────────────────────────────────────────────────
    // We intentionally omit `process` from the bulk select — large documents
    // with many geocodingBatch entries can exceed Firestore's 1 MB document
    // projection limit and get silently dropped from query results. Instead we
    // identify unfinalized messages from the lean query, then fetch each one
    // individually via findById (direct document reads bypass the limit).
    console.log("Fetching messages...");
    const allMessages = await db.messages.findMany({
      select: ["_id", "createdAt", "finalizedAt", "pins", "streets"],
    });

    console.log(`Analyzing ${allMessages.length} messages...`);

    // For unfinalized messages, re-fetch individually to get their process[].
    // This avoids Firestore dropping large documents in a projection query.
    const unfinalizedIds = allMessages
      .filter((m) => !m.finalizedAt)
      .map((m) => m._id as string);

    const unfinalizedFull = await Promise.all(
      unfinalizedIds.map((id) => db.messages.findById(id)),
    );
    const unfinalizedByIds = new Map(
      unfinalizedFull
        .filter((m): m is Record<string, unknown> => m !== null)
        .map((m) => [m._id as string, m]),
    );

    if (unfinalizedIds.length > 0) {
      console.log(
        `Fetched ${unfinalizedIds.length} unfinalized messages individually.`,
      );
    }

    // ── Load current cache keys ─────────────────────────────────────────────
    const cachedPinEntries = await db.geocodeCachePins.findAll();
    const cachedStreetEntries = await db.geocodeCacheStreets.findAll();
    const cachedPinKeys = new Set(cachedPinEntries.map((e) => e.key as string));
    const cachedStreetKeys = new Set(
      cachedStreetEntries.map((e) => e.key as string),
    );
    const cachedStreetOriginalTexts = new Map(
      cachedStreetEntries.map((entry) => [
        getString(entry["key"]),
        getString(entry["originalText"]),
      ]),
    );
    const dbWithOptionalSynonyms = db as typeof db & {
      geocodeCacheStreetSynonyms?: {
        findAll?: () => Promise<Record<string, unknown>[]>;
      };
    };
    const streetSynonymEntries =
      (await dbWithOptionalSynonyms.geocodeCacheStreetSynonyms?.findAll?.()) ??
      [];
    if (!dbWithOptionalSynonyms.geocodeCacheStreetSynonyms?.findAll) {
      console.warn(
        "Street synonym cache repository is unavailable in the current @oboapp/db build; continuing without synonym mappings.",
      );
    }
    const streetSynonymToCanonical = new Map<
      string,
      { canonicalKey: string; canonicalText: string }
    >();
    for (const entry of streetSynonymEntries) {
      const synonymKey = getString(entry["synonymKey"]);
      const canonicalKey = getString(entry["canonicalKey"]);
      const canonicalText = getString(entry["canonicalText"]);
      if (!synonymKey || !canonicalKey) continue;
      streetSynonymToCanonical.set(synonymKey, {
        canonicalKey,
        canonicalText,
      });
    }

    // ── Aggregate frequencies ───────────────────────────────────────────────
    // Finalized messages: use top-level `pins` / `streets` fields (canonical).
    // Unfinalized messages: use process[] geocoding data (the only available
    // source when finalize() was never called due to an interrupted run).
    const pinCounts = new Map<
      string,
      {
        originalText: string;
        count: number;
        lastUsedAt: string;
        messageIds: string[];
        partial: boolean;
      }
    >();
    const streetCounts = new Map<
      string,
      {
        originalText: string;
        count: number;
        lastUsedAt: string;
        messageIds: string[];
        partial: boolean;
      }
    >();

    // Synthetic centroid key used for precomputed-GeoJSON messages — never a
    // real geocodable address and has no cacheable value in the geocode cache.
    const SYNTHETIC_CENTROID_KEY = normalizePinAddress("Местоположение");

    function addPin(
      key: string,
      originalText: string,
      msgId: string,
      usedAt: string | undefined,
      isPartial: boolean,
    ) {
      if (key === SYNTHETIC_CENTROID_KEY) return; // skip synthetic centroid
      const existing = pinCounts.get(key);
      if (existing) {
        existing.count++;
        existing.messageIds.push(msgId);
        if (toEpochMillis(usedAt) > toEpochMillis(existing.lastUsedAt)) {
          existing.lastUsedAt = usedAt ?? existing.lastUsedAt;
        }
        if (isPartial) existing.partial = true;
      } else {
        pinCounts.set(key, {
          originalText,
          count: 1,
          lastUsedAt: usedAt ?? "",
          messageIds: [msgId],
          partial: isPartial,
        });
      }
    }

    function addStreet(
      key: string,
      originalText: string,
      msgId: string,
      usedAt: string | undefined,
      isPartial: boolean,
    ) {
      const existing = streetCounts.get(key);
      if (existing) {
        existing.count++;
        existing.messageIds.push(msgId);
        if (toEpochMillis(usedAt) > toEpochMillis(existing.lastUsedAt)) {
          existing.lastUsedAt = usedAt ?? existing.lastUsedAt;
        }
        if (isPartial) existing.partial = true;
      } else {
        streetCounts.set(key, {
          originalText,
          count: 1,
          lastUsedAt: usedAt ?? "",
          messageIds: [msgId],
          partial: isPartial,
        });
      }
    }

    for (const msg of allMessages) {
      const msgId = msg._id as string;
      const isPartial = !msg.finalizedAt;
      const createdAt = normalizeIsoDate(msg.createdAt);

      if (!isPartial) {
        // Finalized: top-level pins/streets are canonical
        const seenPins = new Set<string>();
        for (const pin of (msg.pins ?? []) as Pin[]) {
          const key = normalizePinAddress(pin.address);
          if (!seenPins.has(key)) {
            seenPins.add(key);
            addPin(key, pin.address, msgId, createdAt, false);
          }
        }
        const seenStreets = new Set<string>();
        for (const s of (msg.streets ?? []) as StreetSection[]) {
          const key = normalizePinAddress(s.street);
          if (!seenStreets.has(key)) {
            seenStreets.add(key);
            addStreet(key, s.street, msgId, createdAt, false);
          }
        }
      } else {
        // Unfinalized: may already have top-level pins/streets if the
        // finalization logic ran but finalizedAt was never written (e.g. the
        // process was interrupted after geocoding but before the final write).
        // Prefer those canonical fields when present; fall back to process[]
        // geocodingBatch data for truly in-progress messages.
        const topPins = Array.isArray(msg.pins) ? (msg.pins as Pin[]) : [];
        const topStreets = Array.isArray(msg.streets)
          ? (msg.streets as StreetSection[])
          : [];

        if (topPins.length > 0 || topStreets.length > 0) {
          // Canonical fields available — process identically to finalized path
          const seenPins = new Set<string>();
          for (const pin of topPins) {
            const key = normalizePinAddress(pin.address);
            if (!seenPins.has(key)) {
              seenPins.add(key);
              addPin(key, pin.address, msgId, createdAt, true);
            }
          }
          const seenStreets = new Set<string>();
          for (const s of topStreets) {
            const key = normalizePinAddress(s.street);
            if (!seenStreets.has(key)) {
              seenStreets.add(key);
              addStreet(key, s.street, msgId, createdAt, true);
            }
          }
        } else {
          // No top-level fields yet: extract from process[] geocodingBatch data.
          // Fetch the full document individually to avoid Firestore 1 MB
          // projection limit dropping large documents.
          const fullMsg = unfinalizedByIds.get(msgId) ?? msg;
          const { pins: geocodedPins, streets: geocodedStreets } =
            extractGeocodingData(fullMsg as Record<string, unknown>);
          const seenPins = new Set<string>();
          for (const pin of geocodedPins) {
            const key = normalizePinAddress(pin.originalText);
            if (!seenPins.has(key)) {
              seenPins.add(key);
              addPin(key, pin.originalText, msgId, createdAt, true);
            }
          }
          const seenStreets = new Set<string>();
          for (const s of geocodedStreets) {
            const key = normalizePinAddress(s.originalName);
            if (!seenStreets.has(key)) {
              seenStreets.add(key);
              addStreet(key, s.originalName, msgId, createdAt, true);
            }
          }
        }
      }
    }

    // ── Build sorted entries ────────────────────────────────────────────────
    const pins: FrequencyEntry[] = Array.from(pinCounts.entries())
      .map(
        ([key, { originalText, count, lastUsedAt, messageIds, partial }]) => ({
          key,
          originalText,
          count,
          lastUsedAt,
          cached: cachedPinKeys.has(key),
          messageIds,
          ...(partial ? { partial: true as const } : {}),
        }),
      )
      .sort((a, b) => b.count - a.count);

    const streets: FrequencyEntry[] = Array.from(streetCounts.entries())
      .map(
        ([key, { originalText, count, lastUsedAt, messageIds, partial }]) => {
          const synonym = streetSynonymToCanonical.get(key);
          const canonicalKey = synonym?.canonicalKey ?? key;
          // Prefer explicit canonical text from synonym mapping, then canonical
          // cache entry text, and finally the current entry text as a safe fallback.
          const canonicalText =
            synonym?.canonicalText ||
            cachedStreetOriginalTexts.get(canonicalKey) ||
            originalText;
          return {
            key,
            originalText,
            count,
            lastUsedAt,
            cached:
              cachedStreetKeys.has(key) ||
              (streetSynonymToCanonical.has(key) &&
                cachedStreetKeys.has(canonicalKey)),
            messageIds,
            canonicalKey,
            canonicalText,
            ...(partial ? { partial: true as const } : {}),
          };
        },
      )
      .sort((a, b) => b.count - a.count);

    const report = {
      generatedAt: new Date().toISOString(),
      messagesAnalyzed: allMessages.length,
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
  .option(
    "--dry-run",
    "Print top uncached items to stdout without saving to GCS",
  )
  .action(async (opts: { dryRun?: boolean }) => {
    await buildReport(opts.dryRun ?? false);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
