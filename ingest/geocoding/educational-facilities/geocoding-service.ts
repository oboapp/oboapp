import type { EducationalFacilityRef } from "@oboapp/shared";
import type { Address } from "../../lib/types";
import { logger } from "@/lib/logger";

export const EDUCATIONAL_FACILITY_PREFIX = "Учебно заведение ";

interface FacilityGeometry {
  name: string;
  lat: number;
  lng: number;
}

/**
 * Look up a single educational facility by type and number.
 */
async function lookupFacility(
  type: EducationalFacilityRef["type"],
  number: string,
): Promise<FacilityGeometry | null> {
  try {
    const { getDb } = await import("@/lib/db");
    const db = await getDb();

    const doc = await db.educationalFacilities.findById(`${type}-${number}`);
    if (!doc) {
      logger.warn("Educational facility not found", { type, number });
      return null;
    }

    const coordsObj =
      typeof doc.coordinates === "object" && doc.coordinates !== null
        ? doc.coordinates
        : null;
    if (!coordsObj) {
      logger.warn("Educational facility missing coordinates", { type, number });
      return null;
    }
    const coords = Object.fromEntries(Object.entries(coordsObj));
    if (
      typeof coords.latitude !== "number" ||
      typeof coords.longitude !== "number"
    ) {
      logger.warn("Educational facility has invalid coordinates", {
        type,
        number,
        coordinates: coords,
      });
      return null;
    }

    return {
      name: typeof doc.name === "string" ? doc.name : number,
      lat: coords.latitude,
      lng: coords.longitude,
    };
  } catch (error) {
    logger.error("Failed to geocode educational facility", {
      type,
      number,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Geocode multiple educational facilities and return as Address array.
 * No rate limiting needed — local database.
 */
export async function geocodeEducationalFacilities(
  facilities: EducationalFacilityRef[],
): Promise<Address[]> {
  const addresses: Address[] = [];

  for (const { type, number } of facilities) {
    const geometry = await lookupFacility(type, number);
    if (geometry) {
      addresses.push({
        originalText: `${EDUCATIONAL_FACILITY_PREFIX}${number}`,
        formattedAddress: `${geometry.name} (${number})`,
        coordinates: {
          lat: geometry.lat,
          lng: geometry.lng,
        },
        geoJson: {
          type: "Point",
          coordinates: [geometry.lng, geometry.lat],
        },
      });
      logger.info("Geocoded educational facility", {
        type,
        number,
        name: geometry.name,
      });
    }
  }

  return addresses;
}
