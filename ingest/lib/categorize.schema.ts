import { z } from "zod";
import { normalizeCategoriesInput } from "./category-utils";
import { CategoryEnum } from "@oboapp/shared";

const CategorizationResponseSchema = z.object({
  categories: z.preprocess(normalizeCategoriesInput, z.array(CategoryEnum)),
});

export { CategorizationResponseSchema };

export type Category = z.infer<typeof CategoryEnum>;
export type CategorizationResult = z.infer<typeof CategorizationResponseSchema>;

export const CATEGORIZE_JSON_SCHEMA = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["categories"],
} as const;
