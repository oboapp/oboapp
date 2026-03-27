import type { EducationalFacilityRef } from "@oboapp/shared";
import type { Address } from "../../lib/types";
import type { IngestErrorRecorder } from "@/lib/ingest-errors";
import { logger } from "@/lib/logger";
import { EDUCATIONAL_FACILITY_PREFIX } from "@/lib/constants";

interface FacilityGeometry {
  name: string;
  lat: number;
  lng: number;
}

/**
 * Geocode multiple educational facilities and return as Address array.
 * No rate limiting needed — local database.
 */
export async function geocodeEducationalFacilities(
  facilities: EducationalFacilityRef[],
  ingestErrors?: IngestErrorRecorder,
): Promise<Address[]> {
  const addresses: Address[] = [];

  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  for (const { type, number } of facilities) {
    let geometry: FacilityGeometry | null = null;

    try {
      const doc = await db.educationalFacilities.findById(`${type}-${number}`);
      if (!doc) {
        logger.warn("Educational facility not found", { type, number });
        ingestErrors?.warn(
          `⚠️  Educational facility not found: ${type} ${number}`,
        );
      } else {
        const coordsObj =
          typeof doc.coordinates === "object" && doc.coordinates !== null
            ? doc.coordinates
            : null;
        if (!coordsObj) {
          logger.warn("Educational facility missing coordinates", {
            type,
            number,
          });
          ingestErrors?.warn(
            `⚠️  Educational facility missing coordinates: ${type} ${number}`,
          );
        } else {
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
            ingestErrors?.warn(
              `⚠️  Educational facility has invalid coordinates: ${type} ${number}`,
            );
          } else {
            geometry = {
              name: typeof doc.name === "string" ? doc.name : number,
              lat: coords.latitude,
              lng: coords.longitude,
            };
          }
        }
      }
    } catch (error) {
      logger.error("Failed to geocode educational facility", {
        type,
        number,
        error: error instanceof Error ? error.message : String(error),
      });
      ingestErrors?.exception(
        `Failed to geocode educational facility: ${type} ${number} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (geometry) {
      addresses.push({
        originalText: `${EDUCATIONAL_FACILITY_PREFIX}${type}:${number}`,
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

  logger.info("Educational facilities geocoding complete", {
    total: facilities.length,
    geocoded: addresses.length,
    failed: facilities.length - addresses.length,
  });

  return addresses;
}
