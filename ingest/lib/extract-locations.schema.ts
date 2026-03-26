import { z } from "zod";
import { PinSchema, StreetSectionSchema, CadastralPropertySchema, EducationalFacilityRefSchema } from "@oboapp/shared";

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
