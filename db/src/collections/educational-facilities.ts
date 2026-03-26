/**
 * Educational facilities collection repository.
 *
 * Document ID = `{type}-{facilityNumber}` (e.g. "school-93", "kindergarten-133").
 */

import type { DbClient, FindManyOptions, WhereClause, BatchOperation } from "../types";

/** Collection name constant */
export const EDUCATIONAL_FACILITIES_COLLECTION = "educationalFacilities";

export class EducationalFacilitiesRepository {
  constructor(private db: DbClient) {}

  async findById(id: string): Promise<Record<string, unknown> | null> {
    return this.db.findOne(EDUCATIONAL_FACILITIES_COLLECTION, id);
  }

  async findMany(options?: FindManyOptions): Promise<Record<string, unknown>[]> {
    return this.db.findMany(EDUCATIONAL_FACILITIES_COLLECTION, options);
  }

  /**
   * Upsert a batch of facilities (merge mode).
   * Chunks into groups of 100 for efficiency.
   */
  async upsertBatch(
    facilities: { id: string; data: Record<string, unknown> }[],
  ): Promise<void> {
    const BATCH_SIZE = 100;
    for (let i = 0; i < facilities.length; i += BATCH_SIZE) {
      const chunk = facilities.slice(i, i + BATCH_SIZE);
      const ops: BatchOperation[] = chunk.map((facility) => ({
        type: "set" as const,
        collection: EDUCATIONAL_FACILITIES_COLLECTION,
        id: facility.id,
        data: facility.data,
        merge: true,
      }));
      await this.db.batchWrite(ops);
    }
  }

  async count(where?: WhereClause[]): Promise<number> {
    return this.db.count(EDUCATIONAL_FACILITIES_COLLECTION, where);
  }
}
