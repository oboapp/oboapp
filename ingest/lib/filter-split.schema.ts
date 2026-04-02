import { z } from "zod";

const FilteredMessageSchema = z.object({
  plainText: z.string(),
  isOneOfMany: z.boolean().default(false),
  isInformative: z.boolean().default(false),
  isRelevant: z.boolean(),
  isUnreadable: z.boolean().default(false),
  responsibleEntity: z.string().default(""),
  markdownText: z.string().default(""),
});

export const FilterSplitResponseSchema = z.array(FilteredMessageSchema);

export type FilteredMessage = z.infer<typeof FilteredMessageSchema>;
export type FilterSplitResult = z.infer<typeof FilterSplitResponseSchema>;

export const FILTER_SPLIT_JSON_SCHEMA =
  FilterSplitResponseSchema.toJSONSchema();
