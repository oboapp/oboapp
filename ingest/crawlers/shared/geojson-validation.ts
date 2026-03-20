import type {
  GeoJSONFeatureCollection,
  GeoJSONFeature,
  GeoJSONGeometry,
  GeoJSONPoint,
  GeoJSONLineString,
  GeoJSONPolygon,
} from "@/lib/types";
import { getBoundsForLocality } from "@oboapp/shared";
import { getLocality } from "@/lib/target-locality";

/** Type guard for objects with an optional `coordinates` field. */
function hasCoordinates(
  value: object,
): value is { coordinates: unknown } {
  return "coordinates" in value;
}

/** Type guard for objects with a `type` field. */
function hasType(
  value: object,
): value is { type: unknown } {
  return "type" in value;
}

/** Type guard for objects with a `properties` field. */
function hasProperties(
  value: object,
): value is { properties: unknown } {
  return "properties" in value;
}

/** Type guard for objects with a `features` field. */
function hasFeatures(
  value: object,
): value is { features: unknown } {
  return "features" in value;
}

/**
 * Check if coordinates are within target locality bounds
 * Uses current target locality from environment
 */
export function isWithinTargetBounds(lat: number, lng: number): boolean {
  const locality = getLocality();
  const bounds = getBoundsForLocality(locality);
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

export interface ValidationResult {
  isValid: boolean;
  geoJson: GeoJSONFeatureCollection | null;
  warnings: string[];
  errors: string[];
  fixedCoordinates: boolean;
}

/**
 * Check if coordinates are valid (within global bounds)
 */
export function isValidCoordinate(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Detect if coordinates are swapped [lat,lng] instead of [lng,lat]
 * Returns true if they appear to be swapped
 */
export function detectSwappedCoordinates(lng: number, lat: number): boolean {
  // If the "longitude" is in latitude range and "latitude" is in longitude range
  // and they would be valid if swapped
  const seemsSwapped =
    lng >= -90 &&
    lng <= 90 &&
    lat >= -180 &&
    lat <= 180 &&
    !isWithinTargetBounds(lat, lng) &&
    isWithinTargetBounds(lng, lat);

  return seemsSwapped;
}

/**
 * Fix swapped coordinates by swapping them
 */
export function fixSwappedCoordinates(
  coords: [number, number],
): [number, number] {
  return [coords[1], coords[0]];
}

/**
 * Validate and fix a single coordinate pair
 * Returns fixed coordinates or null if invalid
 */
function validateAndFixCoordinatePair(
  point: unknown,
): { coords: [number, number]; wasSwapped: boolean } | null {
  if (!Array.isArray(point) || point.length !== 2) {
    return null;
  }

  if (typeof point[0] !== "number" || typeof point[1] !== "number") {
    return null;
  }

  let [lng, lat] = point;
  let wasSwapped = false;

  // Check if coordinates are swapped
  if (detectSwappedCoordinates(lng, lat)) {
    [lng, lat] = fixSwappedCoordinates([lng, lat]);
    wasSwapped = true;
  }

  if (!isValidCoordinate(lng, lat)) {
    return null;
  }

  return { coords: [lng, lat], wasSwapped };
}

/**
 * Validate and potentially fix a Point geometry
 */
function validateAndFixPoint(
  geometry: unknown,
  warnings: string[],
): GeoJSONPoint | null {
  if (
    !geometry ||
    typeof geometry !== "object" ||
    !hasCoordinates(geometry)
  ) {
    return null;
  }

  const coords = geometry.coordinates;

  if (!Array.isArray(coords) || coords.length !== 2) {
    return null;
  }

  if (typeof coords[0] !== "number" || typeof coords[1] !== "number") {
    return null;
  }

  let [lng, lat] = coords;

  // Check if coordinates are swapped
  if (detectSwappedCoordinates(lng, lat)) {
    warnings.push(
      `Point coordinates swapped from [${lng}, ${lat}] to [${lat}, ${lng}]`,
    );
    [lng, lat] = fixSwappedCoordinates([lng, lat]);
  }

  if (!isValidCoordinate(lng, lat)) {
    return null;
  }

  return {
    type: "Point",
    coordinates: [lng, lat],
  };
}

/**
 * Validate and potentially fix a LineString geometry
 */
function validateAndFixLineString(
  geometry: unknown,
  warnings: string[],
): GeoJSONLineString | null {
  if (
    !geometry ||
    typeof geometry !== "object" ||
    !hasCoordinates(geometry)
  ) {
    return null;
  }

  const coords = geometry.coordinates;

  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const fixedCoords: [number, number][] = [];
  let hasSwaps = false;

  for (const point of coords) {
    const result = validateAndFixCoordinatePair(point);
    if (!result) {
      return null;
    }

    fixedCoords.push(result.coords);
    if (result.wasSwapped) {
      hasSwaps = true;
    }
  }

  if (hasSwaps) {
    warnings.push(`LineString had ${fixedCoords.length} coordinates swapped`);
  }

  return {
    type: "LineString",
    coordinates: fixedCoords,
  };
}

/**
 * Validate and fix a single polygon ring
 * Returns fixed ring coordinates and swap status, or null if invalid
 */
function validateAndFixPolygonRing(
  ring: unknown,
): { ring: [number, number][]; hasSwaps: boolean } | null {
  if (!Array.isArray(ring) || ring.length < 4) {
    return null;
  }

  const fixedRing: [number, number][] = [];
  let hasSwaps = false;

  for (const point of ring) {
    const result = validateAndFixCoordinatePair(point);
    if (!result) {
      return null;
    }

    fixedRing.push(result.coords);
    if (result.wasSwapped) {
      hasSwaps = true;
    }
  }

  // Validate that ring is closed
  const first = fixedRing[0];
  const last = fixedRing[fixedRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return null;
  }

  return { ring: fixedRing, hasSwaps };
}

/**
 * Validate and potentially fix a Polygon geometry
 */
function validateAndFixPolygon(
  geometry: unknown,
  warnings: string[],
): GeoJSONPolygon | null {
  if (
    !geometry ||
    typeof geometry !== "object" ||
    !hasCoordinates(geometry)
  ) {
    return null;
  }

  const coords = geometry.coordinates;

  if (!Array.isArray(coords) || coords.length < 1) {
    return null;
  }

  const fixedRings: [number, number][][] = [];
  let hasSwaps = false;

  for (const ring of coords) {
    const result = validateAndFixPolygonRing(ring);
    if (!result) {
      return null;
    }

    fixedRings.push(result.ring);
    if (result.hasSwaps) {
      hasSwaps = true;
    }
  }

  if (hasSwaps) {
    warnings.push(`Polygon had coordinates swapped`);
  }

  return {
    type: "Polygon",
    coordinates: fixedRings,
  };
}

/**
 * Validate and potentially fix a geometry
 */
function validateAndFixGeometry(
  geometry: unknown,
  warnings: string[],
): GeoJSONGeometry | null {
  if (!geometry || typeof geometry !== "object" || !hasType(geometry)) {
    return null;
  }

  const geomType = geometry.type;

  switch (geomType) {
    case "Point":
      return validateAndFixPoint(geometry, warnings);
    case "LineString":
      return validateAndFixLineString(geometry, warnings);
    case "Polygon":
      return validateAndFixPolygon(geometry, warnings);
    default:
      return null;
  }
}

/**
 * Validate and fix a single GeoJSON feature
 * Returns the fixed feature or null if invalid
 */
function validateAndFixFeature(
  feature: unknown,
  index: number,
  contextPrefix: string,
  errors: string[],
  warnings: string[],
): GeoJSONFeature | null {
  if (!feature || typeof feature !== "object") {
    errors.push(`${contextPrefix}Feature ${index} is not an object`);
    return null;
  }

  if (!("type" in feature) || feature.type !== "Feature") {
    const featureType = "type" in feature ? String(feature.type) : "unknown";
    errors.push(
      `${contextPrefix}Feature ${index} type must be "Feature", got "${featureType}"`,
    );
    return null;
  }

  if (!("geometry" in feature) || !feature.geometry) {
    errors.push(`${contextPrefix}Feature ${index} missing geometry`);
    return null;
  }

  const featureWarnings: string[] = [];
  const fixedGeometry = validateAndFixGeometry(
    feature.geometry,
    featureWarnings,
  );

  if (!fixedGeometry) {
    errors.push(`${contextPrefix}Feature ${index} has invalid geometry`);
    return null;
  }

  // Add warnings with feature index
  featureWarnings.forEach((w) => {
    warnings.push(`${contextPrefix}Feature ${index}: ${w}`);
  });

  const rawProps =
    hasProperties(feature) &&
    typeof feature.properties === "object" &&
    feature.properties !== null
      ? feature.properties
      : null;
  const properties: Record<string, unknown> = rawProps
    ? Object.fromEntries(Object.entries(rawProps))
    : {};

  return {
    type: "Feature",
    geometry: fixedGeometry,
    properties,
  };
}

/**
 * Validate basic GeoJSON structure
 * Returns null if valid, or a ValidationResult with errors if invalid
 */
function validateGeoJSONStructure(
  data: unknown,
  contextPrefix: string,
): ValidationResult | null {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push(`${contextPrefix}GeoJSON is not an object`);
    return {
      isValid: false,
      geoJson: null,
      warnings: [],
      errors,
      fixedCoordinates: false,
    };
  }

  if (!("type" in data) || data.type !== "FeatureCollection") {
    const dataType = "type" in data ? String(data.type) : "unknown";
    errors.push(
      `${contextPrefix}GeoJSON type must be "FeatureCollection", got "${dataType}"`,
    );
    return {
      isValid: false,
      geoJson: null,
      warnings: [],
      errors,
      fixedCoordinates: false,
    };
  }

  if (!("features" in data) || !Array.isArray(data.features)) {
    errors.push(`${contextPrefix}GeoJSON features must be an array`);
    return {
      isValid: false,
      geoJson: null,
      warnings: [],
      errors,
      fixedCoordinates: false,
    };
  }

  return null;
}

/**
 * Validate and potentially fix a GeoJSON FeatureCollection
 * Auto-detects and fixes swapped [lat,lng] vs [lng,lat] coordinates
 */
export function validateAndFixGeoJSON(
  data: unknown,
  context?: string,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const contextPrefix = context ? `[${context}] ` : "";

  // Validate basic structure
  const structureError = validateGeoJSONStructure(data, contextPrefix);
  if (structureError) {
    return structureError;
  }

  // At this point we know data has the right shape
  if (
    !data ||
    typeof data !== "object" ||
    !hasFeatures(data) ||
    !Array.isArray(data.features)
  ) {
    return { isValid: false, geoJson: null, warnings, errors, fixedCoordinates: false };
  }
  const features = data.features;

  // Validate and fix each feature
  const fixedFeatures: GeoJSONFeature[] = [];

  for (let i = 0; i < features.length; i++) {
    const fixedFeature = validateAndFixFeature(
      features[i],
      i,
      contextPrefix,
      errors,
      warnings,
    );

    if (fixedFeature) {
      fixedFeatures.push(fixedFeature);
    }
  }

  if (fixedFeatures.length === 0 && features.length > 0) {
    errors.push(`${contextPrefix}All features are invalid`);
    return {
      isValid: false,
      geoJson: null,
      warnings,
      errors,
      fixedCoordinates: false,
    };
  }

  const geoJson: GeoJSONFeatureCollection = {
    type: "FeatureCollection",
    features: fixedFeatures,
  };

  return {
    isValid: true,
    geoJson,
    warnings,
    errors,
    fixedCoordinates: warnings.length > 0,
  };
}
