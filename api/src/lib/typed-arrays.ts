/**
 * Type-safe array extractors for DB records.
 *
 * Uses the forked API contract schemas (not @oboapp/shared) to ensure
 * the public API contract is self-contained.
 */
import { z } from "zod";
import {
  AddressSchema,
  CategoryEnum,
  PinSchema,
  StreetSectionSchema,
  CadastralPropertySchema,
  GeoJsonFeatureCollectionSchema,
  type Address,
  type Pin,
  type StreetSection,
  type CadastralProperty,
  type Category,
  type GeoJsonFeatureCollection,
} from "../schema/contract";

const CATEGORIES_SCHEMA = z.array(CategoryEnum);
const ADDRESSES_SCHEMA = z.array(AddressSchema);
const PINS_SCHEMA = z.array(PinSchema);
const STREETS_SCHEMA = z.array(StreetSectionSchema);
const CADASTRAL_PROPERTIES_SCHEMA = z.array(CadastralPropertySchema);
const BUS_STOPS_SCHEMA = z.array(z.string());

export function getCategories(value: unknown): Category[] {
  const result = CATEGORIES_SCHEMA.safeParse(value);
  return result.success ? result.data : [];
}

export function getAddresses(value: unknown): Address[] {
  const result = ADDRESSES_SCHEMA.safeParse(value);
  return result.success ? result.data : [];
}

export function getPins(value: unknown): Pin[] | undefined {
  const result = PINS_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function getStreets(value: unknown): StreetSection[] | undefined {
  const result = STREETS_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function getCadastralProperties(
  value: unknown,
): CadastralProperty[] | undefined {
  const result = CADASTRAL_PROPERTIES_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function getBusStops(value: unknown): string[] | undefined {
  const result = BUS_STOPS_SCHEMA.safeParse(value);
  return result.success ? result.data : undefined;
}

export function getFeatureCollection(
  value: unknown,
): GeoJsonFeatureCollection | undefined {
  const result = GeoJsonFeatureCollectionSchema.safeParse(value);
  if (!result.success) return undefined;
  // Strip internal geocoding signals from GeoJSON feature properties
  // so they don't leak into the public v1 API response.
  return {
    ...result.data,
    features: result.data.features.map((feature) => {
      const {
        qualitySignals: _qs,
        qualityProvider: _qp,
        geometryQuality: _gq,
        ...publicProperties
      } = feature.properties ?? {};
      return { ...feature, properties: publicProperties };
    }),
  };
}
