import { Address } from "./types";
import { isCenterFallback, isGenericCityAddress } from "./geocoding-utils";
import { isWithinBounds } from "@oboapp/shared";
import { getLocality } from "./target-locality";
import { delay } from "./delay";
import { logger } from "@/lib/logger";
import { GoogleGeocodingMockService } from "../__mocks__/services/google-geocoding-mock-service";
import { overpassGeocodeAddresses } from "./overpass-geocoding-service";

// Check if mocking is enabled
const USE_MOCK = process.env.MOCK_GOOGLE_GEOCODING === "true";
const mockService = USE_MOCK ? new GoogleGeocodingMockService() : null;

// Constants for API rate limiting
const GEOCODING_BATCH_DELAY_MS = 200;

export async function geocodeAddress(address: string): Promise<Address | null> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Google Geocoding mock", { address });
    return mockService.geocodeAddress(address);
  }

  try {
    const locality = getLocality();
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const encodedAddress = encodeURIComponent(`${address}, Sofia, Bulgaria`);
    // Use components parameter to restrict to Sofia (locality)
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&components=locality:Sofia|country:BG&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.results && data.results.length > 0) {
      // Try to find a result within the target city's boundaries
      for (const result of data.results) {
        const lat = result.geometry.location.lat;
        const lng = result.geometry.location.lng;
        const formattedAddress = result.formatted_address;

        // Reject results that match city center exactly (Google's fallback)
        if (isCenterFallback(lat, lng)) {
          logger.warn("Result is city center generic fallback, rejecting", {
            address,
            lat: lat.toFixed(6),
            lng: lng.toFixed(6),
          });
          continue;
        }

        // Reject generic city-level addresses (e.g., "Sofia, Bulgaria")
        if (isGenericCityAddress(formattedAddress)) {
          logger.warn("Rejecting generic address", {
            address,
            formattedAddress,
          });
          continue;
        }

        // Validate that the result is actually within the locality's boundaries
        if (isWithinBounds(locality, lat, lng)) {
          return {
            originalText: address,
            formattedAddress: result.formatted_address,
            coordinates: { lat, lng },
            geoJson: {
              type: "Point",
              coordinates: [lng, lat],
            },
          };
        }
        logger.warn("Result is outside locality boundaries", {
          address,
          locality,
          lat: lat.toFixed(6),
          lng: lng.toFixed(6),
        });
      }

      // All results were outside the locality's boundaries
      logger.warn("No results found within locality boundaries", {
        address,
        locality,
      });
      return null;
    }

    return null;
  } catch (error) {
    logger.error("Error geocoding address", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function geocodeAddresses(
  addresses: string[],
): Promise<Address[]> {
  const geocodedAddresses: Address[] = [];
  const failedAddresses: string[] = [];

  for (const address of addresses) {
    const geocoded = await geocodeAddress(address);

    if (geocoded) {
      geocodedAddresses.push(geocoded);
    } else {
      logger.info(
        "Failed to geocode address via Google; will try OSM fallback",
        { address },
      );
      failedAddresses.push(address);
    }
    // Add a small delay to avoid hitting rate limits
    await delay(GEOCODING_BATCH_DELAY_MS);
  }

  // Fallback: try OSM/Overpass for addresses that Google couldn't resolve
  if (failedAddresses.length > 0) {
    logger.info("Attempting OSM/Overpass fallback for failed addresses", {
      count: failedAddresses.length,
    });
    const overpassResults = await overpassGeocodeAddresses(failedAddresses);

    const locality = getLocality();
    const boundedOverpassResults = overpassResults.filter((result) => {
      const within = isWithinBounds(
        locality,
        result.coordinates.lat,
        result.coordinates.lng,
      );
      if (!within) {
        logger.warn("Dropping OSM/Overpass result outside locality bounds", {
          address: result.originalText,
          lat: result.coordinates.lat,
          lng: result.coordinates.lng,
        });
      }
      return within;
    });

    geocodedAddresses.push(...boundedOverpassResults);

    const overpassResolved = new Set(
      boundedOverpassResults.map((r) => r.originalText),
    );
    const stillFailedAddresses = failedAddresses.filter(
      (a) => !overpassResolved.has(a),
    );
    if (stillFailedAddresses.length > 0) {
      logger.warn("Addresses failed both Google and OSM/Overpass fallback", {
        count: stillFailedAddresses.length,
        addresses: stillFailedAddresses,
      });
    }
  }

  return geocodedAddresses;
}
