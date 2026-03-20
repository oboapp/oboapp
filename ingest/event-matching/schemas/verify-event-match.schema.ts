import { z } from "zod";

export const VerifyEventMatchResponseSchema = z.object({
  isSameEvent: z.boolean(),
  reasoning: z.string(),
});

export type VerifyEventMatchResult = z.infer<
  typeof VerifyEventMatchResponseSchema
>;
