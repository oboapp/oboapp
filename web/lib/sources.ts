import { SOURCES } from "@oboapp/shared";
import type { SourceDefinition } from "@oboapp/shared";

type MutableSourceDefinition = {
  -readonly [K in keyof SourceDefinition]: SourceDefinition[K] extends
    | readonly (infer U)[]
    | undefined
    ? undefined extends SourceDefinition[K]
      ? U[] | undefined
      : U[]
    : SourceDefinition[K];
};

/**
 * Sources array re-exported for web consumers.
 * Cloned into fully mutable objects to maintain backward compatibility
 * with downstream code that expects non-readonly properties.
 */
const sources: MutableSourceDefinition[] = SOURCES.map((src) => ({
  ...src,
  localities: [...src.localities],
}));
export default sources;
