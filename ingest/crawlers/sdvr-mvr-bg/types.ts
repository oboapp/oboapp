import type { BaseSourceDocument } from "../shared/types";
import type { PostLink } from "../shared/extractors";

export interface SourceDocument extends BaseSourceDocument {
  sourceType: "sdvr-mvr-bg";
}

export type { PostLink };
