export function toTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export type PaginationCursor = {
  date: Date;
  id: string;
};

export type PaginationResult = {
  pageDocs: Record<string, unknown>[];
  boundaryDoc: Record<string, unknown> | undefined;
  hasMore: boolean;
};

/**
 * Applies cursor-based pagination over a pre-fetched batch of documents.
 *
 * Documents must already be ordered by `finalizedAt` descending by the caller.
 * Within each same-timestamp bucket they are sorted by `_id` descending so that
 * the order is deterministic.  The `isCandidate` predicate lets each route apply
 * its own in-memory filter (e.g. `isUnreadable === true`).
 *
 * Returns the page slice, the boundary document for the next-cursor, and whether
 * more pages are likely to exist.
 */
export function paginateCandidateDocs(
  fetchedDocs: Record<string, unknown>[],
  cursor: PaginationCursor | null,
  isCandidate: (doc: Record<string, unknown>) => boolean,
  pageSize: number,
  fetchLimit: number,
): PaginationResult {
  const shouldIncludeByCursor = (doc: Record<string, unknown>): boolean => {
    if (!cursor) return true;

    const docTime = toTimestamp(doc.finalizedAt);
    if (docTime === null) return false;
    const cursorTime = cursor.date.getTime();

    if (docTime < cursorTime) return true;
    if (docTime > cursorTime) return false;
    return String(doc._id).localeCompare(cursor.id) < 0;
  };

  const candidateDocs: Record<string, unknown>[] = [];
  const targetCount = pageSize + 1;
  let index = 0;

  while (index < fetchedDocs.length && candidateDocs.length < targetCount) {
    const bucketStart = fetchedDocs[index];
    const bucketTime = toTimestamp(bucketStart.finalizedAt);
    if (bucketTime === null) {
      index += 1;
      continue;
    }

    const bucket: Record<string, unknown>[] = [];

    while (index < fetchedDocs.length) {
      const current = fetchedDocs[index];
      const currentTime = toTimestamp(current.finalizedAt);
      if (currentTime === null) {
        index += 1;
        continue;
      }
      if (currentTime !== bucketTime) {
        break;
      }
      bucket.push(current);
      index += 1;
    }

    bucket.sort((left, right) =>
      String(right._id).localeCompare(String(left._id)),
    );

    for (const doc of bucket) {
      if (!shouldIncludeByCursor(doc)) continue;
      if (!isCandidate(doc)) continue;
      candidateDocs.push(doc);
      if (candidateDocs.length >= targetCount) break;
    }
  }

  const pageDocs = candidateDocs.slice(0, pageSize);
  const hasMoreCandidates = candidateDocs.length > pageSize;
  const hitFetchLimit = fetchedDocs.length === fetchLimit;
  const hasMore = hasMoreCandidates || hitFetchLimit;
  const lastDoc = pageDocs.at(-1);

  let boundaryDoc: Record<string, unknown> | undefined;

  if (hasMoreCandidates) {
    boundaryDoc = lastDoc;
  } else if (hitFetchLimit) {
    // Use the lowest _id within the oldest-timestamp bucket as the cursor so
    // that same-timestamp docs are never skipped on the next page.
    const validDocs = fetchedDocs.filter(
      (doc) => toTimestamp(doc.finalizedAt) !== null,
    );

    if (validDocs.length > 0) {
      let oldestTime = toTimestamp(validDocs[0].finalizedAt)!;
      for (let i = 1; i < validDocs.length; i += 1) {
        const t = toTimestamp(validDocs[i].finalizedAt)!;
        if (t < oldestTime) oldestTime = t;
      }

      const oldestBucket = validDocs.filter(
        (doc) => toTimestamp(doc.finalizedAt) === oldestTime,
      );

      oldestBucket.sort((left, right) =>
        String(left._id).localeCompare(String(right._id)),
      );

      boundaryDoc = oldestBucket[0];
    }
  }

  return { pageDocs, boundaryDoc, hasMore };
}
