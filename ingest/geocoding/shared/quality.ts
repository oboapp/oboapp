/**
 * Geometry Quality Grading
 *
 * Computes deterministic per-feature quality scores (0–3) from geocoder signals.
 * Scores reflect geometry precision: 3 = official/building-level, 2 = address-level,
 * 1 = approximate/street, 0 = none/unknown.
 */

import type { QualitySignals } from "@oboapp/shared";
import { QUALITY_PROVIDERS, OSM_ELEMENT_TYPES } from "@oboapp/shared";
import { GOOGLE_LOCATION_TYPES } from "./google-location-types";

/**
 * Grade a Google Geocoding result
 * Quality = 3 if ROOFTOP & not partial, 2 if RANGE_INTERPOLATED/GEOMETRIC_CENTER & not partial,
 * 1 if APPROXIMATE or partial_match, 0 if no result.
 */
export function gradeGoogle(
  locationType?: string,
  partialMatch?: boolean,
): QualitySignals {
  if (!locationType) {
    return {
      provider: QUALITY_PROVIDERS.GOOGLE,
      geometryQuality: 0,
    };
  }

  if (locationType === GOOGLE_LOCATION_TYPES.ROOFTOP && !partialMatch) {
    return {
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.ROOFTOP,
      partialMatch: false,
      geometryQuality: 3,
    };
  }

  if (
    locationType === GOOGLE_LOCATION_TYPES.RANGE_INTERPOLATED &&
    !partialMatch
  ) {
    return {
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.RANGE_INTERPOLATED,
      partialMatch: false,
      geometryQuality: 2,
    };
  }

  if (
    locationType === GOOGLE_LOCATION_TYPES.GEOMETRIC_CENTER &&
    !partialMatch
  ) {
    return {
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.GEOMETRIC_CENTER,
      partialMatch: false,
      geometryQuality: 2,
    };
  }

  if (locationType === GOOGLE_LOCATION_TYPES.APPROXIMATE) {
    return {
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.APPROXIMATE,
      geometryQuality: 1,
    };
  }

  if (partialMatch) {
    return {
      provider: QUALITY_PROVIDERS.GOOGLE,
      partialMatch: true,
      geometryQuality: 1,
    };
  }

  return {
    provider: QUALITY_PROVIDERS.GOOGLE,
    geometryQuality: 1,
  };
}

/**
 * Grade an Overpass (OpenStreetMap) result
 * Quality = 2 if way, 1 if node/relation/fallback.
 */
export function gradeOverpass(elementType?: string): QualitySignals {
  if (elementType === OSM_ELEMENT_TYPES.WAY) {
    return {
      provider: QUALITY_PROVIDERS.OVERPASS,
      osmElementType: OSM_ELEMENT_TYPES.WAY,
      geometryQuality: 2,
    };
  }

  if (elementType === OSM_ELEMENT_TYPES.NODE) {
    return {
      provider: QUALITY_PROVIDERS.OVERPASS,
      osmElementType: OSM_ELEMENT_TYPES.NODE,
      geometryQuality: 1,
    };
  }

  if (elementType === OSM_ELEMENT_TYPES.RELATION) {
    return {
      provider: QUALITY_PROVIDERS.OVERPASS,
      osmElementType: OSM_ELEMENT_TYPES.RELATION,
      geometryQuality: 1,
    };
  }

  return {
    provider: QUALITY_PROVIDERS.OVERPASS,
    geometryQuality: 1,
  };
}

/**
 * Grade a Cadastre result
 * Quality = 3 (official polygon boundary)
 */
export function gradeCadastre(): QualitySignals {
  return {
    provider: QUALITY_PROVIDERS.CADASTRE,
    geometryQuality: 3,
  };
}

/**
 * Grade a GTFS bus stop
 * Quality = 3 (official reference data)
 */
export function gradeGtfs(): QualitySignals {
  return {
    provider: QUALITY_PROVIDERS.GTFS,
    geometryQuality: 3,
  };
}

/**
 * Grade an Educational Facility (school/kindergarten)
 * Quality = 3 (official reference data)
 */
export function gradeEducational(): QualitySignals {
  return {
    provider: QUALITY_PROVIDERS.EDUCATIONAL,
    geometryQuality: 3,
  };
}

/**
 * Grade a precomputed GeoJSON source.
 *
 * Derives quality from the source's trust score (from source-trust.ts) so the
 * two configs stay in sync without duplication:
 *   - trust ≥ 0.9 → quality 3 (authoritative official sources)
 *   - trust < 0.9 → quality 2 (trusted but not authoritative, e.g. sensor networks)
 *
 * @param trust - Source trust score (0–1) from getSourceTrust(source).trust
 */
export function gradePrecomputed(trust: number): QualitySignals {
  const geometryQuality: 3 | 2 = trust >= 0.9 ? 3 : 2;

  return {
    provider: QUALITY_PROVIDERS.PRECOMPUTED,
    geometryQuality,
  };
}

/**
 * Default quality when no provider signal available
 */
export function gradeUnknown(): QualitySignals {
  return {
    provider: QUALITY_PROVIDERS.SOURCE,
    geometryQuality: 0,
  };
}
