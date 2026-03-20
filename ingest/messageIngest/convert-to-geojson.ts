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

/**
 * Helper: Validate that all addresses have been geocoded
 * Exported for unit testing
 */
export function validateAllAddressesGeocoded(
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
): Promise<GeoJSONFeatureCollection | null> {
  const recorder = getIngestErrorRecorder(ingestErrors);
  if (!extractedData) {
    return null;
  }

  // Validate that all required addresses have been geocoded
  const missingAddresses = validateAllAddressesGeocoded(
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

  // Check if we have ANY features to display
  const hasFeatures =
    filteredData.pins.length > 0 ||
    filteredData.streets.length > 0 ||
    (cadastralGeometries && cadastralGeometries.size > 0) ||
    (geocodedBusStops && geocodedBusStops.length > 0);

  if (!hasFeatures) {
    recorder.error(
      `❌ No geocoded features available (all ${missingAddresses.length} addresses failed)`,
    );
    throw new Error(
      `Failed to geocode all addresses: ${missingAddresses.join(", ")}`,
    );
  }

  // Log partial failures as warnings
  if (missingAddresses.length > 0) {
    recorder.warn(
      `⚠️  Partial geocoding: ${missingAddresses.length} addresses failed (showing ${filteredData.pins.length} pins + ${filteredData.streets.length} streets): ${missingAddresses.join(
        ", ",
      )}`,
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
