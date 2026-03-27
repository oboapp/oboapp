import { isWithinBounds } from "@oboapp/shared";
import { getLocality } from "../../lib/target-locality";
import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";
import { logger } from "@/lib/logger";

const SCHOOLS_URL = "https://api.sofiaplan.bg/datasets/166";
const KINDERGARTENS_URL = "https://api.sofiaplan.bg/datasets/142";

export type FacilityType = "school" | "kindergarten";

export interface EducationalFacility {
  /** Compound document ID: "{type}-{facilityNumber}" */
  id: string;
  facilityNumber: string;
  name: string;
  address: string;
  type: FacilityType;
  lat: number;
  lng: number;
}

/**
 * Parse a facility number from a GeoJSON feature.
 * Prefers the explicit `object_nom` field; falls back to leading digits in `object_nam`.
 * Exported for unit testing.
 */
export function parseFacilityNumber(
  objectNom: unknown,
  objectNam: unknown,
): string | null {
  if (typeof objectNom === "number" && objectNom > 0) {
    return String(objectNom);
  }
  if (typeof objectNam === "string") {
    const match = objectNam.match(/^(\d+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch and parse a GeoJSON FeatureCollection from a URL.
 */
async function fetchFacilities(
  url: string,
  type: FacilityType,
): Promise<EducationalFacility[]> {
  logger.info("Fetching educational facilities", { url, type });

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${type} data: ${response.status} ${response.statusText}`,
    );
  }

  // response.json() returns any; we type the raw JSON result here
  // and rely on the runtime guards below before accessing its fields
  let geojson: Awaited<ReturnType<Response["json"]>>;
  try {
    geojson = await response.json();
  } catch (err) {
    throw new Error(
      `Failed to parse ${type} API response as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!geojson.features || !Array.isArray(geojson.features)) {
    throw new Error(`Invalid GeoJSON response for ${type}: missing features array`);
  }

  const locality = getLocality();
  const facilities: EducationalFacility[] = [];
  let skippedNoNumber = 0;
  let skippedNoCoords = 0;
  let skippedOutOfBounds = 0;

  for (const feature of geojson.features) {
    const props = feature.properties ?? {};

    const facilityNumber = parseFacilityNumber(props.object_nom, props.object_nam);
    if (!facilityNumber) {
      skippedNoNumber++;
      continue;
    }

    // Extract coordinates — geometry is Point or MultiPoint with [lng, lat]
    let lng: number | null = null;
    let lat: number | null = null;

    const geom = feature.geometry;
    if (geom?.type === "Point" && Array.isArray(geom.coordinates)) {
      const coords = geom.coordinates;
      if (coords.length >= 2) {
        lng = typeof coords[0] === "number" ? coords[0] : null;
        lat = typeof coords[1] === "number" ? coords[1] : null;
      }
    } else if (
      geom?.type === "MultiPoint" &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0
    ) {
      const first = geom.coordinates[0];
      if (Array.isArray(first) && first.length >= 2) {
        lng = typeof first[0] === "number" ? first[0] : null;
        lat = typeof first[1] === "number" ? first[1] : null;
      }
    }

    if (
      lng === null ||
      lat === null ||
      Number.isNaN(lng) ||
      Number.isNaN(lat) ||
      !isFinite(lat) ||
      !isFinite(lng)
    ) {
      skippedNoCoords++;
      continue;
    }

    if (!isWithinBounds(locality, lat, lng)) {
      skippedOutOfBounds++;
      continue;
    }

    facilities.push({
      id: `${type}-${facilityNumber}`,
      facilityNumber,
      name: typeof props.object_nam === "string" ? props.object_nam : facilityNumber,
      address: typeof props.adres === "string" ? props.adres : "",
      type,
      lat: roundCoordinate(lat),
      lng: roundCoordinate(lng),
    });
  }

  logger.info("Parsed educational facilities", {
    type,
    total: geojson.features.length,
    parsed: facilities.length,
    skippedNoNumber,
    skippedNoCoords,
    skippedOutOfBounds,
  });

  return facilities;
}

/**
 * Sync schools and kindergartens from Sofia open data to the educationalFacilities collection.
 */
export async function syncEducationalFacilities(): Promise<void> {
  const [schoolsResult, kindergartensResult] = await Promise.allSettled([
    fetchFacilities(SCHOOLS_URL, "school"),
    fetchFacilities(KINDERGARTENS_URL, "kindergarten"),
  ]);

  const schools =
    schoolsResult.status === "fulfilled"
      ? schoolsResult.value
      : (logger.warn("Failed to fetch schools, skipping", {
          error:
            schoolsResult.reason instanceof Error
              ? schoolsResult.reason.message
              : String(schoolsResult.reason),
        }),
        []);

  const kindergartens =
    kindergartensResult.status === "fulfilled"
      ? kindergartensResult.value
      : (logger.warn("Failed to fetch kindergartens, skipping", {
          error:
            kindergartensResult.reason instanceof Error
              ? kindergartensResult.reason.message
              : String(kindergartensResult.reason),
        }),
        []);

  const all = [...schools, ...kindergartens];

  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  const batch = all.map((facility) => ({
    id: facility.id,
    data: {
      facilityNumber: facility.facilityNumber,
      name: facility.name,
      address: facility.address,
      type: facility.type,
      coordinates: {
        latitude: facility.lat,
        longitude: facility.lng,
      },
      lastUpdated: new Date(),
    },
  }));

  await db.educationalFacilities.upsertBatch(batch);

  logger.info("Educational facilities sync complete", {
    schools: schools.length,
    kindergartens: kindergartens.length,
    total: all.length,
  });
}
