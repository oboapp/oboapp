import { z } from "zod";
import {
  CoordinatesSchema,
  CadastralPropertySchema,
  EducationalFacilityRefSchema,
} from "@oboapp/shared";

// Lenient timespan schema for LLM responses — accepts null start gracefully.
// The canonical TimespanSchema in @oboapp/shared keeps start non-nullable
// to preserve the public API contract.
const LlmTimespanSchema = z.object({
  start: z.string().catch(""),
  end: z.string().nullable(),
});

const LlmPinSchema = z.object({
  address: z.string(),
  coordinates: CoordinatesSchema.optional(),
  timespans: z.array(LlmTimespanSchema),
});

const LlmStreetSectionSchema = z.object({
  street: z.string(),
  from: z.string(),
  fromCoordinates: CoordinatesSchema.optional().catch(undefined),
  to: z.string(),
  toCoordinates: CoordinatesSchema.optional().catch(undefined),
  timespans: z.array(LlmTimespanSchema),
});

const ExtractedLocationsSchema = z.object({
  withSpecificAddress: z.boolean().default(false),
  busStops: z.array(z.string()).default([]),
  educationalFacilities: z.array(EducationalFacilityRefSchema).default([]),
  cityWide: z.boolean().default(false),
  pins: z.array(LlmPinSchema).default([]),
  streets: z.array(LlmStreetSectionSchema).default([]),
  cadastralProperties: z.array(CadastralPropertySchema).default([]),
});

export { ExtractedLocationsSchema };

export type ExtractedLocations = z.infer<typeof ExtractedLocationsSchema>;

export const EXTRACT_LOCATIONS_JSON_SCHEMA =
  ExtractedLocationsSchema.toJSONSchema();
