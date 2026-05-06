export type { SourceDefinition } from "./source-definition";

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE ASSEMBLY — replace this file in your fork
// ─────────────────────────────────────────────────────────────────────────────
// This file is the DEMO shipped with the upstream repo. It shows the pattern
// but only includes a small sample of sources.
//
// When you fork oboapp for your city:
//   1. Replace this file with your own assembly.
//   2. Import the source definition files relevant to your deployment.
//   3. Add any city-specific sources that live only in your fork.
//
// See docs/setup/new-locality-instance.md for the full guide.
//
// Each individual source lives in ./sources/{id}.ts and uses `export default`,
// so you choose the local name when you import it here.
//
// EMERGENT_CRAWLERS is derived from this SOURCES assembly and is used by
// `ingest/pipeline.ts --emergent` (and any consumer of @oboapp/shared).
// It does NOT control Terraform scheduling — Terraform derives the emergent
// workflow from `emergent = true` in the crawler's Terraform entry.
// See AGENTS.md > Instance Configuration for details.
// ─────────────────────────────────────────────────────────────────────────────
import sofiaBg from "./sources/sofia-bg";
import sofiyskavoda from "./sources/sofiyska-voda";
import sensorCommunity from "./sources/sensor-community";

// ─── Instance assembly ────────────────────────────────────────────────────────
// This is the list of sources active for this instance.
// Forks replace this file to configure their own city's sources.
export const SOURCES = [
  sofiaBg, // regular crawler (3× daily)
  sofiyskavoda, // emergent: true  → runs every 30 minutes
  sensorCommunity, // emergent: true, experimental: true
] as const;

/**
 * Source IDs passed to `pipeline --emergent` (the legacy ingest pipeline path).
 * Derived from the `emergent` flag on each source in this SOURCES assembly.
 * Note: Terraform scheduling is independent — it uses `emergent = true` in
 * the crawler's Terraform entry, not this list.
 */
export const EMERGENT_CRAWLERS: readonly string[] = SOURCES.filter(
  (s) => s.emergent,
).map((s) => s.id);
