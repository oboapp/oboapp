import {
  geocodeAddresses,
  geocodeIntersectionsForStreets,
  geocodeCadastralPropertiesFromIdentifiers,
  geocodeBusStops,
  geocodeEducationalFacilities,
  hasHouseNumber,
} from "@/geocoding/router";
import {
  overpassGeocodeAddresses,
  preFetchStreetGeometries,
} from "@/geocoding/overpass/service";
import {
  Address,
  ExtractedLocations,
  StreetSection,
  Coordinates,
  QualitySignals,
  QUALITY_PROVIDERS,
  isWithinBounds,
  normalizePinAddress,
} from "@oboapp/shared";
import type { Feature, MultiLineString } from "geojson";
import type { CadastralGeometry } from "@/geocoding/cadastre/service";
import type { IngestErrorRecorder } from "@/lib/ingest-errors";
import { logger } from "@/lib/logger";
import { getLocality } from "@/lib/target-locality";
import { roundCoordinate } from "@/geocoding/shared/coordinate-utils";
import { gradeOverpass } from "@/geocoding/shared/quality";
import type { GeocodingProgressTracker } from "./geocoding-progress-tracker";

// Internal types for the geocoding pipeline
export interface GeocodingResult {
  preGeocodedMap: Map<string, Coordinates>;
  qualityMap: Map<string, QualitySignals>;
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
 * Collect all unique street names referenced across a batch of sections.
 * Includes the main street name and any cross-street endpoints (non-house-number).
 * Pre-geocoded endpoints are excluded because they never need an Overpass lookup.
 * Deduplication by normalized cache key happens inside preFetchStreetGeometries.
 */
function collectUniqueStreetNames(
  streets: StreetSection[],
  preGeocodedMap: Map<string, Coordinates>,
): string[] {
  const names: string[] = [];
  for (const street of streets) {
    // street.street is the canonical street name (e.g. "ул. Оборище"), never a
    // house-number string, so no hasHouseNumber guard is needed here.
    names.push(street.street);
    // Include both endpoints even for sections where only one needs Overpass — any
    // already-geocoded or house-number endpoint is excluded by the guards below.
    // The cache-skip inside preFetchStreetGeometries makes the extra names free.
    if (!preGeocodedMap.has(street.from) && !hasHouseNumber(street.from)) {
      names.push(street.from);
    }
    if (!preGeocodedMap.has(street.to) && !hasHouseNumber(street.to)) {
      names.push(street.to);
    }
  }
  return names;
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
  qualitySignals?: QualitySignals,
): Address {
  return {
    originalText: text,
    formattedAddress: text,
    coordinates,
    geoJson: {
      type: "Point",
      coordinates: [coordinates.lng, coordinates.lat],
    },
    ...(qualitySignals && { qualitySignals }),
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
    timespans: Array<{ start: string | null; end: string | null }>;
  }>,
  preGeocodedMap: Map<string, Coordinates>,
  qualityMap: Map<string, QualitySignals>,
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
        // Pre-geotagged coordinates from source: tier 1 (approximate/source-provided)
        qualityMap.set(pin.address, {
          provider: QUALITY_PROVIDERS.SOURCE,
          geometryQuality: 1,
        });
        addresses.push(
          createAddressFromCoordinates(pin.address, validatedCoords, {
            provider: QUALITY_PROVIDERS.SOURCE,
            geometryQuality: 1,
          }),
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
  qualityMap: Map<string, QualitySignals>,
  addresses: Address[],
  tracker?: GeocodingProgressTracker,
): Promise<void> {
  if (extractedData.pins.length === 0) return;

  const countBefore = addresses.length;

  const pinsToGeocode = processPinsWithPreResolvedCoordinates(
    extractedData.pins,
    preGeocodedMap,
    qualityMap,
    addresses,
  );

  if (pinsToGeocode.length > 0) {
    const geocodedPins = await geocodeAddresses(pinsToGeocode);
    addresses.push(...geocodedPins);

    geocodedPins.forEach((addr) => {
      preGeocodedMap.set(addr.originalText, addr.coordinates);
      if (addr.qualitySignals) {
        qualityMap.set(addr.originalText, addr.qualitySignals);
      }
    });
  }

  if (tracker) {
    // Record all resolved pins (pre-resolved + API-geocoded) with the full input count as attempted
    const resolvedPins = addresses.slice(countBefore);
    await tracker.recordPins(resolvedPins, extractedData.pins.length);
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
  qualityMap: Map<string, QualitySignals>,
  addresses: Address[],
): void {
  const validatedCoords = getValidPreResolvedCoordinates(
    endpointCoordinates,
    `street endpoint: ${street.street} ${direction} ${endpointName}`,
  );

  if (validatedCoords) {
    preGeocodedMap.set(endpointName, validatedCoords);
    // Pre-geotagged street endpoints: tier 1 (source-provided)
    qualityMap.set(endpointName, {
      provider: QUALITY_PROVIDERS.SOURCE,
      geometryQuality: 1,
    });
    addresses.push(
      createAddressFromCoordinates(endpointName, validatedCoords, {
        provider: QUALITY_PROVIDERS.SOURCE,
        geometryQuality: 1,
      }),
    );
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
  qualityMap: Map<string, QualitySignals>,
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
        qualityMap,
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
        qualityMap,
        addresses,
      );
    }
  }
}

/**
 * Fetch and record street geometry in the progress tracker.
 * If `beforeFetch` is provided it is called immediately before any new Overpass
 * network request (used by callers to apply per-request rate-limiting delays).
 * Errors during Overpass fetching or progress-tracker recording are caught and
 * logged without affecting geocoding results.
 */
async function recordStreetGeometryInTracker(
  street: StreetSection,
  tracker: GeocodingProgressTracker,
  fetchers: {
    getStreetGeometryCached: (name: string) => Feature<MultiLineString> | null;
    getStreetGeometryFromOverpass: (
      name: string,
    ) => Promise<Feature<MultiLineString> | null>;
    hasStreetGeometryQueried: (name: string) => boolean;
  },
  beforeFetch?: () => Promise<void>,
): Promise<void> {
  try {
    let geometry = fetchers.getStreetGeometryCached(street.street);
    const wasCached = !!geometry;
    if (!geometry && !fetchers.hasStreetGeometryQueried(street.street)) {
      if (beforeFetch) await beforeFetch();
      geometry = await fetchers.getStreetGeometryFromOverpass(street.street);
    }
    if (geometry) {
      logger.debug("Recording street geometry in progress tracker", {
        street: street.street,
        source: wasCached ? "cache" : "overpass",
      });
      await tracker.recordStreet({
        key: normalizePinAddress(street.street),
        originalName: street.street,
        // Stringify to avoid Firestore nested-array rejection (coordinates: number[][][])
        geometry: JSON.stringify(geometry),
      });
    } else {
      logger.debug("No street geometry found; incrementing attempted count", {
        street: street.street,
      });
      tracker.recordAttempted(1);
    }
  } catch (trackerError) {
    logger.warn(
      "Failed to fetch or record street geometry — geocoding result unaffected",
      {
        street: street.street,
        error:
          trackerError instanceof Error
            ? trackerError.message
            : String(trackerError),
      },
    );
  }
}

/**
 * Helper: Geocode street intersections using Overpass
 */
async function geocodeStreetIntersections(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  qualityMap: Map<string, QualitySignals>,
  addresses: Address[],
  tracker?: GeocodingProgressTracker,
): Promise<void> {
  if (extractedData.streets.length === 0) return;

  // Process geotagged coordinates first
  processStreetEndpointsWithPreResolvedCoordinates(
    extractedData.streets,
    preGeocodedMap,
    qualityMap,
    addresses,
  );

  // Snapshot streets whose BOTH endpoints were successfully pre-resolved from source
  // geotags. Must be captured here, before Overpass geocoding adds more entries to
  // preGeocodedMap. Streets with invalid geotagged coordinates (rejected by bounds
  // validation) will not have their endpoints in the map and will not appear here.
  const fullyPreResolvedStreets = extractedData.streets.filter(
    (street) =>
      preGeocodedMap.has(street.from) && preGeocodedMap.has(street.to),
  );

  // Import Overpass service only when a tracker is active — these fetchers are only used
  // for tracker recording; the static overpassGeocodeAddresses handles the geocoding itself
  const overpassFetchers = tracker
    ? await import("@/geocoding/overpass/service")
    : undefined;

  // Filter to streets that still need Overpass geocoding
  const streetsNeedingGeocoding = extractedData.streets.filter(
    (street) =>
      !preGeocodedMap.has(street.from) || !preGeocodedMap.has(street.to),
  );

  if (streetsNeedingGeocoding.length > 0) {
    // Phase 3: Pre-fetch all unique street geometries into the cache before processing
    // intersections. Each unique normalized street name is fetched at most once (with a
    // built-in two-pass deferred retry). Streets that still fail after retry are cached
    // as null, so subsequent per-section intersection calls get immediate cache hits
    // instead of repeating Overpass requests for the same unavailable street.
    const uniqueStreetNames = collectUniqueStreetNames(
      streetsNeedingGeocoding,
      preGeocodedMap,
    );
    await preFetchStreetGeometries(uniqueStreetNames);

    logger.debug("Geocoding streets via Overpass (per-street)", {
      total: streetsNeedingGeocoding.length,
      trackerActive: !!tracker,
    });

    // Process streets one at a time so each can be recorded in the tracker as
    // soon as its Overpass queries complete, rather than waiting for the entire
    // batch. A shared seenIntersections set prevents duplicate Overpass queries
    // across iterations.
    const seenIntersections = new Set<string>();

    for (const street of streetsNeedingGeocoding) {
      const streetGeocodedMap = await geocodeIntersectionsForStreets(
        [street],
        preGeocodedMap,
        seenIntersections,
      );

      streetGeocodedMap.forEach((coords, key) => {
        if (!preGeocodedMap.has(key)) {
          preGeocodedMap.set(key, coords);
          // Intersection points from Overpass: tier 1 (node-level, not full way geometry)
          const qualitySignals = gradeOverpass("node");
          qualityMap.set(key, qualitySignals);
          addresses.push(
            createAddressFromCoordinates(key, coords, qualitySignals),
          );
        }
      });

      if (tracker) {
        // getStreetGeometryCached is populated as a side-effect of
        // geocodeSingleIntersection (which calls getStreetGeometryFromOverpass
        // on both street names to find their geometric crossing). If the street
        // geometry still isn't cached, the street's endpoints were resolved via
        // geotagged coordinates (Overpass intersection queries were skipped).
        // In that case fetch the geometry explicitly.
        await recordStreetGeometryInTracker(street, tracker, overpassFetchers!);
      }
    }
  }

  // Streets whose both endpoints were pre-resolved from geotagged coordinates
  // never enter streetsNeedingGeocoding, so their geometry wasn't fetched above.
  // Record them now using an explicit Overpass lookup with per-request rate limiting.
  if (tracker && fullyPreResolvedStreets.length > 0) {
    logger.debug("Recording geotagged streets in progress tracker", {
      count: fullyPreResolvedStreets.length,
    });

    const { delay } = await import("@/lib/delay");
    let fetchCount = 0;

    for (const street of fullyPreResolvedStreets) {
      await recordStreetGeometryInTracker(
        street,
        tracker,
        overpassFetchers!,
        async () => {
          if (fetchCount > 0) await delay(500);
          fetchCount++;
        },
      );
    }
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
      if (addr.qualitySignals) {
        qualityMap.set(addr.originalText, addr.qualitySignals);
      }
      addresses.push(addr);
    });
  }
}

/**
 * Helper: Geocode cadastral properties using Bulgarian Cadastre API
 */
async function geocodeCadastralProperties(
  extractedData: ExtractedLocations,
  tracker?: GeocodingProgressTracker,
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

  tracker?.recordAttempted(identifiers.length);
  return cadastralGeometries;
}

/**
 * Helper: Geocode bus stops using GTFS data
 */
async function geocodeBusStopsFromExtractedData(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  qualityMap: Map<string, QualitySignals>,
  addresses: Address[],
  tracker?: GeocodingProgressTracker,
): Promise<void> {
  if (!extractedData.busStops || extractedData.busStops.length === 0) {
    return;
  }

  const geocodedBusStops = await geocodeBusStops(extractedData.busStops);
  addresses.push(...geocodedBusStops);

  geocodedBusStops.forEach((addr) => {
    preGeocodedMap.set(addr.originalText, addr.coordinates);
    if (addr.qualitySignals) {
      qualityMap.set(addr.originalText, addr.qualitySignals);
    }
  });

  logger.info("Geocoded bus stops", {
    geocoded: geocodedBusStops.length,
    total: extractedData.busStops.length,
  });

  tracker?.recordAttempted(extractedData.busStops.length);
}

/**
 * Helper: Geocode educational facilities (schools and kindergartens) using local reference data
 */
async function geocodeEducationalFacilitiesFromExtractedData(
  extractedData: ExtractedLocations,
  preGeocodedMap: Map<string, Coordinates>,
  qualityMap: Map<string, QualitySignals>,
  addresses: Address[],
  ingestErrors?: IngestErrorRecorder,
  tracker?: GeocodingProgressTracker,
): Promise<void> {
  if (
    !extractedData.educationalFacilities ||
    extractedData.educationalFacilities.length === 0
  ) {
    return;
  }

  const geocoded = await geocodeEducationalFacilities(
    extractedData.educationalFacilities,
    ingestErrors,
  );
  addresses.push(...geocoded);

  geocoded.forEach((addr) => {
    preGeocodedMap.set(addr.originalText, addr.coordinates);
    if (addr.qualitySignals) {
      qualityMap.set(addr.originalText, addr.qualitySignals);
    }
  });

  tracker?.recordAttempted(extractedData.educationalFacilities.length);
}

/**
 * Geocode addresses from extracted locations using hybrid approach.
 * Google for pins, Overpass for street intersections, Cadastre for УПИ, GTFS for bus stops.
 * Skips geocoding for geotagged coordinates (pre-resolved by source).
 */
export async function geocodeAddressesFromExtractedData(
  extractedData: ExtractedLocations | null,
  ingestErrors?: IngestErrorRecorder,
  tracker?: GeocodingProgressTracker,
): Promise<GeocodingResult> {
  const preGeocodedMap = new Map<string, Coordinates>();
  const qualityMap = new Map<string, QualitySignals>();
  const addresses: Address[] = [];

  if (!extractedData) {
    return { preGeocodedMap, qualityMap, addresses };
  }

  // Pre-populate in-memory street geometry cache from DB (no-op after first call)
  const { seedStreetCacheFromDb } = await import("@/geocoding/cache");
  await seedStreetCacheFromDb();

  // Geocode each location type using specialized services
  await geocodePins(
    extractedData,
    preGeocodedMap,
    qualityMap,
    addresses,
    tracker,
  );
  await geocodeStreetIntersections(
    extractedData,
    preGeocodedMap,
    qualityMap,
    addresses,
    tracker,
  );
  const cadastralGeometries = await geocodeCadastralProperties(
    extractedData,
    tracker,
  );
  await geocodeBusStopsFromExtractedData(
    extractedData,
    preGeocodedMap,
    qualityMap,
    addresses,
    tracker,
  );
  await geocodeEducationalFacilitiesFromExtractedData(
    extractedData,
    preGeocodedMap,
    qualityMap,
    addresses,
    ingestErrors,
    tracker,
  );

  // Deduplicate addresses before returning
  const deduplicatedAddresses = deduplicateAddresses(addresses);

  return {
    preGeocodedMap,
    qualityMap,
    addresses: deduplicatedAddresses,
    cadastralGeometries,
  };
}
