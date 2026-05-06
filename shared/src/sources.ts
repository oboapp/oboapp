export type { SourceDefinition } from "./source-definition";

// ─── Individual source definitions ───────────────────────────────────────────
// Each source lives in its own file under ./sources/.
// To add a new source: create ./sources/{id}.ts and import it below.
// To customize for an instance: replace this file in the fork — import only
// the sources relevant to your city and add any instance-specific sources.
//
// This file is the REFERENCE EXAMPLE shipped with the upstream repo.
// A real deployment replaces this file with its own city's assembly.
import { sofiaBg } from "./sources/sofia-bg";
import { sofiyskavoda } from "./sources/sofiyska-voda";
import { sensorCommunity } from "./sources/sensor-community";

// ─── Instance assembly ────────────────────────────────────────────────────────
// This is the list of sources active for this instance.
// Forks replace this file to configure their own city's sources.
export const SOURCES = [
  sofiaBg,       // regular crawler (3× daily)
  sofiyskavoda,  // emergent: true  → runs every 30 minutes
  sensorCommunity, // emergent: true, experimental: true
] as const;

/**
 * Source IDs of crawlers that run on the emergent (30-minute) schedule.
 * Derived from the `emergent` flag on each source definition — set
 * `emergent: true` on a source to include it here automatically.
 */
export const EMERGENT_CRAWLERS: readonly string[] = SOURCES.filter(
  (s) => s.emergent,
).map((s) => s.id);
