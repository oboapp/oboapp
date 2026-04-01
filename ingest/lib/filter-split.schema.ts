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

export const FILTER_SPLIT_JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      isOneOfMany: { type: "boolean" },
      isInformative: { type: "boolean" },
      isRelevant: { type: "boolean" },
      isUnreadable: { type: "boolean" },
      plainText: { type: "string" },
      markdownText: { type: "string" },
      responsibleEntity: { type: "string" },
    },
    required: [
      "isOneOfMany",
      "isInformative",
      "isRelevant",
      "isUnreadable",
      "plainText",
      "markdownText",
      "responsibleEntity",
    ],
  },
} as const;
