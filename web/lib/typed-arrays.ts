/**
 * Type-safe array extractors for DB records.
 *
 * When reading arrays from `Record<string, unknown>`, `Array.isArray()`
 * only narrows to `unknown[]`.  These helpers validate with the
 * corresponding Zod schema from `@oboapp/shared` so that callers
 * receive properly typed arrays.
 *
 * Return conventions:
 * - `categories` and `addresses` return `[]` when invalid (normalised for convenience;
 *    both are optional in the shared MessageSchema)
 * - Other array fields (`pins`, `streets`, etc.) return `undefined` when invalid
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
import { z } from "zod";

type ProcessStep = NonNullable<InternalMessage["process"]>[number];

/** Zod schema for an individual process step, extracted from InternalMessageSchema */
const ProcessStepSchema = InternalMessageSchema.shape.process.unwrap().element;

/* ---------- Required array fields (default: []) ---------- */

export function getCategories(value: unknown): Category[] {
  const result = z.array(CategoryEnum).safeParse(value);
  return result.success ? result.data : [];
}

export function getAddresses(value: unknown): Address[] {
  const result = z.array(AddressSchema).safeParse(value);
  return result.success ? result.data : [];
}

/* ---------- Optional array fields (default: undefined) ---------- */

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

export function getIngestErrors(value: unknown): IngestError[] | undefined {
  const result = z.array(IngestErrorSchema).safeParse(value);
  return result.success ? result.data : undefined;
}

export function getProcessSteps(value: unknown): ProcessStep[] | undefined {
  const result = z.array(ProcessStepSchema).safeParse(value);
  return result.success ? result.data : undefined;
}

export function getFeatureCollection(
  value: unknown,
): GeoJSONFeatureCollection | undefined {
  const result = GeoJsonFeatureCollectionSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
