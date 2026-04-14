/**
 * Forked API contract schemas — public API v2 contract.
 *
 * Compared to v1, the pipeline-internal geo-derivable fields are removed:
 * addresses, pins, streets, cadastralProperties, busStops.
 * All of this information is available via geoJson.
 */

import { z } from "../lib/zod-openapi";

// ---- Category ----

export const CategoryEnum = z.enum([
  "air-quality",
  "art",
  "bicycles",
  "construction-and-repairs",
  "culture",
  "electricity",
  "health",
  "heating",
  "parking",
  "public-transport",
  "road-block",
  "sports",
  "traffic",
  "vehicles",
  "waste",
  "water",
  "weather",
]);

export type Category = z.infer<typeof CategoryEnum>;

// ---- GeoJSON ----

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
export type GeoJsonGeometry = z.infer<typeof GeoJsonGeometrySchema>;
export type GeoJsonFeature = z.infer<typeof GeoJsonFeatureSchema>;
export type GeoJsonFeatureCollection = z.infer<
  typeof GeoJsonFeatureCollectionSchema
>;

// ---- Message v2 ----

export const MessageV2Schema = z.object({
  id: z.string().optional(),
  text: z.string(),
  plainText: z.string().optional(),
  markdownText: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  locality: z.string(),
  categories: z.array(CategoryEnum).optional(),
  geoJson: GeoJsonFeatureCollectionSchema.optional(),
  crawledAt: z.string().optional(),
  createdAt: z.string(),
  finalizedAt: z.string().optional(),
  timespanStart: z.string().optional(),
  timespanEnd: z.string().optional(),
  cityWide: z.boolean().optional(),
  responsibleEntity: z.string().optional(),
});

export type MessageV2 = z.infer<typeof MessageV2Schema>;

// ---- Source (unchanged from v1) ----

export const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  logoUrl: z.string(),
  locality: z.string(),
});

export type Source = z.infer<typeof SourceSchema>;
