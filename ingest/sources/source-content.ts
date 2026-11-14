import { z } from "zod";
import { validateAndFixGeoJSON } from "@/crawlers/shared/geojson-validation";

const dateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid date");
const contentSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  datePublished: dateString,
  markdownText: z.string().optional(),
  timespanStart: dateString.transform((value) => new Date(value)).optional(),
  timespanEnd: dateString.transform((value) => new Date(value)).optional(),
  geoJson: z.unknown().optional(),
  categories: z.array(z.string().trim().min(1)).optional(),
  isRelevant: z.boolean().optional(),
  cityWide: z.boolean().optional(),
  deepLinkUrl: z.string().optional(),
});

// Toplo historically stores these provider strings unchanged, including empty
// titles and malformed publication dates. Timespans and geometry stay validated.
const legacyToploContentSchema = contentSchema.extend({
  title: z.string(),
  datePublished: z.string(),
});

export type SourceContentValidation = "strict" | "legacy-toplo";

/** Strip package-supplied platform fields and preserve the existing raw format. */
export function parseSourceContent(
  value: unknown,
  validation: SourceContentValidation = "strict",
): Record<string, unknown> {
  const schema = validation === "legacy-toplo" ? legacyToploContentSchema : contentSchema;
  const { geoJson, ...content } = schema.parse(value);
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(content).filter(([, field]) => field !== undefined),
  );
  if (geoJson !== undefined) {
    const geometry: unknown = typeof geoJson === "string" ? JSON.parse(geoJson) : geoJson;
    const validated = validateAndFixGeoJSON(geometry);
    if (!validated.isValid || validated.errors.length > 0) {
      throw new Error(`Invalid source GeoJSON: ${validated.errors.join("; ")}`);
    }
    result.geoJson = JSON.stringify(validated.geoJson);
  }
  return result;
}
