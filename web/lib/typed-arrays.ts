/**
 * Type-safe array extractors for DB records.
 *
 * When reading arrays from `Record<string, unknown>`, `Array.isArray()`
 * only narrows to `unknown[]`.  These helpers validate each element with
 * the corresponding Zod schema from `@oboapp/shared` so that callers
 * receive properly typed arrays.
 */
import {
  AddressSchema,
  CategoryEnum,
  IngestErrorSchema,
  InternalMessageSchema,
  PinSchema,
  StreetSectionSchema,
  CadastralPropertySchema,
  GeoJsonFeatureCollectionSchema,
} from "@oboapp/shared";
import type {
  Address,
  GeoJSONFeatureCollection,
  Pin,
  StreetSection,
  CadastralProperty,
} from "@/lib/types";
import type { Category, IngestError, InternalMessage } from "@oboapp/shared";

type ProcessStep = NonNullable<InternalMessage["process"]>[number];

/** Zod schema for an individual process step, extracted from InternalMessageSchema */
const ProcessStepSchema = InternalMessageSchema.shape.process.unwrap().element;

export function getCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Category => CategoryEnum.safeParse(item).success,
  );
}

export function getAddresses(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Address => AddressSchema.safeParse(item).success,
  );
}

export function getPins(value: unknown): Pin[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is Pin => PinSchema.safeParse(item).success,
  );
}

export function getStreets(value: unknown): StreetSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is StreetSection =>
      StreetSectionSchema.safeParse(item).success,
  );
}

export function getCadastralProperties(
  value: unknown,
): CadastralProperty[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is CadastralProperty =>
      CadastralPropertySchema.safeParse(item).success,
  );
}

export function getBusStops(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export function getIngestErrors(value: unknown): IngestError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is IngestError => IngestErrorSchema.safeParse(item).success,
  );
}

export function getProcessSteps(value: unknown): ProcessStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is ProcessStep => ProcessStepSchema.safeParse(item).success,
  );
}

export function getFeatureCollection(
  value: unknown,
): GeoJSONFeatureCollection | undefined {
  const result = GeoJsonFeatureCollectionSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
