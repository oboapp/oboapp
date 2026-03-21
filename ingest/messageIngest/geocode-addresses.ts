import {
  geocodeAddresses,
  geocodeIntersectionsForStreets,
  geocodeCadastralPropertiesFromIdentifiers,
  geocodeBusStops,
} from "@/geocoding/router";
import { overpassGeocodeAddresses } from "@/geocoding/overpass/service";
import {
  Address,
  ExtractedLocations,
  StreetSection,
  Coordinates,
} from "@/lib/types";
import type { CadastralGeometry } from "@/geocoding/cadastre/service";
import { logger } from "@/lib/logger";
import { isWithinBounds } from "@oboapp/shared";
import { getLocality } from "@/lib/target-locality";
import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";

// Internal types for the geocoding pipeline
export interface GeocodingResult {
  preGeocodedMap: Map<string, Coordinates>;
  addresses: Address[];
  cadastralGeometries?: Map<string, CadastralGeometry>;
}

/**
 * Validate and normalize geotagged coordinates from source.
 * Some sources practice geotagging — embedding coordinates directly in messages.
 * - Rounds to 6 decimal places (precision ~0.1 meters)
 * - Validates coordinates are within target locality bounds
 * Returns null if coordinates are invalid
 * Exported for unit testing
 */
export function getValidPreResolvedCoordinates(
  coordinates: Coordinates,
  context: string,
): Coordinates | null {
  // Round to 6 decimal places (precision ~0.1 meters at Sofia's latitude)
  const rounded: Coordinates = {
    lat: roundCoordinate(coordinates.lat),
    lng: roundCoordinate(coordinates.lng),
  };

  // Validate coordinates are within target locality bounds
  const locality = getLocality();
  if (!isWithinBounds(locality, rounded.lat, rounded.lng)) {
    logger.warn("Geotagged coordinates outside locality bounds", {
      context,
      locality,
      original: coordinates,
      rounded,
    });
    return null;
  }

  return rounded;
}

/**
 * Helper: Deduplicate addresses by normalized text or close coordinates
 * Exported for unit testing
 */
export function deduplicateAddresses(addresses: Address[]): Address[] {
  const seen = new Map<string, Address>();
  const DISTANCE_THRESHOLD_METERS = 50;

  for (const addr of addresses) {
    const plainText = addr.originalText.toLowerCase().trim();

    // Check if we've seen this exact text
    if (seen.has(plainText)) {
      continue;
    }

    // Check if any existing address is within distance threshold
    let isDuplicate = false;
    for (const existing of seen.values()) {
      const dist = haversineDistance(
        addr.coordinates.lat,
        addr.coordinates.lng,
        existing.coordinates.lat,
        existing.coordinates.lng,
      );
      if (dist < DISTANCE_THRESHOLD_METERS) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(plainText, addr);
    }
  }

  return Array.from(seen.values());
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Helper: Find missing street endpoints that haven't been geocoded
 * Exported for unit testing
 */
export function findMissingStreetEndpoints(
  streets: StreetSection[],
  geocodedMap: Map<string, Coordinates>,
): string[] {
  const missing: string[] = [];

  streets.forEach((street) => {
    if (!geocodedMap.has(street.from)) {
      missing.push(street.from);
    }
    if (!geocodedMap.has(street.to)) {
      missing.push(street.to);
    }
  });

  return missing;
}

/**
 * Helper: Create an Address object from validated coordinates
 * Exported for unit testing
 */
export function createAddressFromCoordinates(
  text: string,
  coordinates: Coordinates,
): Address {
  return {
    originalText: text,
    formattedAddress: text,
    coordinates,
    geoJson: {
      type: "Point",
      coordinates: [coordinates.lng, coordinates.lat],
    },
  };
}

/**
 * Helper: Process pins with geotagged coordinates
 * Returns addresses that need geocoding and adds validated coordinates to the map
 */
function processPinsWithPreResolvedCoordinates(
  pins: Array<{
    address: string;
    coordinates?: Coordinates;
    timespans: Array<{ start: string; end: string | null }>;
  }>,
  preGeocodedMap: Map<string, Coordinates>,
  addresses: Address[],
): string[] {
  const pinsToGeocode: string[] = [];

  for (const pin of pins) {
    if (pin.coordinates) {
      const validatedCoords = getValidPreResolvedCoordinates(
        pin.coordinates,
        `pin: ${pin.address}`,
      );

      if (validatedCoords) {
        preGeocodedMap.set(pin.address, validatedCoords);
        addresses.push(
          createAddressFromCoordinates(pin.address, validatedCoords),
        );
      } else {
        logger.warn("Invalid geotagged coordinates for pin, will geocode", {
          address: pin.address,
          coordinates: pin.coordinates,
        });
        pinsToGeocode.push(pin.address);
      }
    } else {
      pinsToGeocode.push(pin.address);
    }
  }

  return pinsToGeocode;
}

/**
 * Helper: Geocode pins using Google API
 */
async function geocodePins(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  addresses: Address[],
): Promise<void> {
  if (extractedData.pins.length === 0) return;

  const pinsToGeocode = processPinsWithPreResolvedCoordinates(
    extractedData.pins,
    preGeocodedMap,
    addresses,
  );

  if (pinsToGeocode.length > 0) {
    const geocodedPins = await geocodeAddresses(pinsToGeocode);
    addresses.push(...geocodedPins);

    geocodedPins.forEach((addr) => {
      preGeocodedMap.set(addr.originalText, addr.coordinates);
    });
  }
}

/**
 * Helper: Process a single street endpoint with geotagged coordinates
 */
function processStreetEndpoint(
  street: StreetSection,
  endpointName: string,
  endpointCoordinates: Coordinates,
  direction: "from" | "to",
  preGeocodedMap: Map<string, Coordinates>,
  addresses: Address[],
): void {
  const validatedCoords = getValidPreResolvedCoordinates(
    endpointCoordinates,
    `street endpoint: ${street.street} ${direction} ${endpointName}`,
  );

  if (validatedCoords) {
    preGeocodedMap.set(endpointName, validatedCoords);
    addresses.push(createAddressFromCoordinates(endpointName, validatedCoords));
  } else {
    logger.warn(
      "Invalid geotagged coordinates for street endpoint, will geocode",
      {
        street: street.street,
        endpoint: endpointName,
        coordinates: endpointCoordinates,
      },
    );
  }
}

/**
 * Helper: Process street endpoints with geotagged coordinates
 */
function processStreetEndpointsWithPreResolvedCoordinates(
  streets: StreetSection[],
  preGeocodedMap: Map<string, Coordinates>,
  addresses: Address[],
): void {
  for (const street of streets) {
    if (street.fromCoordinates) {
      processStreetEndpoint(
        street,
        street.from,
        street.fromCoordinates,
        "from",
        preGeocodedMap,
        addresses,
      );
    }

    if (street.toCoordinates) {
      processStreetEndpoint(
        street,
        street.to,
        street.toCoordinates,
        "to",
        preGeocodedMap,
        addresses,
      );
    }
  }
}

/**
 * Helper: Geocode street intersections using Overpass
 */
async function geocodeStreetIntersections(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  addresses: Address[],
): Promise<void> {
  if (extractedData.streets.length === 0) return;

  // Process geotagged coordinates first
  processStreetEndpointsWithPreResolvedCoordinates(
    extractedData.streets,
    preGeocodedMap,
    addresses,
  );

  // Filter to streets that still need Overpass geocoding
  const streetsNeedingGeocoding = extractedData.streets.filter(
    (street) =>
      !preGeocodedMap.has(street.from) || !preGeocodedMap.has(street.to),
  );

  if (streetsNeedingGeocoding.length > 0) {
    const streetGeocodedMap = await geocodeIntersectionsForStreets(
      streetsNeedingGeocoding,
      preGeocodedMap,
    );

    streetGeocodedMap.forEach((coords, key) => {
      if (!preGeocodedMap.has(key)) {
        preGeocodedMap.set(key, coords);
        addresses.push(createAddressFromCoordinates(key, coords));
      }
    });
  }

  // Fallback geocoding for missing endpoints
  const missingEndpoints = findMissingStreetEndpoints(
    extractedData.streets,
    preGeocodedMap,
  );

  if (missingEndpoints.length > 0) {
    const fallbackGeocoded = await overpassGeocodeAddresses(missingEndpoints);
    fallbackGeocoded.forEach((addr) => {
      preGeocodedMap.set(addr.originalText, addr.coordinates);
      addresses.push(addr);
    });
  }
}

/**
 * Helper: Geocode cadastral properties using Bulgarian Cadastre API
 */
async function geocodeCadastralProperties(
  extractedData: ExtractedLocations,
): Promise<Map<string, CadastralGeometry> | undefined> {
  if (
    !extractedData.cadastralProperties ||
    extractedData.cadastralProperties.length === 0
  ) {
    return undefined;
  }

  const identifiers = extractedData.cadastralProperties.map(
    (prop) => prop.identifier,
  );
  const cadastralGeometries =
    await geocodeCadastralPropertiesFromIdentifiers(identifiers);

  logger.info("Geocoded cadastral properties", {
    geocoded: cadastralGeometries.size,
    total: identifiers.length,
  });

  return cadastralGeometries;
}

/**
 * Helper: Geocode bus stops using GTFS data
 */
async function geocodeBusStopsFromExtractedData(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  addresses: Address[],
): Promise<void> {
  if (!extractedData.busStops || extractedData.busStops.length === 0) {
    return;
  }

  const geocodedBusStops = await geocodeBusStops(extractedData.busStops);
  addresses.push(...geocodedBusStops);

  geocodedBusStops.forEach((addr) => {
    preGeocodedMap.set(addr.originalText, addr.coordinates);
  });

  logger.info("Geocoded bus stops", {
    geocoded: geocodedBusStops.length,
    total: extractedData.busStops.length,
  });
}

/**
 * Geocode addresses from extracted locations using hybrid approach.
 * Google for pins, Overpass for street intersections, Cadastre for УПИ, GTFS for bus stops.
 * Skips geocoding for geotagged coordinates (pre-resolved by source).
 */
export async function geocodeAddressesFromExtractedData(
  extractedData: ExtractedLocations | null,
): Promise<GeocodingResult> {
  const preGeocodedMap = new Map<string, Coordinates>();
  const addresses: Address[] = [];

  if (!extractedData) {
    return { preGeocodedMap, addresses };
  }

  // Geocode each location type using specialized services
  await geocodePins(extractedData, preGeocodedMap, addresses);
  await geocodeStreetIntersections(extractedData, preGeocodedMap, addresses);
  const cadastralGeometries = await geocodeCadastralProperties(extractedData);
  await geocodeBusStopsFromExtractedData(
    extractedData,
    preGeocodedMap,
    addresses,
  );

  // Deduplicate addresses before returning
  const deduplicatedAddresses = deduplicateAddresses(addresses);

  return {
    preGeocodedMap,
    addresses: deduplicatedAddresses,
    cadastralGeometries,
  };
}
