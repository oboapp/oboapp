import { z } from "../zod-openapi";
import { CoordinatesSchema } from "./coordinates.schema";
import { GeoJsonPointSchema } from "./geojson.schema";

/**
 * Google Geocoding API location types.
 * Reference: https://developers.google.com/maps/documentation/geocoding/overview
 */
export const GOOGLE_LOCATION_TYPES = {
  ROOFTOP: "ROOFTOP",
  RANGE_INTERPOLATED: "RANGE_INTERPOLATED",
  GEOMETRIC_CENTER: "GEOMETRIC_CENTER",
  APPROXIMATE: "APPROXIMATE",
} as const;

export type GoogleLocationType =
  (typeof GOOGLE_LOCATION_TYPES)[keyof typeof GOOGLE_LOCATION_TYPES];

export const QUALITY_PROVIDERS = {
  GOOGLE: "google",
  OVERPASS: "overpass",
  CADASTRE: "cadastre",
  GTFS: "gtfs",
  EDUCATIONAL: "educational",
  PRECOMPUTED: "precomputed",
  SOURCE: "source",
  STREET: "street",
} as const;

export type QualityProvider = (typeof QUALITY_PROVIDERS)[keyof typeof QUALITY_PROVIDERS];

export const OSM_ELEMENT_TYPES = {
  NODE: "node",
  WAY: "way",
  RELATION: "relation",
} as const;

export type OsmElementType = (typeof OSM_ELEMENT_TYPES)[keyof typeof OSM_ELEMENT_TYPES];

export const QualitySignalsSchema = z.object({
  provider: z.enum([
    QUALITY_PROVIDERS.GOOGLE,
    QUALITY_PROVIDERS.OVERPASS,
    QUALITY_PROVIDERS.CADASTRE,
    QUALITY_PROVIDERS.GTFS,
    QUALITY_PROVIDERS.EDUCATIONAL,
    QUALITY_PROVIDERS.PRECOMPUTED,
    QUALITY_PROVIDERS.SOURCE,
    QUALITY_PROVIDERS.STREET,
  ]),
  locationType: z.enum([
    GOOGLE_LOCATION_TYPES.ROOFTOP,
    GOOGLE_LOCATION_TYPES.RANGE_INTERPOLATED,
    GOOGLE_LOCATION_TYPES.GEOMETRIC_CENTER,
    GOOGLE_LOCATION_TYPES.APPROXIMATE,
  ]).optional(),
  partialMatch: z.boolean().optional(),
  osmElementType: z.enum([OSM_ELEMENT_TYPES.NODE, OSM_ELEMENT_TYPES.WAY, OSM_ELEMENT_TYPES.RELATION]).optional(),
  geometryQuality: z.number().int().min(0).max(3),
});

export type QualitySignals = z.infer<typeof QualitySignalsSchema>;

export const AddressSchema = z.object({
  originalText: z.string(),
  formattedAddress: z.string(),
  coordinates: CoordinatesSchema,
  geoJson: GeoJsonPointSchema.optional(),
  qualitySignals: QualitySignalsSchema.optional(),
});

export type Address = z.infer<typeof AddressSchema>;
