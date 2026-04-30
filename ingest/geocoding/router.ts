/**
 * Unified geocoding interface - RESOLVER-DRIVEN
 *
 * Each geocodable location type is handled by a provider declared in
 * localities/{locality}.yaml. See ingest/lib/locality-data-sources.ts.
 */

import type { EducationalFacilityRef } from "@oboapp/shared";
import { EDUCATIONAL_FACILITY_PREFIX } from "@/lib/constants";
import { Address, StreetSection, Coordinates } from "../lib/types";
import type { IngestErrorRecorder } from "@/lib/ingest-errors";
import { logger } from "@/lib/logger";
import { geocodeAddresses as geocodeAddressesTraditional } from "./google/service";
import {
  overpassGeocodeAddresses,
  overpassGeocodeIntersections,
} from "./overpass/service";
import {
  geocodeCadastralProperties,
  type CadastralGeometry,
} from "./cadastre/service";
import { geocodeBusStops as geocodeBusStopsService } from "./gtfs/geocoding-service";
import { geocodeEducationalFacilities as geocodeEducationalFacilitiesService } from "./educational-facilities/geocoding-service";
import { CadastreMockService } from "../__mocks__/services/cadastre-mock-service";
import { getLocalityDataSources, type GeocodingResolvers } from "@/lib/locality-data-sources";

// Check if mocking is enabled for Cadastre
// (Google Geocoding mock is handled in geocoding-service.ts)
// (Overpass mock is handled in overpass-geocoding-service.ts)
const USE_CADASTRE_MOCK = process.env.MOCK_CADASTRE_API === "true";
const cadastreMockService = USE_CADASTRE_MOCK
  ? new CadastreMockService()
  : null;

// Provider dispatch maps — one per resolver type.
// Adding a new provider means adding one entry here; no switch needed at call sites.

const PIN_PROVIDERS: Record<
  GeocodingResolvers["pins"]["provider"],
  (input: string[]) => Promise<Address[]>
> = {
  google: geocodeAddressesTraditional,
  overpass: overpassGeocodeAddresses,
};

const STREET_ENDPOINT_PROVIDERS: Record<
  GeocodingResolvers["streets"]["provider"],
  (input: string[]) => Promise<Address[]>
> = {
  google: geocodeAddressesTraditional,
  overpass: overpassGeocodeAddresses,
};

const BUS_STOP_PROVIDERS: Record<
  GeocodingResolvers["bus-stops"]["provider"],
  (codes: string[]) => Promise<Address[]>
> = {
  gtfs: geocodeBusStopsService,
  google: (codes) =>
    geocodeAddressesTraditional(codes.map((c) => `Спирка ${c}`)),
  overpass: (codes) =>
    overpassGeocodeAddresses(codes.map((c) => `Спирка ${c}`)),
  skip: async () => [],
};

const EDUCATIONAL_FACILITY_PROVIDERS: Record<
  GeocodingResolvers["educational-facilities"]["provider"],
  (
    facilities: EducationalFacilityRef[],
    errors?: IngestErrorRecorder,
  ) => Promise<Address[]>
> = {
  "educational-facilities": geocodeEducationalFacilitiesService,
  google: async (facilities) => {
    const queryToKey = new Map(
      facilities.map((f) => [
        `${f.type} ${f.number}`,
        `${EDUCATIONAL_FACILITY_PREFIX}${f.type}:${f.number}`,
      ]),
    );
    const results = await geocodeAddressesTraditional(
      facilities.map((f) => `${f.type} ${f.number}`),
    );
    return results.map((addr) => ({
      ...addr,
      originalText: queryToKey.get(addr.originalText) ?? addr.originalText,
    }));
  },
  skip: async () => [],
};

/**
 * Geocode a list of addresses (pins) using the configured pins resolver.
 */
export async function geocodeAddresses(
  addresses: string[],
): Promise<Address[]> {
  const { pins } = getLocalityDataSources()["geocoding-resolvers"];
  return PIN_PROVIDERS[pins.provider](addresses);
}

/**
 * Geocode street sections using the configured streets resolver.
 */
export async function geocodeStreets(
  streets: StreetSection[],
): Promise<Address[]> {
  const endpointAddresses = streets.flatMap((s) => [s.from, s.to]);
  const { streets: resolver } = getLocalityDataSources()["geocoding-resolvers"];
  return STREET_ENDPOINT_PROVIDERS[resolver.provider](endpointAddresses);
}

/**
 * Get street geometry (centerline) using the configured streets resolver.
 * Currently only Overpass supports geometry queries; Google falls back to null.
 */
export async function getStreetGeometry(
  streetName: string,
  startCoords: Coordinates,
  endCoords: Coordinates,
): Promise<[number, number][] | null> {
  const { streets: resolver } = getLocalityDataSources()["geocoding-resolvers"];
  if (resolver.provider !== "overpass") return null;
  const { getStreetSectionGeometry } = await import("./overpass/service");
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
  seenIntersections?: Set<string>,
): Promise<Map<string, Coordinates>> {
  const geocodedMap = new Map<string, Coordinates>();

  // Extract unique intersections, separating house-number endpoints.
  // When seenIntersections is provided (per-street calls), it is shared across
  // iterations to prevent the same intersection being queried more than once.
  const intersectionSet = seenIntersections ?? new Set<string>();
  const intersections: string[] = [];
  const houseNumberEndpoints = new Map<string, string>(); // endpoint -> street name

  function processEndpoint(endpoint: string, streetName: string): void {
    if (preGeocodedMap?.has(endpoint)) return;
    if (!endpoint.trim()) {
      logger.warn("Skipping empty endpoint in intersection geocoding", {
        street: streetName,
        endpoint,
      });
    } else if (hasHouseNumber(endpoint)) {
      houseNumberEndpoints.set(endpoint, streetName);
    } else {
      const intersection = `${streetName} ∩ ${endpoint}`;
      if (!intersectionSet.has(intersection)) {
        intersectionSet.add(intersection);
        intersections.push(intersection);
      }
    }
  }

  streets.forEach((street) => {
    processEndpoint(street.from, street.street);
    processEndpoint(street.to, street.street);
  });

  const { streets: streetsResolver } =
    getLocalityDataSources()["geocoding-resolvers"];

  if (streetsResolver.provider === "overpass") {
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

      const houseNumberGeocoded =
        await overpassGeocodeAddresses(endpointQueries);

      // Match results by originalText to handle skipped failures
      houseNumberGeocoded.forEach((address) => {
        const originalEndpoint = queryToEndpoint.get(address.originalText);
        if (originalEndpoint) {
          geocodedMap.set(originalEndpoint, address.coordinates);
        }
      });
    }
  } else {
    // Google fallback: geocode all intersections and house-number endpoints as plain addresses
    const allEndpoints = new Map<string, string>(); // query -> endpoint key

    for (const intersection of intersections) {
      const crossStreet = intersection.split(" ∩ ")[1]?.trim();
      if (crossStreet) allEndpoints.set(intersection, crossStreet);
    }

    const queryToEndpoint = new Map<string, string>();
    for (const [endpoint, streetName] of houseNumberEndpoints.entries()) {
      const query = buildHouseNumberQuery(streetName, endpoint);
      queryToEndpoint.set(query, endpoint);
    }

    const allQueries = [
      ...allEndpoints.keys(),
      ...queryToEndpoint.keys(),
    ];

    if (allQueries.length > 0) {
      const geocoded = await geocodeAddressesTraditional(allQueries);
      geocoded.forEach((address) => {
        const crossStreet = allEndpoints.get(address.originalText);
        if (crossStreet) {
          geocodedMap.set(crossStreet, address.coordinates);
          return;
        }
        const endpoint = queryToEndpoint.get(address.originalText);
        if (endpoint) {
          geocodedMap.set(endpoint, address.coordinates);
        }
      });
    }
  }

  return geocodedMap;
}

/**
 * Geocode cadastral properties using the configured cadastral-properties resolver.
 */
export async function geocodeCadastralPropertiesFromIdentifiers(
  identifiers: string[],
): Promise<Map<string, CadastralGeometry>> {
  if (identifiers.length === 0) {
    return new Map();
  }

  const resolver =
    getLocalityDataSources()["geocoding-resolvers"]["cadastral-properties"];

  if (resolver.provider === "skip") {
    return new Map();
  }

  // provider === "cadastre"
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
 * Geocode bus stops using the configured bus-stops resolver.
 */
export async function geocodeBusStops(stopCodes: string[]): Promise<Address[]> {
  if (stopCodes.length === 0) {
    return [];
  }

  const resolver =
    getLocalityDataSources()["geocoding-resolvers"]["bus-stops"];

  return BUS_STOP_PROVIDERS[resolver.provider](stopCodes);
}

/**
 * Geocode educational facilities using the configured educational-facilities resolver.
 */
export async function geocodeEducationalFacilities(
  facilities: EducationalFacilityRef[],
  ingestErrors?: IngestErrorRecorder,
): Promise<Address[]> {
  if (facilities.length === 0) {
    return [];
  }

  const resolver =
    getLocalityDataSources()["geocoding-resolvers"]["educational-facilities"];

  return EDUCATIONAL_FACILITY_PROVIDERS[resolver.provider](
    facilities,
    ingestErrors,
  );
}
