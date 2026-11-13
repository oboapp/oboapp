import { SOURCES } from "@oboapp/shared";

/** Runtime selection follows the same instance assembly as the web catalog. */
export function getSelectedSourceIds(): string[] {
  return SOURCES.map((source) => source.id);
}

export function getEmergentSourceIds(): string[] {
  return SOURCES.filter((source) => source.emergent).map((source) => source.id);
}

/** Load a selected implementation only after the caller has configured its environment. */
export async function runSelectedSource(sourceId: string): Promise<void> {
  if (!getSelectedSourceIds().includes(sourceId)) {
    throw new Error(`Source "${sourceId}" is not selected for this instance`);
  }

  const entrypoint = `../crawlers/${sourceId}/index.js`;
  const source: { crawl: () => Promise<void> } = await import(entrypoint);
  await source.crawl();
}
