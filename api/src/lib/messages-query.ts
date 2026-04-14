/**
 * Shared DB query utilities for message route handlers.
 *
 * These functions operate on raw MessageRecord (Record<string, unknown>) and
 * have no dependency on the versioned Message type. They are shared between
 * v1 and v2 route handlers to avoid duplicating DB/geo query logic.
 */

import type { OboDb } from "@oboapp/db";
import type { WhereClause } from "@oboapp/db";
import { clampBounds, addBuffer, type ViewportBounds } from "./bounds-utils";

export type MessageRecord = Record<string, unknown>;

const DEFAULT_RELEVANCE_DAYS = 7;
const FIRESTORE_IN_OPERATOR_LIMIT = 10;

export function isUncategorizedDoc(doc: MessageRecord): boolean {
  const categories = Array.isArray(doc.categories) ? doc.categories : undefined;
  return !categories || categories.length === 0;
}

export function toViewportBounds(params: {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
}): ViewportBounds | null {
  const { north, south, east, west } = params;
  if (
    north === undefined ||
    south === undefined ||
    east === undefined ||
    west === undefined
  ) {
    return null;
  }

  const rawBounds: ViewportBounds = { north, south, east, west };
  const clampedBounds = clampBounds(rawBounds);
  return addBuffer(clampedBounds, 0.2);
}

export function getCutoffDate(override?: Date): Date {
  if (override) {
    return override;
  }

  const parsed = process.env.MESSAGE_RELEVANCE_DAYS
    ? Number.parseInt(process.env.MESSAGE_RELEVANCE_DAYS, 10)
    : DEFAULT_RELEVANCE_DAYS;
  const relevanceDays = Number.isNaN(parsed) ? DEFAULT_RELEVANCE_DAYS : parsed;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - relevanceDays);
  return cutoffDate;
}

export async function findRecentMessageDocs(
  db: OboDb,
  cutoffDate: Date,
  locality?: string,
): Promise<MessageRecord[]> {
  const where: WhereClause[] = [
    { field: "timespanEnd", op: ">=", value: cutoffDate },
  ];
  if (locality) {
    where.push({ field: "locality", op: "==", value: locality });
  }
  return db.messages.findMany({
    where,
    orderBy: [{ field: "timespanEnd", direction: "desc" }],
  });
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function findRecentMessageDocsBySources(
  db: OboDb,
  cutoffDate: Date,
  sources: string[],
  locality?: string,
): Promise<MessageRecord[]> {
  if (sources.length === 0) {
    return [];
  }

  const sourceChunks = chunkArray(sources, FIRESTORE_IN_OPERATOR_LIMIT);
  const chunkQueries = sourceChunks.map((sourceChunk) => {
    const where: WhereClause[] = [
      { field: "source", op: "in", value: sourceChunk },
      { field: "timespanEnd", op: ">=", value: cutoffDate },
    ];
    if (locality) {
      where.push({ field: "locality", op: "==", value: locality });
    }
    return db.messages.findMany({
      where,
      orderBy: [{ field: "timespanEnd", direction: "desc" }],
    });
  });

  const chunkResults = await Promise.all(chunkQueries);
  return chunkResults.flat();
}

function toSourceList(sourceSet?: Set<string>): string[] {
  return sourceSet ? Array.from(sourceSet) : [];
}

export async function findUncategorizedDocs(
  db: OboDb,
  cutoffDate: Date,
  sourceSet?: Set<string>,
  locality?: string,
): Promise<MessageRecord[]> {
  const sourceList = toSourceList(sourceSet);
  const docs = sourceList.length
    ? await findRecentMessageDocsBySources(db, cutoffDate, sourceList, locality)
    : await findRecentMessageDocs(db, cutoffDate, locality);

  return docs.filter((doc) => isUncategorizedDoc(doc));
}

export function applyOptionalSourceSet(
  docs: MessageRecord[],
  sourceSet?: Set<string>,
): MessageRecord[] {
  if (!sourceSet) {
    return docs;
  }

  return docs.filter(
    (doc) => typeof doc.source === "string" && sourceSet.has(doc.source),
  );
}

export function isInvalidSourceForFilter(
  doc: MessageRecord,
  sourceSet?: Set<string>,
): boolean {
  if (!sourceSet) {
    return false;
  }

  return (
    !doc.source || typeof doc.source !== "string" || !sourceSet.has(doc.source)
  );
}

export async function buildCategoryQueryPlans(
  db: OboDb,
  cutoffDate: Date,
  realCategories: string[],
  includeUncategorized: boolean,
  sourceSet?: Set<string>,
  locality?: string,
): Promise<Array<{ uncategorizedOnly: boolean; docs: MessageRecord[] }>> {
  const plans: Array<
    Promise<{ uncategorizedOnly: boolean; docs: MessageRecord[] }>
  > = [];

  if (realCategories.length > 0) {
    const where: WhereClause[] = [
      {
        field: "categories",
        op: "array-contains-any",
        value: realCategories,
      },
      { field: "timespanEnd", op: ">=", value: cutoffDate },
    ];
    if (locality) {
      where.push({ field: "locality", op: "==", value: locality });
    }
    plans.push(
      db.messages
        .findMany({
          where,
          orderBy: [{ field: "timespanEnd", direction: "desc" }],
        })
        .then((docs) => ({ uncategorizedOnly: false, docs })),
    );
  }

  if (includeUncategorized) {
    plans.push(
      findUncategorizedDocs(db, cutoffDate, sourceSet, locality).then(
        (docs) => ({
          uncategorizedOnly: true,
          docs,
        }),
      ),
    );
  }

  return Promise.all(plans);
}

export function getValidatedSources(
  selectedSources: string[] | undefined,
  allSourceIds: Set<string>,
): string[] | undefined {
  if (!selectedSources || selectedSources.length === 0) {
    return undefined;
  }

  const uniqueSources = Array.from(new Set(selectedSources));
  return uniqueSources.filter((sourceId) => allSourceIds.has(sourceId));
}
