import { z } from "zod";
import { normalizeCategoriesInput } from "./category-utils";
import { CategoryEnum } from "@oboapp/shared";

const CategorizationResponseSchema = z.object({
  categories: z.preprocess(normalizeCategoriesInput, z.array(CategoryEnum)),
});

export { CategorizationResponseSchema };

export type Category = z.infer<typeof CategoryEnum>;
export type CategorizationResult = z.infer<typeof CategorizationResponseSchema>;

// CATEGORIZE_JSON_SCHEMA is sent to Gemini as the structured-output constraint and must
// be a plain JSON schema. CategorizationResponseSchema is used at runtime to validate
// Gemini's response and applies z.preprocess(normalizeCategoriesInput) for case-folding.
// They intentionally differ — keep both in sync when CategoryEnum changes.
export const CATEGORIZE_JSON_SCHEMA = z
  .object({ categories: z.array(CategoryEnum) })
  .toJSONSchema();
