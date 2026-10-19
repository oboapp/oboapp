import { randomUUID } from "node:crypto";
import type { DbClient } from "../types";

export const SOURCE_DISCOVERY_COLLECTION = "sourceDiscovery";
export const SOURCE_WORK_COLLECTION = "sourceWork";

export interface DiscoveryCheckpoint {
  token: string;
  cursor: string | null;
}

export interface PendingSourceItem {
  identifier: string;
  sourceType: string;
  locality: string;
  payloadJson?: string;
  observedAt?: string;
}

function isCreateConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = Reflect.get(error, "code");
  return code === 6 || code === 11000 || code === "already-exists";
}

/** Durable references are intentionally separate from ingestible raw sources. */
export class SourceDiscoveryRepository {
  private readonly compareAndUpdate: NonNullable<DbClient["compareAndUpdate"]>;

  constructor(private readonly db: DbClient) {
    if (!db.compareAndUpdate) {
      throw new Error("Source discovery requires atomic conditional updates");
    }
    this.compareAndUpdate = db.compareAndUpdate.bind(db);
  }

  async openCheckpoint(
    id: string,
    sourceType: string,
    locality: string,
    nowIso: string,
  ): Promise<DiscoveryCheckpoint> {
    const existing = await this.db.findOne(SOURCE_DISCOVERY_COLLECTION, id);
    if (existing) return this.readCheckpoint(existing, sourceType, locality);
    const checkpoint = { token: randomUUID(), cursor: null };
    try {
      await this.db.createOne(SOURCE_DISCOVERY_COLLECTION, {
        ...checkpoint, sourceType, locality, createdAt: nowIso, updatedAt: nowIso,
      }, id);
      return checkpoint;
    } catch (error) {
      if (!isCreateConflict(error)) throw error;
    }
    const concurrent = await this.db.findOne(SOURCE_DISCOVERY_COLLECTION, id);
    if (!concurrent) throw new Error("Discovery checkpoint disappeared during creation");
    return this.readCheckpoint(concurrent, sourceType, locality);
  }

  private readCheckpoint(
    record: Record<string, unknown>,
    sourceType: string,
    locality: string,
  ): DiscoveryCheckpoint {
    if (record.sourceType !== sourceType || record.locality !== locality ||
      typeof record.token !== "string" || record.token.length === 0 ||
      (record.cursor !== null && typeof record.cursor !== "string")) {
      throw new Error("Invalid discovery checkpoint identity or state");
    }
    return { token: record.token, cursor: record.cursor };
  }

  async registerItem(id: string, item: PendingSourceItem, nowIso: string): Promise<boolean> {
    try {
      await this.db.createOne(SOURCE_WORK_COLLECTION, {
        ...item,
        status: "pending",
        leaseToken: randomUUID(),
        attempts: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      }, id);
      return true;
    } catch (error) {
      if (!isCreateConflict(error)) throw error;
    }
    const existing = await this.db.findOne(SOURCE_WORK_COLLECTION, id);
    if (existing?.identifier !== item.identifier) {
      throw new Error("Pending source identifier collision or missing record");
    }
    // Keep original discovery context, including on package/provider updates.
    return false;
  }

  async advanceCheckpoint(
    id: string,
    expectedToken: string,
    cursor: string | null,
    nowIso: string,
  ): Promise<DiscoveryCheckpoint> {
    const checkpoint = { token: randomUUID(), cursor };
    const advanced = await this.compareAndUpdate(
      SOURCE_DISCOVERY_COLLECTION, id, "token", expectedToken,
      { ...checkpoint, updatedAt: nowIso },
    );
    if (!advanced) throw new Error("Discovery checkpoint changed; reload before continuing");
    return checkpoint;
  }
}
