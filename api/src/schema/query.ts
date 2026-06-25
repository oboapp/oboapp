import { z } from "../lib/zod-openapi";
import { CategoryEnum } from "./contract";
import { getMaxMessagesLimit } from "../lib/messages-limit-config";

const UNCATEGORIZED = "uncategorized";

const commaDelimitedCategories = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.union([CategoryEnum, z.literal(UNCATEGORIZED)])).max(10));

const commaDelimitedSources = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()).max(20));

const finiteNumber = z
  .string()
  .transform(Number)
  .refine((value) => Number.isFinite(value), {
    message: "Expected a finite number",
  });
const maxMessagesLimit = getMaxMessagesLimit();

export const messagesQuerySchema = z.object({
  north: finiteNumber.optional(),
  south: finiteNumber.optional(),
  east: finiteNumber.optional(),
  west: finiteNumber.optional(),
  zoom: finiteNumber
    .refine((value) => value >= 1 && value <= 22, {
      message: "Expected zoom between 1 and 22",
    })
    .optional(),
  categories: commaDelimitedCategories.optional(),
  sources: commaDelimitedSources.optional(),
  timespanEndGte: z.coerce.date().optional(),
  limit: finiteNumber
    .refine((value) => Number.isInteger(value), {
      message: "Expected an integer",
    })
    .refine((value) => value >= 1 && value <= maxMessagesLimit, {
      message: `Expected limit between 1 and ${maxMessagesLimit}`,
    })
    .optional(),
});

export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
