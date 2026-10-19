import type { OboDb, DiscoveryCheckpoint } from "@oboapp/db";
import { SourceDiscoveryRepository } from "@oboapp/db";
import type { DiscoveryPage, SourceMetadata } from "@oboapp/source-sdk";
import { validateLocality } from "@oboapp/shared";
import { encodeDocumentId, isUrlProcessed } from "@/crawlers/shared/firestore";
import { prepareDiscoveryPage } from "./discovery-page";

function checkpointId(source: SourceMetadata, locality: string): string {
  validateLocality(locality);
  if (typeof source.id !== "string" || source.id.trim().length === 0 ||
    new TextEncoder().encode(source.id).byteLength > 128 || !Array.isArray(source.localities) ||
    !source.localities.includes(locality)) {
    throw new Error("Source metadata does not support the selected locality");
  }
  return encodeDocumentId(JSON.stringify([source.id, locality]));
}

/** The caller obtains db through getDb after loading its environment. */
export async function openDiscoveryCheckpoint(
  db: OboDb,
  source: SourceMetadata,
  locality: string,
): Promise<DiscoveryCheckpoint> {
  const id = checkpointId(source, locality);
  return new SourceDiscoveryRepository(db.client).openCheckpoint(
    id, source.id, locality, new Date().toISOString(),
  );
}

/** Replay partial pages safely; raw sources remain the authority for known identifiers. */
export async function registerDiscoveryPage(
  db: OboDb,
  source: SourceMetadata,
  locality: string,
  checkpoint: DiscoveryCheckpoint,
  page: DiscoveryPage,
): Promise<{ registered: number; known: number; checkpoint: DiscoveryCheckpoint }> {
  const id = checkpointId(source, locality);
  const prepared = prepareDiscoveryPage(source.id, locality, page);
  const repository = new SourceDiscoveryRepository(db.client);
  const nowIso = new Date().toISOString();
  let registered = 0;
  let known = 0;
  for (const item of prepared.items) {
    // Includes both legacy base64 and MD5 IDs, regardless of processed state.
    if (await isUrlProcessed(item.identifier, db)) {
      known++;
      continue;
    }
    if (await repository.registerItem(encodeDocumentId(item.identifier), item, nowIso)) {
      registered++;
    } else {
      known++;
    }
  }
  const next = await repository.advanceCheckpoint(id, checkpoint.token, prepared.nextCursor, nowIso);
  return { registered, known, checkpoint: next };
}
