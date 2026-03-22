export type { SourceDefinition } from "./sources";
export { SOURCES } from "./sources";
import { SOURCES } from "./sources";

/**
 * Source IDs that are marked as experimental.
 *
 * Derived from the source definitions — to mark a source as experimental,
 * set `experimental: true` on its entry in `sources.ts`.
 */
export const EXPERIMENTAL_SOURCE_IDS: ReadonlySet<string> = new Set(
  SOURCES.filter((s) => s.experimental).map((s) => s.id),
);

/**
 * Check if a source is experimental.
 */
export function isExperimentalSource(sourceId: string): boolean {
  return EXPERIMENTAL_SOURCE_IDS.has(sourceId);
}
