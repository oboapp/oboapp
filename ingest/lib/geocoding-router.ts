/**
 * Unified geocoding interface - FIXED HYBRID APPROACH
 *
 * Google Geocoding API for pins (specific addresses)
 * OpenStreetMap Overpass API for streets (intersections and geometries)
 * Bulgarian Cadastre API for cadastral properties (УПИ)
 * GTFS for bus stops (public transport)
 */

import { Address, StreetSection, Coordinates } from "./types";
import { logger } from "@/lib/logger";
import { geocodeAddresses as geocodeAddressesTraditional } from "./geocoding-service";
import {
  overpassGeocodeAddresses,
  overpassGeocodeIntersections,
} from "./overpass-geocoding-service";
import {
  geocodeCadastralProperties,
  type CadastralGeometry,
} from "./cadastre-geocoding-service";
import { geocodeBusStops as geocodeBusStopsService } from "./gtfs-geocoding-service";
import { CadastreMockService } from "../__mocks__/services/cadastre-mock-service";

// Check if mocking is enabled for Cadastre
// (Google Geocoding mock is handled in geocoding-service.ts)
// (Overpass mock is handled in overpass-geocoding-service.ts)
const USE_CADASTRE_MOCK = process.env.MOCK_CADASTRE_API === "true";
const cadastreMockService = USE_CADASTRE_MOCK
  ? new CadastreMockService()
  : null;

/**
 * Geocode a list of addresses (pins) using Google Geocoding API
 */
export async function geocodeAddresses(
  addresses: string[],
): Promise<Address[]> {
  return geocodeAddressesTraditional(addresses);
}

/**
 * Geocode street sections using Overpass (geocode endpoints)
 */
export async function geocodeStreets(
  streets: StreetSection[],
): Promise<Address[]> {
  const endpointAddresses = streets.flatMap((s) => [s.from, s.to]);
  return overpassGeocodeAddresses(endpointAddresses);
}

/**
 * Get street geometry (centerline) using Overpass for real OSM geometries
 */
export async function getStreetGeometry(
  streetName: string,
  startCoords: Coordinates,
  endCoords: Coordinates,
): Promise<[number, number][] | null> {
  const { getStreetSectionGeometry } =
    await import("./overpass-geocoding-service");
  const geometry = await getStreetSectionGeometry(
    streetName,
    startCoords,
    endCoords,
  );
  if (!geometry) return null;
  return geometry.map((pos): [number, number] => [pos[0], pos[1]]);
}

/**
 * Build a Nominatim query for a house-number endpoint.
 *
 * If the endpoint already contains the street name (e.g. "ул. Оборище №111"),
 * the street name is NOT prefixed again to avoid duplicated queries like
 * "ул. Оборище ул. Оборище №111".
 */
export function buildHouseNumberQuery(
  streetName: string,
  endpoint: string,
): string {
  const trimmedStreet = streetName.trim();
  const trimmedEndpoint = endpoint.trim();

  if (trimmedEndpoint.toLowerCase().includes(trimmedStreet.toLowerCase())) {
    return trimmedEndpoint;
  }

  return `${trimmedStreet} ${trimmedEndpoint}`;
}

/**
 * Check if a street endpoint contains a house/building number.
 *
 * Detects patterns like:
 * - № symbol + number: "№111", "№ 38", "с № 65"
 * - Block + number: "бл. 38", "бл.5"
 * - Word "номер" + number: "номер 3", "номер 15"
 * - Standalone number: "14", "25Б" (endpoint is just digits + optional letter)
 */
export function hasHouseNumber(endpoint: string): boolean {
  const trimmed = endpoint.trim();

  // Check if endpoint is standalone number with optional Cyrillic letter suffix
  if (/^\d+[А-Яа-я]?$/i.test(trimmed)) {
    return true;
  }

  // Check for explicit number markers
  return /№\s*\d+|бл\.\s*\d+|номер\s+\d+/i.test(endpoint);
}

/**
 * Geocode street section intersections using Overpass
 * @param streets - Street sections to geocode
 * @param preGeocodedMap - Optional map of already geocoded endpoints to skip
 */
export async function geocodeIntersectionsForStreets(
  streets: StreetSection[],
  preGeocodedMap?: Map<string, Coordinates>,
): Promise<Map<string, Coordinates>> {
  const geocodedMap = new Map<string, Coordinates>();

  // Extract unique intersections, separating house-number endpoints
  const intersectionSet = new Set<string>();
  const intersections: string[] = [];
  const houseNumberEndpoints = new Map<string, string>(); // endpoint -> street name

  streets.forEach((street) => {
    // "from" endpoint - only process if not already geocoded
    // Skip endpoints already in preGeocodedMap to avoid redundant Overpass/Nominatim API calls
    if (!preGeocodedMap?.has(street.from)) {
      if (hasHouseNumber(street.from)) {
        // Track street context for house-number endpoints to avoid ambiguous queries
        houseNumberEndpoints.set(street.from, street.street);
      } else {
        const fromIntersection = `${street.street} ∩ ${street.from}`;
        if (!intersectionSet.has(fromIntersection)) {
          intersectionSet.add(fromIntersection);
          intersections.push(fromIntersection);
        }
      }
    }

    // "to" endpoint - only process if not already geocoded
    // Skip endpoints already in preGeocodedMap to avoid redundant Overpass/Nominatim API calls
    if (!preGeocodedMap?.has(street.to)) {
      if (hasHouseNumber(street.to)) {
        // Track street context for house-number endpoints to avoid ambiguous queries
        houseNumberEndpoints.set(street.to, street.street);
      } else {
        const toIntersection = `${street.street} ∩ ${street.to}`;
        if (!intersectionSet.has(toIntersection)) {
          intersectionSet.add(toIntersection);
          intersections.push(toIntersection);
        }
      }
    }
  });

  // Geocode cross-street intersections via Overpass
  const geocoded = await overpassGeocodeIntersections(intersections);

  geocoded.forEach((address) => {
    // Store with just the cross street name (what validation and GeoJSON service expect)
    // Extract the cross street from "ул. A ∩ ул. B" format
    const parts = address.formattedAddress.split(" ∩ ");
    if (parts.length === 2) {
      const crossStreet = parts[1].trim();
      geocodedMap.set(crossStreet, address.coordinates);
    }
  });

  // Geocode house-number endpoints directly via Nominatim
  if (houseNumberEndpoints.size > 0) {
    // Build specific queries with street context to avoid ambiguous results
    const queryToEndpoint = new Map<string, string>();
    const endpointQueries = Array.from(houseNumberEndpoints.entries()).map(
      ([endpoint, streetName]) => {
        const query = buildHouseNumberQuery(streetName, endpoint);
        queryToEndpoint.set(query, endpoint);
        return query;
      },
    );

    logger.info("Geocoding house-number endpoints via Nominatim", {
      count: endpointQueries.length,
    });

    const houseNumberGeocoded = await overpassGeocodeAddresses(endpointQueries);

    // Match results by originalText to handle skipped failures
    houseNumberGeocoded.forEach((address) => {
      const originalEndpoint = queryToEndpoint.get(address.originalText);
      if (originalEndpoint) {
        geocodedMap.set(originalEndpoint, address.coordinates);
      }
    });
  }

  return geocodedMap;
}

/**
 * Geocode cadastral properties using Bulgarian Cadastre API
 */
export async function geocodeCadastralPropertiesFromIdentifiers(
  identifiers: string[],
): Promise<Map<string, CadastralGeometry>> {
  if (identifiers.length === 0) {
    return new Map();
  }

  // Use mock if enabled
  if (USE_CADASTRE_MOCK && cadastreMockService) {
    logger.info("Using Cadastre mock for properties");
    const mockResults =
      await cadastreMockService.geocodeCadastralPropertiesFromIdentifiers(
        identifiers.map((id) => ({ identifier: id, timespans: [] })),
      );
    const resultMap = new Map<string, CadastralGeometry>();
    mockResults.forEach((result, index) => {
      if (result && result.geoJson) {
        resultMap.set(identifiers[index], result.geoJson);
      }
    });
    return resultMap;
  }

  return geocodeCadastralProperties(identifiers);
}

/**
 * Geocode bus stops using GTFS data
 */
export async function geocodeBusStops(stopCodes: string[]): Promise<Address[]> {
  if (stopCodes.length === 0) {
    return [];
  }

  return geocodeBusStopsService(stopCodes);
}
