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
  deepLinkUrl: z.string().optional(),
});

/** Strip package-supplied platform fields and preserve the existing raw format. */
export function parseSourceContent(value: unknown): Record<string, unknown> {
  const { geoJson, ...content } = contentSchema.parse(value);
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
