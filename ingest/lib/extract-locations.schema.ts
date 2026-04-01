import { z } from "zod";
import {
  PinSchema,
  StreetSectionSchema,
  CadastralPropertySchema,
  EducationalFacilityRefSchema,
} from "@oboapp/shared";

const ExtractedLocationsSchema = z.object({
  withSpecificAddress: z.boolean().default(false),
  busStops: z.array(z.string()).default([]),
  educationalFacilities: z.array(EducationalFacilityRefSchema).default([]),
  cityWide: z.boolean().default(false),
  pins: z.array(PinSchema).default([]),
  streets: z.array(StreetSectionSchema).default([]),
  cadastralProperties: z.array(CadastralPropertySchema).default([]),
});

export { ExtractedLocationsSchema };

export type ExtractedLocations = z.infer<typeof ExtractedLocationsSchema>;

const timespanJsonSchema = {
  type: "object",
  properties: {
    start: { type: "string" },
    end: { type: "string" },
  },
  required: ["start"],
} as const;

const coordinatesJsonSchema = {
  type: "object",
  properties: {
    lat: { type: "number" },
    lng: { type: "number" },
  },
  required: ["lat", "lng"],
} as const;

export const EXTRACT_LOCATIONS_JSON_SCHEMA = {
  type: "object",
  properties: {
    withSpecificAddress: { type: "boolean" },
    cityWide: { type: "boolean" },
    busStops: {
      type: "array",
      items: { type: "string" },
    },
    educationalFacilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["school", "kindergarten"] },
          number: { type: "string" },
        },
        required: ["type", "number"],
      },
    },
    pins: {
      type: "array",
      items: {
        type: "object",
        properties: {
          address: { type: "string" },
          coordinates: coordinatesJsonSchema,
          timespans: { type: "array", items: timespanJsonSchema },
        },
        required: ["address", "timespans"],
      },
    },
    streets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          street: { type: "string" },
          from: { type: "string" },
          fromCoordinates: coordinatesJsonSchema,
          to: { type: "string" },
          toCoordinates: coordinatesJsonSchema,
          timespans: { type: "array", items: timespanJsonSchema },
        },
        required: ["street", "from", "to", "timespans"],
      },
    },
    cadastralProperties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          identifier: { type: "string" },
          timespans: { type: "array", items: timespanJsonSchema },
        },
        required: ["identifier", "timespans"],
      },
    },
  },
  required: ["withSpecificAddress", "cityWide"],
} as const;
