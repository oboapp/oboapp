/**
 * Shared utilities for geocoding services
 */

import { getBoundsForLocality, getCenterForLocality, getBboxForLocality } from "@oboapp/shared";
import { getLocality } from "../../lib/target-locality";

/**
 * Get the current locality's bounds
 */
export function getLocalityBounds() {
  return getBoundsForLocality(getLocality());
}

/**
 * Get the current locality's center
 */
export function getLocalityCenter() {
  return getCenterForLocality(getLocality());
}

/**
 * Get the current locality's bbox
 */
export function getLocalityBbox() {
  return getBboxForLocality(getLocality());
}

/**
 * Check if coordinates match the locality's exact center (rounded to 4 decimal places)
 * This detects Google's fallback to city center when it can't find a specific location
 */
export function isCenterFallback(lat: number, lng: number): boolean {
  const center = getLocalityCenter();
  // Round to 4 decimal places (approximately 11 meters precision)
  const roundedLat = Math.round(lat * 10000) / 10000;
  const roundedLng = Math.round(lng * 10000) / 10000;

  return roundedLat === center.lat && roundedLng === center.lng;
}

/**
 * Check if a formatted address is too generic (city-level only)
 * 
 * TODO: This function needs to be made locality-aware by accepting a locality parameter
 * and checking against that locality's name patterns. For now, disabled to avoid
 * Sofia-specific hardcoding.
 * 
 * @param formattedAddress - The formatted address to check
 * @returns Always returns false (feature disabled until locality-aware implementation)
 */
export function isGenericCityAddress(formattedAddress: string): boolean {
  // Disabled: needs locality-specific configuration
  // Previously checked for Sofia/Plovdiv-only addresses
  return false;
}
