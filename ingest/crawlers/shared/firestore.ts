import type { OboDb } from "@oboapp/db";
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
