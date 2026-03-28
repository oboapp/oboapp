/**
 * Readings store — abstracts sensor reading persistence.
 *
 * Production: GCS bucket (one JSON file per locality, overwritten each fetch).
 * Development: Local filesystem (${basePath}/${locality}/readings.json).
 *
 * The store holds a rolling window of readings (DATA_RETENTION_HOURS).
 * Each fetch appends new readings to the existing window and prunes expired ones.
 */

import { DATA_RETENTION_HOURS } from "./constants";
import type { ParsedReading } from "./parse-sensor-response";

/** Serialized reading format (dates as ISO strings for JSON round-trip). */
interface StoredReading {
  sensorId: number;
  sensorType: string;
  timestamp: string;
  lat: number;
  lng: number;
  p1: number;
  p2: number;
}

/** Backend interface for reading/writing the raw JSON blob. */
export interface ReadingsBackend {
  read(locality: string): Promise<StoredReading[] | null>;
  write(locality: string, readings: StoredReading[]): Promise<void>;
}

// ── GCS backend ─────────────────────────────────────────────────────────────

export class GcsReadingsBackend implements ReadingsBackend {
  private bucket: string;
  private storage: import("@google-cloud/storage").Storage | null = null;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  private async getStorage() {
    if (!this.storage) {
      const { Storage } = await import("@google-cloud/storage");
      this.storage = new Storage();
    }
    return this.storage;
  }

  private filePath(locality: string): string {
    return `air-quality/${locality}/readings.json`;
  }

  async read(locality: string): Promise<StoredReading[] | null> {
    const storage = await this.getStorage();
    const file = storage.bucket(this.bucket).file(this.filePath(locality));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return JSON.parse(content.toString("utf-8"));
  }

  async write(locality: string, readings: StoredReading[]): Promise<void> {
    const storage = await this.getStorage();
    const file = storage.bucket(this.bucket).file(this.filePath(locality));
    await file.save(JSON.stringify(readings), { contentType: "application/json" });
  }
}

// ── Local filesystem backend ────────────────────────────────────────────────

export class LocalReadingsBackend implements ReadingsBackend {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private filePath(locality: string): string {
    return `${this.basePath}/${locality}/readings.json`;
  }

  async read(locality: string): Promise<StoredReading[] | null> {
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(this.filePath(locality), "utf-8");
      return JSON.parse(content);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        // File does not exist yet: treat as no stored readings.
        return null;
      }
      // Surface unexpected IO/parse errors so corrupted data is not silently ignored.
      throw err;
    }
  }

  async write(locality: string, readings: StoredReading[]): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const path = this.filePath(locality);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(readings), "utf-8");
  }
}

// ── High-level store ────────────────────────────────────────────────────────

export class ReadingsStore {
  constructor(private backend: ReadingsBackend) {}

  /**
   * Append new readings to the store, dedup by sensorId+timestamp,
   * and prune readings older than the retention window.
   * Returns counts of stored (new) and cleaned (expired) readings.
   */
  async appendAndPrune(
    locality: string,
    newReadings: ParsedReading[],
  ): Promise<{ stored: number; cleaned: number }> {
    const existing = (await this.backend.read(locality)) ?? [];
    const cutoff = new Date(
      Date.now() - DATA_RETENTION_HOURS * 60 * 60 * 1000,
    );

    // Build set of existing keys for O(1) dedup lookup
    const existingKeys = new Set(
      existing.map((r) => `${r.sensorId}_${r.timestamp}`),
    );

    const beforeCount = existing.length;
    let stored = 0;

    // Convert new readings to stored format and dedup
    for (const r of newReadings) {
      const key = `${r.sensorId}_${r.timestamp.toISOString()}`;
      if (!existingKeys.has(key)) {
        existing.push({
          sensorId: r.sensorId,
          sensorType: r.sensorType,
          timestamp: r.timestamp.toISOString(),
          lat: r.lat,
          lng: r.lng,
          p1: r.p1,
          p2: r.p2,
        });
        existingKeys.add(key);
        stored++;
      }
    }

    // Prune expired
    const retained = existing.filter(
      (r) => new Date(r.timestamp) >= cutoff,
    );
    const cleaned = beforeCount + stored - retained.length;

    await this.backend.write(locality, retained);

    return { stored, cleaned };
  }

  /**
   * Load readings within the given time range for a locality.
   * Returns ParsedReading objects (dates reconstituted).
   */
  async getReadingsInRange(
    locality: string,
    start: Date,
    end: Date,
  ): Promise<ParsedReading[]> {
    const stored = (await this.backend.read(locality)) ?? [];

    return stored
      .filter((r) => {
        const ts = new Date(r.timestamp);
        return ts >= start && ts <= end;
      })
      .map((r) => ({
        sensorId: r.sensorId,
        sensorType: r.sensorType,
        timestamp: new Date(r.timestamp),
        lat: r.lat,
        lng: r.lng,
        p1: r.p1,
        p2: r.p2,
      }));
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a ReadingsStore from environment variables.
 *
 * - GCS_READINGS_BUCKET → GCS backend (production)
 * - Otherwise → local filesystem at ./tmp/air-quality (development)
 */
export function createReadingsStore(): ReadingsStore {
  const bucket = process.env.GCS_READINGS_BUCKET;
  if (bucket) {
    return new ReadingsStore(new GcsReadingsBackend(bucket));
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GCS_READINGS_BUCKET must be set in production; refusing to fall back to non-persistent local storage.",
    );
  }

  const basePath = process.env.LOCAL_READINGS_PATH ?? "./tmp/air-quality";
  return new ReadingsStore(new LocalReadingsBackend(basePath));
}
