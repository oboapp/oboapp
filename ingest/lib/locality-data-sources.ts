import { readFileSync } from "node:fs";
import { join } from "node:path";

import { load as parseYaml } from "js-yaml";
import { z } from "zod";

import { validateLocality } from "@oboapp/shared";
import { hasCode } from "@/lib/record-fields";
import { getLocality } from "@/lib/target-locality";

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
  const locality = getLocality();
  validateLocality(locality);
  const filePath = join(process.cwd(), "localities", `${locality}.yaml`);

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (error: unknown) {
    if (hasCode(error) && error.code === "ENOENT") {
      throw new Error(
        `Locality data sources file not found for "${locality}": ${filePath}. ` +
          `Create localities/${locality}.yaml to configure geocoding resolvers.`,
        { cause: error },
      );
    }

    throw new Error(
      `Unable to read locality data sources file for "${locality}": ${filePath}.`,
      { cause: error },
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error: unknown) {
    throw new Error(
      `Invalid YAML in locality data sources file for "${locality}": ${filePath}.`,
      { cause: error },
    );
  }

  const result = LocalityDataSourcesSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid locality data sources file for "${locality}": ${filePath}. ${result.error.message}`,
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
