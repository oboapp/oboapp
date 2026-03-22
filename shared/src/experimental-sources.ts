import rawSources from "./sources.json";

/** Shape of a source entry in sources.json */
export interface SourceDefinition {
  readonly id: string;
  readonly url: string;
  readonly name: string;
  readonly localities: readonly string[];
  /** When true, notifications from this source require the user to opt-in */
  readonly experimental?: boolean;
}

/**
 * All source definitions loaded from sources.json.
 */
export const SOURCES: readonly SourceDefinition[] = rawSources;

/**
 * Source IDs that are marked as experimental.
 *
 * Derived from `sources.json` — to mark a source as experimental,
 * set `"experimental": true` on its entry in that file.
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
