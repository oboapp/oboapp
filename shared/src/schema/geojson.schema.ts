import { z } from "../zod-openapi";

export const GeoJsonPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]),
});

export const GeoJsonMultiPointSchema = z.object({
  type: z.literal("MultiPoint"),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const GeoJsonLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const GeoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
});

export const GeoJsonGeometrySchema = z.discriminatedUnion("type", [
  GeoJsonPointSchema,
  GeoJsonMultiPointSchema,
  GeoJsonLineStringSchema,
  GeoJsonPolygonSchema,
]);

/**
 * GeoJSON Feature with flexible properties
 *
 * Standard properties (when present):
 * - `geometryQuality` (number, 0–3): Per-feature geometry precision grade
 * - `qualityProvider` (string): The geocoding provider (google, overpass, cadastre, gtfs, educational, precomputed, source, street)
 * - `qualitySignals` (object): Diagnostic metadata (locationType, partialMatch, osmElementType, etc.)
 * - `feature_type` (string): Pin, street_closure, cadastral, bus_stop, educational, etc.
 * - Other properties are application-specific
 */
export const GeoJsonFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: GeoJsonGeometrySchema,
  properties: z.record(z.string(), z.unknown()),
});

export const GeoJsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(GeoJsonFeatureSchema),
});

export type GeoJsonPoint = z.infer<typeof GeoJsonPointSchema>;
export type GeoJsonMultiPoint = z.infer<typeof GeoJsonMultiPointSchema>;
export type GeoJsonLineString = z.infer<typeof GeoJsonLineStringSchema>;
export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>;
export type GeoJsonGeometry = z.infer<typeof GeoJsonGeometrySchema>;
export type GeoJsonFeature = z.infer<typeof GeoJsonFeatureSchema>;
export type GeoJsonFeatureCollection = z.infer<
  typeof GeoJsonFeatureCollectionSchema
>;
