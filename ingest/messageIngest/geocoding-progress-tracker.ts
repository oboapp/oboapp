import { randomUUID } from "node:crypto";
import type { Address } from "@/lib/types";
import { normalizePinAddress } from "@oboapp/shared";
import { updateMessage } from "./db/update-message";
import { getDb } from "@/lib/db";
import { isRecord } from "@/lib/record-fields";

const BATCH_SIZE = 10;

export interface GeocodingPinEntry {
  key: string;
  originalText: string;
  formattedAddress: string;
  coordinates: { lat: number; lng: number };
  geoJson?: { type: "Point"; coordinates: [number, number] };
}

export interface GeocodingStreetEntry {
  key: string;
  originalName: string;
  /** JSON-stringified Feature<MultiLineString> */
  geometry: string;
}

export interface GeocodingProgressTracker {
  /**
   * Record resolved pins. `attempted` should equal the total number of pin inputs
   * (including pre-resolved ones), so the progress counter stays in sync with `toDo`.
   */
  recordPins(geocoded: Address[], attempted: number): Promise<void>;
  /**
   * Record a single resolved street geometry. Increments `done` by 1.
   * Call for every street regardless of whether a geometry was found — use
   * `recordAttempted(1)` when no geometry was resolved.
   */
  recordStreet(entry: GeocodingStreetEntry): Promise<void>;
  /**
   * Increment `done` without storing a result. Use for:
   * - Streets with no resolved geometry (pass 1)
   * - Cadastral properties, bus stops, educational facilities (pass input count)
   */
  recordAttempted(count: number): void;
  /**
   * Flush any remaining pending items to `geocodingBatch` without consolidating.
   * Safe to call on both success and failure paths.
   */
  flushPending(): Promise<void>;
  /**
   * Flush any remaining pending items, then replace all intermediate `geocodingBatch`
   * entries for this run with a single final `geocoding` step in `process[]`.
   * If no pins or streets were resolved, batch entries are flushed but no final
   * `geocoding` step is written (the DB read-modify-write is skipped).
   * Should only be called on the success path.
   */
  finalize(): Promise<void>;
}

export function createGeocodingProgressTracker(
  messageId: string,
  toDo: number,
): GeocodingProgressTracker {
  const runId = randomUUID();
  const allPins: GeocodingPinEntry[] = [];
  const allStreets: GeocodingStreetEntry[] = [];
  const pendingPins: GeocodingPinEntry[] = [];
  const pendingStreets: GeocodingStreetEntry[] = [];
  let done = 0;

  function addressToPinEntry(addr: Address): GeocodingPinEntry {
    const entry: GeocodingPinEntry = {
      key: normalizePinAddress(addr.originalText),
      originalText: addr.originalText,
      formattedAddress: addr.formattedAddress,
      coordinates: addr.coordinates,
    };
    if (addr.geoJson) {
      entry.geoJson = addr.geoJson;
    }
    return entry;
  }

  async function flush(): Promise<void> {
    if (pendingPins.length === 0 && pendingStreets.length === 0) return;

    const pinsToFlush = [...pendingPins];
    const streetsToFlush = [...pendingStreets];

    const batch = {
      step: "geocodingBatch",
      runId,
      timestamp: new Date().toISOString(),
      progress: { toDo, done },
      pins: pinsToFlush,
      streets: streetsToFlush,
    };

    await updateMessage(messageId, {
      $addToSet: { process: batch },
    });

    // Only clear after the write succeeds so items can be retried on error
    pendingPins.splice(0, pinsToFlush.length);
    pendingStreets.splice(0, streetsToFlush.length);
  }

  async function maybeFlush(): Promise<void> {
    if (pendingPins.length + pendingStreets.length >= BATCH_SIZE) {
      await flush();
    }
  }

  return {
    async recordPins(geocoded: Address[], attempted: number): Promise<void> {
      done += attempted;
      for (const addr of geocoded) {
        const entry = addressToPinEntry(addr);
        allPins.push(entry);
        pendingPins.push(entry);
        await maybeFlush();
      }
    },

    async recordStreet(entry: GeocodingStreetEntry): Promise<void> {
      allStreets.push(entry);
      pendingStreets.push(entry);
      done += 1;
      await maybeFlush();
    },

    recordAttempted(count: number): void {
      done += count;
    },

    async flushPending(): Promise<void> {
      await flush();
    },

    async finalize(): Promise<void> {
      await flush();

      if (allPins.length === 0 && allStreets.length === 0) return;

      const db = await getDb();
      const msg = await db.messages.findById(messageId);
      if (!msg) return;

      const rawProcess = Array.isArray(msg.process) ? msg.process : [];
      const withoutBatches = rawProcess.filter(
        (s) =>
          !(
            isRecord(s) &&
            s["step"] === "geocodingBatch" &&
            s["runId"] === runId
          ),
      );

      withoutBatches.push({
        step: "geocoding",
        runId,
        timestamp: new Date().toISOString(),
        progress: { toDo, done },
        pins: allPins,
        streets: allStreets,
      });

      await updateMessage(messageId, { $set: { process: withoutBatches } });
    },
  };
}
