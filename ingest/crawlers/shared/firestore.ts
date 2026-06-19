import type { OboDb } from "@oboapp/db";
import { normalizeCategoriesInput } from "@/lib/category-utils";
import { validateLocality } from "@oboapp/shared";
import type { BaseSourceDocument } from "./types";
import { logger } from "@/lib/logger";
import { createHash } from "node:crypto";

export function encodeDocumentIdForLookup(url: string): string[] {
  const encodedIds: string[] = [];
  const legacyId = Buffer.from(url)
    .toString("base64")
    .replaceAll(/[/+=]/g, "_");
  if (legacyId.length < 1500) {
    encodedIds.push(legacyId);
  }
  encodedIds.push(encodeDocumentId(url));
  return encodedIds;
}

export function encodeDocumentId(url: string): string {
  const encodedId = createHash("md5").update(url).digest("hex");
  return encodedId;
}

/**
 * Check if a source document already exists for the given URL.
 *
 * This looks up by document ID (derived from the URL).
 */
export async function isUrlProcessed(url: string, db: OboDb): Promise<boolean> {
  const docIds = encodeDocumentIdForLookup(url);
  for (const docId of docIds) {
    const doc = await db.sources.findById(docId);
    if (doc !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Save source document to database
 * @throws Error if save operation fails or target is invalid
 */
export async function saveSourceDocument<T extends BaseSourceDocument>(
  doc: T,
  db: OboDb,
  options?: {
    transformData?: (doc: T) => Record<string, unknown>;
    logSuccess?: boolean;
  },
): Promise<void> {
  // Validate target before saving
  validateLocality(doc.locality);

  const docId = encodeDocumentId(doc.url);

  const data = options?.transformData
    ? options.transformData(doc)
    : { ...doc, crawledAt: new Date(doc.crawledAt) };

  if ("categories" in data) {
    data.categories = normalizeCategoriesInput(data.categories);
  }

  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(data),
  );

  // New source documents start unprocessed. The ingest pipeline flips this to
  // true once a corresponding message is created. Crawlers only ever write new
  // documents (callers guard with isUrlProcessed / saveSourceDocumentIfNew), so
  // this never resets an already-processed source.
  if (record.processed === undefined) {
    record.processed = false;
  }

  await db.sources.setOne(docId, record);

  if (options?.logSuccess !== false) {
    logger.debug("Saved document", {
      sourceType: doc.sourceType,
      title: doc.title.substring(0, 50),
    });
  }
}

/**
 * Save source document only if it doesn't already exist
 * @returns true if saved, false if already exists
 * @throws Error if database operations fail
 */
export async function saveSourceDocumentIfNew<T extends BaseSourceDocument>(
  doc: T,
  db: OboDb,
  options?: Parameters<typeof saveSourceDocument<T>>[2],
): Promise<boolean> {
  const exists = await isUrlProcessed(doc.url, db);
  if (exists) {
    return false;
  }
  await saveSourceDocument(doc, db, options);
  return true;
}
