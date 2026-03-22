import { SOURCES } from "@oboapp/shared";
import type { SourceDefinition } from "@oboapp/shared";

/**
 * Sources array re-exported for web consumers.
 * Spread into a mutable array to maintain backward compatibility.
 */
const sources: SourceDefinition[] = [...SOURCES];
export default sources;
