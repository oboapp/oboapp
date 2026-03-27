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

export function getCategories(value: unknown): Category[] {
  const result = z.array(CategoryEnum).safeParse(value);
  return result.success ? result.data : [];
}

export function getAddresses(value: unknown): Address[] {
  const result = z.array(AddressSchema).safeParse(value);
  return result.success ? result.data : [];
}

export function getPins(value: unknown): Pin[] | undefined {
  const result = z.array(PinSchema).safeParse(value);
  return result.success ? result.data : undefined;
}

export function getStreets(value: unknown): StreetSection[] | undefined {
  const result = z.array(StreetSectionSchema).safeParse(value);
  return result.success ? result.data : undefined;
}

export function getCadastralProperties(
  value: unknown,
): CadastralProperty[] | undefined {
  const result = z.array(CadastralPropertySchema).safeParse(value);
  return result.success ? result.data : undefined;
}

export function getBusStops(value: unknown): string[] | undefined {
  const result = z.array(z.string()).safeParse(value);
  return result.success ? result.data : undefined;
}

export function getFeatureCollection(
  value: unknown,
): GeoJsonFeatureCollection | undefined {
  const result = GeoJsonFeatureCollectionSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
