import { z } from "../zod-openapi";
import { CategoryEnum } from "./category.schema";
import { CadastralPropertySchema, EducationalFacilityRefSchema } from "./extracted-data.schema";
import { GeoJsonFeatureCollectionSchema } from "./geojson.schema";
import { PinSchema } from "./pin.schema";
import { StreetSectionSchema } from "./street-section.schema";

/**
 * EventSchema — represents a real-world incident aggregated from one or more messages.
 * Used by backend processing and future public APIs.
 *
 * DESIGN PRINCIPLE: Canonical public-facing fields (plainText, markdownText, geoJson,
 * categories, timespanStart/End, cityWide, locality, embedding, etc.) intentionally use
 * the same names and types as MessageSchema. This minimises divergence so that the map
 * and public API can switch from exposing messages to exposing events with minimal
 * migration effort. EventSchema also carries aggregation-only fields (sources,
 * messageCount, geometryQuality, confidence, updatedAt) that have no counterpart in
 * MessageSchema — so it is NOT a drop-in schema replacement.
 * Keep shared field names consistent with MessageSchema when adding new fields.
 */
export const EventSchema = z.object({
  id: z.string().optional(),
  /**
   * Canonical normalized text for the event. Required on events (unlike MessageSchema
   * where it's optional) because events are always created from processed messages.
   *
   * NOTE: MessageSchema.text is a transient ingestion field (raw crawler/user input)
   * not intended for public display. Events intentionally omit it — plainText is the
   * correct public-facing text field for both messages and events.
   */
  plainText: z.string(),
  markdownText: z.string().optional(),
  geoJson: GeoJsonFeatureCollectionSchema.optional(),
  geometryQuality: z.number().int().min(0).max(3),
  timespanStart: z.string().optional(),
  timespanEnd: z.string().optional(),
  categories: z.array(CategoryEnum).optional(),
  pins: z.array(PinSchema).optional(),
  streets: z.array(StreetSectionSchema).optional(),
  cadastralProperties: z.array(CadastralPropertySchema).optional(),
  busStops: z.array(z.string()).optional(),
  educationalFacilities: z.array(EducationalFacilityRefSchema).optional(),
  sources: z.array(z.string()),
  messageCount: z.number().int().min(1),
  confidence: z.number().min(0).max(1),
  locality: z.string(),
  cityWide: z.boolean().optional(),
  embedding: z.array(z.number().finite()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Event = z.infer<typeof EventSchema>;
