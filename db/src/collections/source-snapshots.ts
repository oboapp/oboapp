import { SourceSnapshotSchema, type SourceSnapshot } from "@oboapp/shared";
import type { DbClient } from "../types";

export const SOURCE_SNAPSHOTS_COLLECTION = "sourceSnapshots";

export class SourceSnapshotsRepository {
  constructor(private readonly db: DbClient) {}

  async save(snapshot: SourceSnapshot): Promise<void> {
    const validated = SourceSnapshotSchema.parse(snapshot);
    const data: SourceSnapshot = {
      ...validated,
      observedAt: new Date(validated.observedAt).toISOString(),
    };
    const id = [data.locality, data.sourceType, data.observedAt]
      .map(encodeURIComponent)
      .join(":");

    await this.db.batchWrite([
      { type: "set", collection: SOURCE_SNAPSHOTS_COLLECTION, id, data },
    ]);
  }

  async findLatest(
    sourceType: string,
    locality: string,
  ): Promise<SourceSnapshot | null> {
    const snapshots = await this.db.findMany(SOURCE_SNAPSHOTS_COLLECTION, {
      where: [
        { field: "locality", op: "==", value: locality },
        { field: "sourceType", op: "==", value: sourceType },
      ],
      orderBy: [{ field: "observedAt", direction: "desc" }],
      limit: 1,
    });
    const snapshot = snapshots[0];

    if (!snapshot) {
      return null;
    }

    return SourceSnapshotSchema.parse(snapshot);
  }
}
