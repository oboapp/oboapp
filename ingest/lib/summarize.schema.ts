import { z } from "zod";

const SummarizeResponseSchema = z.object({
  summary: z.string().trim().min(1),
});

export { SummarizeResponseSchema };
export type SummarizeResult = z.infer<typeof SummarizeResponseSchema>;

export const SUMMARIZE_JSON_SCHEMA = SummarizeResponseSchema.toJSONSchema();
