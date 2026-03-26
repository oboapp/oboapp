import { z } from "../zod-openapi";
import { AddressSchema } from "./address.schema";
import { CategoryEnum } from "./category.schema";
import { CadastralPropertySchema, EducationalFacilityRefSchema } from "./extracted-data.schema";
import { GeoJsonFeatureCollectionSchema } from "./geojson.schema";
import { IngestErrorSchema } from "./ingest-error.schema";
import { PinSchema } from "./pin.schema";
import { StreetSectionSchema } from "./street-section.schema";

/**
 * Public MessageSchema - exposes only validated, controlled fields
 * Used by public APIs (YSM API) and frontend components
 */
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
  educationalFacilities: z.array(EducationalFacilityRefSchema).optional(),
  locality: z.string(),
});

export type Message = z.infer<typeof MessageSchema>;

// Seed script pattern: stores full result data
const ProcessStepWithResultSchema = z.object({
  step: z.string(),
  result: z.any(),
});

// Audit pattern: stores minimal metadata for process tracking
const ProcessStepWithAuditSchema = z.object({
  step: z.string(),
  timestamp: z.string(),
  summary: z.any(),
});

// Union type for both patterns
const ProcessStepSchema = z.union([
  ProcessStepWithResultSchema,
  ProcessStepWithAuditSchema,
]);

/**
 * InternalMessageSchema - extends MessageSchema with internal-only fields
 * Used by backend processing pipeline and admin features
 */
export const InternalMessageSchema = MessageSchema.extend({
  process: z.array(ProcessStepSchema).optional(),
  ingestErrors: z.array(IngestErrorSchema).optional(),
  sourceDocumentId: z.string().optional(),
  isRelevant: z.boolean().optional(),
  isUnreadable: z.boolean().optional(),
  eventId: z.string().optional(),
  embedding: z.array(z.number().finite()).optional(),
});

export type InternalMessage = z.infer<typeof InternalMessageSchema>;
