/**
 * Forked API contract schemas — the public API contract.
 *
 * These are intentionally separate from @oboapp/shared so changes
 * to internal schemas don't silently affect the public API contract.
 * Any changes here should be deliberate and versioned.
 */

import { z } from "../lib/zod-openapi";

// ---- Coordinates ----

export const CoordinatesSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export type Coordinates = z.infer<typeof CoordinatesSchema>;

// ---- Timespan ----

export const TimespanSchema = z.object({
  start: z.string(),
  end: z.string().nullable(),
});

export type Timespan = z.infer<typeof TimespanSchema>;

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

// ---- Pin ----

export const PinSchema = z.object({
  address: z.string(),
  coordinates: CoordinatesSchema.optional(),
  timespans: z.array(TimespanSchema),
});

export type Pin = z.infer<typeof PinSchema>;

// ---- Street Section ----

const optionalCoordinatesWithFallback = CoordinatesSchema.optional()
  .catch(undefined)
  .openapi({
    type: "object",
    properties: { lat: { type: "number" }, lng: { type: "number" } },
  });

export const StreetSectionSchema = z.object({
  street: z.string(),
  from: z.string(),
  fromCoordinates: optionalCoordinatesWithFallback,
  to: z.string(),
  toCoordinates: optionalCoordinatesWithFallback,
  timespans: z.array(TimespanSchema),
});

export type StreetSection = z.infer<typeof StreetSectionSchema>;

// ---- Address ----

export const AddressSchema = z.object({
  originalText: z.string(),
  formattedAddress: z.string(),
  coordinates: CoordinatesSchema,
  geoJson: GeoJsonPointSchema.optional(),
});

export type Address = z.infer<typeof AddressSchema>;

// ---- Cadastral Property ----

export const CadastralPropertySchema = z.object({
  identifier: z.string(),
  timespans: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
    }),
  ),
});

export type CadastralProperty = z.infer<typeof CadastralPropertySchema>;

// ---- Message ----

export const MessageSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  plainText: z.string().optional(),
  addresses: z.array(AddressSchema).optional(),
  geoJson: GeoJsonFeatureCollectionSchema.optional(),
  crawledAt: z.string().optional(),
  createdAt: z.string(),
  finalizedAt: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  markdownText: z.string().optional(),
  categories: z.array(CategoryEnum).optional(),
  timespanStart: z.string().optional(),
  timespanEnd: z.string().optional(),
  cityWide: z.boolean().optional(),
  responsibleEntity: z.string().optional(),
  pins: z.array(PinSchema).optional(),
  streets: z.array(StreetSectionSchema).optional(),
  cadastralProperties: z.array(CadastralPropertySchema).optional(),
  busStops: z.array(z.string()).optional(),
  locality: z.string(),
});

export type Message = z.infer<typeof MessageSchema>;

// ---- Source ----

export const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  logoUrl: z.string(),
  locality: z.string(),
});

export type Source = z.infer<typeof SourceSchema>;
