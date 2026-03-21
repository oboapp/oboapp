/**
 * Source IDs that are marked as experimental.
 *
 * Experimental sources are not included in notifications for users
 * who have not enabled experimental features in their settings.
 *
 * To mark a source as experimental, add its ID to this set.
 */
export const EXPERIMENTAL_SOURCE_IDS: ReadonlySet<string> = new Set([
  // Add experimental source IDs here, e.g.:
  // "some-new-source",
]);

/**
 * Check if a source is experimental.
 */
export function isExperimentalSource(sourceId: string): boolean {
  return EXPERIMENTAL_SOURCE_IDS.has(sourceId);
}
