import type { OboDb } from "@oboapp/db";
import { normalizeCategoriesInput } from "@/lib/category-utils";
import { validateLocality } from "@oboapp/shared";
import type { BaseSourceDocument } from "./types";
import { logger } from "@/lib/logger";

/**
 * Encode URL to a safe document ID (Base64 with safe characters)
 */
export function encodeDocumentId(url: string): string {
  return Buffer.from(url).toString("base64").replaceAll(/[/+=]/g, "_");
}

/**
 * Check if a URL has already been processed
 * @throws Error if database operation fails
 */
export async function isUrlProcessed(
  url: string,
  db: OboDb,
): Promise<boolean> {
  const docId = encodeDocumentId(url);
  const doc = await db.sources.findById(docId);
  return doc !== null;
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
  await db.sources.setOne(docId, record);

  if (options?.logSuccess !== false) {
    logger.info("Saved document", { title: doc.title.substring(0, 50) });
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
