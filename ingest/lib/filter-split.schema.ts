import { z } from "zod";

const FilteredMessageSchema = z
  .object({
    plainText: z.string(),
    isOneOfMany: z.boolean().default(false),
    isInformative: z.boolean().default(false),
    isRelevant: z.boolean(),
    isUnreadable: z.boolean().default(false),
    responsibleEntity: z.string().default(""),
    markdownText: z.string().default(""),
  })
  .superRefine((msg, ctx) => {
    if (msg.isRelevant && !msg.isUnreadable && !msg.markdownText.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "markdownText must be non-empty for relevant, readable messages",
        path: ["markdownText"],
      });
    }
  });

export const FilterSplitResponseSchema = z.array(FilteredMessageSchema);

export type FilteredMessage = z.infer<typeof FilteredMessageSchema>;
export type FilterSplitResult = z.infer<typeof FilterSplitResponseSchema>;

export const FILTER_SPLIT_JSON_SCHEMA =
  FilterSplitResponseSchema.toJSONSchema();
