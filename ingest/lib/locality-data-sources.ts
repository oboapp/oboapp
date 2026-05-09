import { z } from "zod";

import { GEOCODING_RESOLVERS } from "@oboapp/shared";

const LocalityDataSourcesSchema = z.object({
  "geocoding-resolvers": z.object({
    pins: z.discriminatedUnion("provider", [
      z.object({ provider: z.literal("google") }),
      z.object({ provider: z.literal("overpass") }),
    ]),
    streets: z.discriminatedUnion("provider", [
      z.object({ provider: z.literal("overpass") }),
      z.object({ provider: z.literal("google") }),
    ]),
    "cadastral-properties": z.discriminatedUnion("provider", [
      z.object({ provider: z.literal("cadastre") }),
      z.object({ provider: z.literal("skip") }),
    ]),
    "bus-stops": z.discriminatedUnion("provider", [
      z.object({ provider: z.literal("gtfs"), url: z.string().url() }),
      z.object({ provider: z.literal("google") }),
      z.object({ provider: z.literal("overpass") }),
      z.object({ provider: z.literal("skip") }),
    ]),
    "educational-facilities": z.discriminatedUnion("provider", [
      z.object({
        provider: z.literal("educational-facilities"),
        "schools-url": z.string().url(),
        "kindergartens-url": z.string().url(),
      }),
      z.object({ provider: z.literal("google") }),
      z.object({ provider: z.literal("skip") }),
    ]),
  }),
});

export type LocalityDataSources = z.infer<typeof LocalityDataSourcesSchema>;

export type GeocodingResolvers = LocalityDataSources["geocoding-resolvers"];

let cachedSources: LocalityDataSources | null = null;

function loadLocalityDataSources(): LocalityDataSources {
  // Load geocoding resolver config from shared (single-locality per deployment).
  // The "locality" aspect is determined by which deployment this runs in — fork operators
  // replace shared/src/geocoding-sources.ts with their city's configuration.
  const result = LocalityDataSourcesSchema.safeParse({
    "geocoding-resolvers": GEOCODING_RESOLVERS,
  });
  if (!result.success) {
    throw new Error(
      `Invalid GEOCODING_RESOLVERS export from @oboapp/shared: ${result.error.message}`,
    );
  }

  return result.data;
}

/**
 * Returns the locality data sources config for the current locality.
 * Throws if the file is absent or the schema is invalid — fail-fast at startup.
 */
export function getLocalityDataSources(): LocalityDataSources {
  if (!cachedSources) {
    cachedSources = loadLocalityDataSources();
  }
  return cachedSources;
}
