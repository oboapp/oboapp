import { z } from "../lib/zod-openapi";
import { CategoryEnum } from "./contract";

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

const finiteNumber = z.coerce.number().finite();

export const messagesQuerySchema = z.object({
  north: finiteNumber.optional(),
  south: finiteNumber.optional(),
  east: finiteNumber.optional(),
  west: finiteNumber.optional(),
  zoom: finiteNumber.min(1).max(22).optional(),
  categories: commaDelimitedCategories.optional(),
  sources: commaDelimitedSources.optional(),
  timespanEndGte: z.coerce.date().optional(),
});

export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
