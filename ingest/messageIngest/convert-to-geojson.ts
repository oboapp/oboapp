import { convertToGeoJSON } from "@/geocoding/shared/geojson-service";
import {
  ExtractedLocations,
  GeoJSONFeatureCollection,
  GeoJSONFeature,
  Address,
  Coordinates,
} from "@/lib/types";
import { validateAndFixGeoJSON } from "../crawlers/shared/geojson-validation";
import type { CadastralGeometry } from "@/geocoding/cadastre/service";
import {
  getIngestErrorRecorder,
  type IngestErrorRecorder,
} from "@/lib/ingest-errors";
import { EDUCATIONAL_FACILITY_PREFIX } from "@/lib/constants";

/**
 * Helper: Validate that all pin addresses and street endpoints have been geocoded
 * (does not validate bus stops, educational facilities, or cadastral properties)
 * Exported for unit testing
 */
export function validatePinsAndStreetsGeocoded(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
): string[] {
  const missingAddresses: string[] = [];

  extractedData.pins.forEach((pin) => {
    if (!preGeocodedMap.has(pin.address)) {
      missingAddresses.push(pin.address);
    }
  });

  extractedData.streets.forEach((street) => {
    if (!preGeocodedMap.has(street.from)) {
      missingAddresses.push(`${street.street} from: ${street.from}`);
    }
    if (!preGeocodedMap.has(street.to)) {
      missingAddresses.push(`${street.street} to: ${street.to}`);
    }
  });

  return missingAddresses;
}

/**
 * Step 6: Convert geocoded data to GeoJSON
 * Pure function that creates GeoJSON from extracted data and coordinates
 */
export async function convertMessageGeocodingToGeoJson(
  extractedData: ExtractedLocations | null,
  preGeocodedMap: Map<string, Coordinates>,
  cadastralGeometries?: Map<string, CadastralGeometry>,
  geocodedBusStops?: Address[],
  ingestErrors?: IngestErrorRecorder,
  geocodedEducationalFacilities?: Address[],
): Promise<GeoJSONFeatureCollection | null> {
  const recorder = getIngestErrorRecorder(ingestErrors);
  if (!extractedData) {
    return null;
  }

  // Validate that all required addresses have been geocoded
  const missingAddresses = validatePinsAndStreetsGeocoded(
    extractedData,
    preGeocodedMap,
  );

  // Filter out features with missing geocoding
  const filteredData: ExtractedLocations = {
    ...extractedData,
    pins: extractedData.pins.filter((pin) => preGeocodedMap.has(pin.address)),
    streets: extractedData.streets.filter(
      (street) =>
        preGeocodedMap.has(street.from) && preGeocodedMap.has(street.to),
    ),
  };

  // Track missing bus stops
  const missingBusStops: string[] = [];
  if (extractedData.busStops && extractedData.busStops.length > 0) {
    const geocodedStopCodes = new Set(
      (geocodedBusStops ?? []).map((stop) =>
        stop.originalText.replace("Спирка ", ""),
      ),
    );
    for (const stopCode of extractedData.busStops) {
      if (!geocodedStopCodes.has(stopCode)) {
        missingBusStops.push(`Спирка ${stopCode}`);
      }
    }
  }

  // Track missing educational facilities
  const missingFacilities: string[] = [];
  if (
    extractedData.educationalFacilities &&
    extractedData.educationalFacilities.length > 0
  ) {
    const geocodedFacilityKeys = new Set(
      (geocodedEducationalFacilities ?? []).map((f) =>
        f.originalText.replace(EDUCATIONAL_FACILITY_PREFIX, ""),
      ),
    );
    for (const facility of extractedData.educationalFacilities) {
      const key = `${facility.type}:${facility.number}`;
      if (!geocodedFacilityKeys.has(key)) {
        missingFacilities.push(
          `${EDUCATIONAL_FACILITY_PREFIX}${facility.type}:${facility.number}`,
        );
      }
    }
  }

  // Track missing cadastral properties
  const missingCadastral: string[] = [];
  if (extractedData.cadastralProperties && extractedData.cadastralProperties.length > 0) {
    for (const prop of extractedData.cadastralProperties) {
      if (!cadastralGeometries || !cadastralGeometries.has(prop.identifier)) {
        missingCadastral.push(`УПИ ${prop.identifier}`);
      }
    }
  }

  const allMissing = [
    ...missingAddresses,
    ...missingBusStops,
    ...missingFacilities,
    ...missingCadastral,
  ];

  // Check if we have ANY features to display
  const hasFeatures =
    filteredData.pins.length > 0 ||
    filteredData.streets.length > 0 ||
    (cadastralGeometries && cadastralGeometries.size > 0) ||
    (geocodedBusStops && geocodedBusStops.length > 0) ||
    (geocodedEducationalFacilities && geocodedEducationalFacilities.length > 0);

  if (!hasFeatures) {
    const detail =
      allMissing.length > 0
        ? `Failed to geocode all locations: ${allMissing.join(", ")}`
        : "No geocodable locations found in extracted data";
    recorder.error(`❌ ${detail}`);
    throw new Error(detail);
  }

  // Log partial failures as warnings
  if (allMissing.length > 0) {
    const shownParts = [
      filteredData.pins.length > 0 && `${filteredData.pins.length} pins`,
      filteredData.streets.length > 0 && `${filteredData.streets.length} streets`,
      geocodedBusStops && geocodedBusStops.length > 0 && `${geocodedBusStops.length} bus stops`,
      geocodedEducationalFacilities && geocodedEducationalFacilities.length > 0 && `${geocodedEducationalFacilities.length} facilities`,
      cadastralGeometries && cadastralGeometries.size > 0 && `${cadastralGeometries.size} cadastral`,
    ].filter(Boolean).join(" + ");
    recorder.warn(
      `⚠️  Partial geocoding: ${allMissing.length} locations failed (showing ${shownParts}): ${allMissing.join(", ")}`,
    );
  }

  const geoJson = await convertToGeoJSON(filteredData, preGeocodedMap);

  // Add cadastral property features
  if (
    cadastralGeometries &&
    cadastralGeometries.size > 0 &&
    extractedData.cadastralProperties
  ) {
    const cadastralFeatures: GeoJSONFeature[] = [];

    for (const cadastralProp of extractedData.cadastralProperties) {
      const geometry = cadastralGeometries.get(cadastralProp.identifier);

      if (geometry) {
        cadastralFeatures.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: geometry.polygon,
          },
          properties: {
            feature_type: "cadastral_property",
            locationType: "cadastral_property",
            identifier: cadastralProp.identifier,
            start_time: cadastralProp.timespans[0]?.start || "",
            end_time: cadastralProp.timespans[0]?.end || "",
            timespans: JSON.stringify(cadastralProp.timespans),
          },
        });
      } else {
        recorder.warn(
          `⚠️  Cadastral property ${cadastralProp.identifier} failed to geocode`,
        );
      }
    }

    if (cadastralFeatures.length > 0) {
      if (geoJson) {
        geoJson.features.push(...cadastralFeatures);
      } else {
        // Only cadastral features
        return {
          type: "FeatureCollection",
          features: cadastralFeatures,
        };
      }
    }
  }

  // Add bus stop features
  if (geocodedBusStops && geocodedBusStops.length > 0) {
    const busStopFeatures: GeoJSONFeature[] = geocodedBusStops.map((stop) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [stop.coordinates.lng, stop.coordinates.lat],
      },
      properties: {
        feature_type: "bus_stop",
        locationType: "bus_stop",
        stop_code: stop.originalText.replace("Спирка ", ""),
        stop_name: stop.formattedAddress,
      },
    }));

    if (geoJson) {
      geoJson.features.push(...busStopFeatures);
    } else {
      // Only bus stop features
      return {
        type: "FeatureCollection",
        features: busStopFeatures,
      };
    }
  }

  // Add educational facility features
  if (geocodedEducationalFacilities && geocodedEducationalFacilities.length > 0) {
    const facilityFeatures: GeoJSONFeature[] = geocodedEducationalFacilities.map(
      (facility) => {
        // originalText format: "Учебно заведение {type}:{number}"
        const typeAndNumber = facility.originalText.replace(
          EDUCATIONAL_FACILITY_PREFIX,
          "",
        );
        const colonIdx = typeAndNumber.indexOf(":");
        const facilityType =
          colonIdx !== -1 ? typeAndNumber.slice(0, colonIdx) : "";
        const facilityNumber =
          colonIdx !== -1 ? typeAndNumber.slice(colonIdx + 1) : typeAndNumber;

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [facility.coordinates.lng, facility.coordinates.lat],
          },
          properties: {
            feature_type: "educational_facility",
            locationType: "educational_facility",
            facility_type: facilityType,
            facility_number: facilityNumber,
            facility_name: facility.formattedAddress,
          },
        };
      },
    );

    if (geoJson) {
      geoJson.features.push(...facilityFeatures);
    } else {
      // Only educational facility features
      return {
        type: "FeatureCollection",
        features: facilityFeatures,
      };
    }
  }

  // Validate the generated geoJson
  if (geoJson) {
    const validation = validateAndFixGeoJSON(geoJson, "AI-generated");

    if (!validation.isValid || !validation.geoJson) {
      recorder.error("Invalid GeoJSON generated from AI extraction:");
      validation.errors.forEach((err) => recorder.error(`  ${err}`));
      throw new Error("Generated GeoJSON is invalid");
    }

    if (validation.warnings.length > 0) {
      recorder.warn("Fixed GeoJSON from AI extraction:");
      validation.warnings.forEach((warn) => recorder.warn(`  ${warn}`));
    }

    return validation.geoJson;
  }

  return geoJson;
}
