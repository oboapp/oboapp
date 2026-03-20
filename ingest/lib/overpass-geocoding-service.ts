import {
  Address,
  OverpassResponse,
  OverpassGeometry,
  Coordinates,
} from "./types";
import * as turf from "@turf/turf";
import type { Feature, MultiLineString, Position } from "geojson";
import {
  getLocalityBounds,
  getLocalityCenter,
  getLocalityBbox,
} from "./geocoding-utils";
import { isWithinBounds } from "@oboapp/shared";
import { getLocality } from "./target-locality";
import { delay } from "./delay";
import { roundCoordinate } from "@/lib/coordinate-utils";
import { logger } from "@/lib/logger";
import { OverpassMockService } from "../__mocks__/services/overpass-mock-service";

// Check if mocking is enabled
const USE_MOCK = process.env.MOCK_OVERPASS_API === "true";
const mockService = USE_MOCK ? new OverpassMockService() : null;

// Constants for API rate limiting
const OVERPASS_DELAY_MS = 500; // 500ms for Overpass API (generous limits)
const OVERPASS_TIMEOUT_MS = 25000; // 25 seconds timeout for HTTP requests
const BUFFER_DISTANCE_METERS = 30; // Buffer distance for street geometries

/**
 * Parse Overpass XML error response to extract error message
 */
function parseOverpassError(responseText: string): string | null {
  const remarkMatch = /<remark>\s*([\s\S]+?)\s*<\/remark>/.exec(responseText);
  if (remarkMatch) {
    return remarkMatch[1].trim();
  }
  return null;
}

/**
 * Determine if error is client-side (our query problem) or server-side (should retry)
 */
function shouldTryFallback(error: Error, statusCode?: number): boolean {
  const msg = error.message.toLowerCase();

  // Client-side errors (our fault) - don't retry
  if (
    msg.includes("syntax") ||
    msg.includes("parse error") ||
    msg.includes("expected") ||
    msg.includes("unexpected") ||
    msg.includes("invalid")
  ) {
    return false;
  }

  // HTTP 4xx = client error (except 429 Too Many Requests)
  if (
    statusCode &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 429
  ) {
    return false;
  }

  // All other errors = server-side, should retry
  return true;
}

// Multiple Overpass API instances for fallback
const OVERPASS_INSTANCES = [
  "https://overpass.private.coffee/api/interpreter", // No rate limit
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter", // No rate limit (Russia)
  "https://overpass-api.de/api/interpreter", // Main instance (10k queries/day)
  "https://overpass.osm.jp/api/interpreter", // Japan instance
];

/**
 * Normalize street name for better OSM matching
 * - Removes street type prefixes (бул., ул., площад, пл.)
 * - Removes Bulgarian ordinal suffixes from numbers (20-ти → 20, 3-ти → 3)
 * - Removes all quote styles (ASCII and Unicode)
 * - Normalizes whitespace
 */
export function normalizeStreetName(streetName: string): string {
  return streetName
    .toLowerCase()
    .replaceAll(/^(бул\.|ул\.|площад|пл\.)\s*/g, "")
    .replaceAll(/(?<=\d)-(?:ти|ви|и|ри|ма|то)(?=\s|$|[^а-яa-z])/gi, "") // Strip ordinal suffixes: 20-ти → 20
    .replaceAll(/["\u201c\u201d\u201e'`\u2018\u2019\u201a«»‹›]/g, "") // Remove ALL quote styles
    .replaceAll(/\.([а-яa-z])/gi, ". $1") // Space after dot-letter: Г.С.Раковски → Г. С. Раковски
    .replaceAll(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Convert a normalized street name into a flexible Overpass QL regex pattern.
 * Handles OSM naming quirks:
 * - Hyphen spacing: "Данчов-Зографина" query also matches OSM "Данчов - Зографина"
 * - Ordinal suffixes: "20" query also matches OSM "20-ти", "20-ви", etc.
 * - Abbreviated names: "К. Пейчинович" query also matches OSM "Кирил Пейчинович"
 */
export function toOverpassRegex(normalizedName: string): string {
  return (
    normalizedName
      // Allow optional spaces around hyphens between letters
      .replaceAll(/([а-яa-z])-([а-яa-z])/gi, "$1( ?- ?)$2")
      // Allow optional ordinal suffix after numbers
      .replaceAll(/(\d+)/g, "$1(-(ти|ви|и|ри|ма|то))?")
      // Expand single-letter abbreviations: "к. пейчинович" → "к.*\.? пейчинович"
      // Only expands a single letter followed by ". " (not multi-letter abbreviations like "ген.")
      // Uses lookahead (?= ) so consecutive abbreviations like "г. с." both get expanded
      // Optional dot (\.?) allows matching both full and abbreviated OSM names (e.g. "Георги С. Раковски")
      // Uses "." (any char) instead of [а-я] — Overpass POSIX regex doesn't support Cyrillic ranges
      .replaceAll(/(^| )([а-яa-z])\.(?= )/gi, "$1$2.*\\.?")
  );
}

/**
 * Get street geometry from Overpass API (OpenStreetMap)
 * Returns actual LineString geometries from OSM, preserving way structure
 */
async function getStreetGeometryFromOverpass(
  streetName: string,
): Promise<Feature<MultiLineString> | null> {
  try {
    // Normalize street name for better OSM matching
    const normalizedName = normalizeStreetName(streetName);
    const queryRegex = toOverpassRegex(normalizedName);

    // Check if this is a square/plaza (площад/пл.)
    const isSquare = streetName.toLowerCase().match(/^(площад|пл\.)\s*/);

    // Overpass QL query to find the street by name
    // For squares, search for place=square nodes/areas
    // For streets (ул.), include residential roads in addition to main highways
    const isStreet = streetName.toLowerCase().includes("ул.");

    let query: string;

    const bbox = getLocalityBbox();

    if (isSquare) {
      // Search for squares as nodes or ways with place=square
      query = `
        [out:json][timeout:25];
        (
          node["place"="square"]["name"~"${queryRegex}",i](${bbox});
          way["place"="square"]["name"~"${queryRegex}",i](${bbox});
          node["place"="square"]["name:bg"~"${queryRegex}",i](${bbox});
          way["place"="square"]["name:bg"~"${queryRegex}",i](${bbox});
        );
        out geom;
      `;
    } else {
      // Search for streets/boulevards
      const highwayFilter = isStreet
        ? '["highway"~"^(primary|secondary|tertiary|trunk|residential|unclassified|living_street)$"]'
        : '["highway"~"^(primary|secondary|tertiary|trunk)$"]';

      // Use fuzzy matching with regex contains instead of exact match
      query = `
        [out:json][timeout:25];
        (
          way${highwayFilter}["name"~"${queryRegex}",i](${bbox});
          way${highwayFilter}["name:bg"~"${queryRegex}",i](${bbox});
        );
        out geom;
      `;
    }

    // Try each Overpass instance until one works
    let responseData: OverpassResponse | null = null;
    let lastError: Error | null = null;

    for (const instance of OVERPASS_INSTANCES) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        OVERPASS_TIMEOUT_MS,
      );

      try {
        const response = await fetch(instance, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        if (!response.ok) {
          // Try to extract XML error message
          const text = await response.text();
          const errorMsg = parseOverpassError(text) || response.statusText;
          const error = new Error(`HTTP ${response.status}: ${errorMsg}`);

          if (!shouldTryFallback(error, response.status)) {
            // Client-side error - don't try other servers
            clearTimeout(timeoutId);
            logger.error("Client error (query issue)", { errorMsg });
            throw error;
          }

          logger.info("Server error from Overpass instance", {
            hostname: new URL(instance).hostname,
            errorMsg,
          });
          lastError = error;
          clearTimeout(timeoutId);
          continue;
        }

        // Parse JSON defensively - buffer as text first
        const text = await response.text();
        try {
          responseData = JSON.parse(text);
          logger.info("Response from Overpass instance", {
            hostname: new URL(instance).hostname,
          });
        } catch (parseError) {
          // Failed to parse JSON - might be XML error with HTTP 200
          const errorMsg = parseOverpassError(text);
          if (errorMsg) {
            throw new Error(errorMsg);
          }
          // Re-throw the original parse error
          throw parseError;
        }

        clearTimeout(timeoutId);
        break; // Success, exit loop
      } catch (error) {
        clearTimeout(timeoutId);

        const err = error instanceof Error ? error : new Error(String(error));

        // Check if this is a client-side error
        if (!shouldTryFallback(err)) {
          logger.error("Client error (query issue)", { error: err.message });
          throw err;
        }

        // Server-side error or timeout - try next instance
        if (err.name === "AbortError") {
          logger.info("Timeout with Overpass instance", {
            hostname: new URL(instance).hostname,
          });
        } else {
          logger.info("Failed with Overpass instance", {
            hostname: new URL(instance).hostname,
            error: err.message,
          });
        }
        lastError = err;
        continue; // Try next instance
      }
    }

    if (!responseData) {
      throw lastError || new Error("All Overpass instances failed");
    }

    if (!responseData.elements || responseData.elements.length === 0) {
      // No OSM ways found - API request succeeded but no data for this street name
      logger.info("Could not find street in OSM", { streetName });
      return null;
    }

    // Build MultiLineString with each OSM way as a separate LineString
    // For squares (nodes), create a small point geometry
    const lineStrings: Position[][] = [];
    let totalPoints = 0;

    for (const element of responseData.elements) {
      if (
        element.type === "node" &&
        element.lat !== undefined &&
        element.lon !== undefined
      ) {
        // Square represented as a point - create a small box around it
        const lat = element.lat;
        const lon = element.lon;
        const offset = 0.0001; // ~10 meters
        lineStrings.push([
          [lon - offset, lat - offset],
          [lon + offset, lat + offset],
        ]);
        totalPoints += 2;
      } else if (
        element.type === "way" &&
        element.geometry &&
        element.geometry.length >= 2
      ) {
        // Round coordinates to 6 decimal places (≈ 0.1m accuracy)
        const coordinates: Position[] = element.geometry.map(
          (point: OverpassGeometry) => [
            roundCoordinate(point.lon),
            roundCoordinate(point.lat),
          ],
        );
        lineStrings.push(coordinates);
        totalPoints += coordinates.length;
      }
    }

    if (lineStrings.length === 0) {
      logger.info("No valid geometries in response", { streetName });
      return null;
    }

    logger.info("Found way segments", {
      segments: lineStrings.length,
      totalPoints,
      streetName,
    });

    const multiLineString: Feature<MultiLineString> = {
      type: "Feature",
      properties: { name: streetName },
      geometry: {
        type: "MultiLineString",
        coordinates: lineStrings,
      },
    };

    return multiLineString;
  } catch (error) {
    logger.error("Error fetching from Overpass", {
      streetName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Find geometric intersection between two street geometries
 */
function findGeometricIntersection(
  street1: Feature<MultiLineString>,
  street2: Feature<MultiLineString>,
): Coordinates | null {
  try {
    // First, try exact intersection using turf.lineIntersect
    const intersections = turf.lineIntersect(street1, street2);

    if (intersections.features.length > 0) {
      logger.info("Found exact intersections", {
        count: intersections.features.length,
      });

      if (intersections.features.length === 1) {
        const point = intersections.features[0].geometry.coordinates;
        logger.info("Intersection found", {
          lat: point[1].toFixed(6),
          lng: point[0].toFixed(6),
        });
        return { lng: point[0], lat: point[1] };
      }

      // Multiple intersections - use locality center as reference point
      const localityCenter = getLocalityCenter();
      const targetPoint = turf.point([localityCenter.lng, localityCenter.lat]);

      const intersectionsWithDistance = intersections.features.map(
        (feature) => {
          const coords = feature.geometry.coordinates;
          const distance = turf.distance(targetPoint, feature, {
            units: "meters",
          });
          return {
            lat: coords[1],
            lng: coords[0],
            distance: distance,
          };
        },
      );

      // Sort by distance from Sofia center
      intersectionsWithDistance.sort((a, b) => a.distance - b.distance);

      const best = intersectionsWithDistance[0];
      logger.info("Using closest intersection to Sofia center", {
        lat: best.lat.toFixed(6),
        lng: best.lng.toFixed(6),
        distanceMeters: best.distance.toFixed(0),
      });

      return { lng: best.lng, lat: best.lat };
    }

    // If no exact intersection, find nearest points
    logger.info("No exact intersections, finding nearest points");

    // Buffer the streets slightly to account for small gaps
    const buffered1 = turf.buffer(street1, BUFFER_DISTANCE_METERS, {
      units: "meters",
    });
    const buffered2 = turf.buffer(street2, BUFFER_DISTANCE_METERS, {
      units: "meters",
    });

    if (!buffered1 || !buffered2) {
      logger.warn("Could not create buffers");
      return null;
    }

    // Try intersection on buffered geometries
    const bufferedIntersection = turf.intersect(
      turf.featureCollection([buffered1, buffered2]),
    );

    if (bufferedIntersection) {
      const center = turf.center(bufferedIntersection);
      const coords = center.geometry.coordinates;
      logger.info("Found buffered intersection");
      return { lng: coords[0], lat: coords[1] };
    }

    // Last resort: find nearest point between the two lines
    let minDistance = Number.POSITIVE_INFINITY;
    let bestPoint: Coordinates | null = null;

    for (const line1 of street1.geometry.coordinates) {
      for (const line2 of street2.geometry.coordinates) {
        const _lineString1 = turf.lineString(line1);
        const lineString2 = turf.lineString(line2);

        // Sample points along both lines
        for (const point1 of line1) {
          const pt1 = turf.point(point1);
          const nearest = turf.nearestPointOnLine(lineString2, pt1);
          const dist = turf.distance(pt1, nearest, { units: "meters" });

          if (dist < minDistance) {
            minDistance = dist;
            const coords = nearest.geometry.coordinates;
            bestPoint = { lng: coords[0], lat: coords[1] };
          }
        }
      }
    }

    if (bestPoint && minDistance < 200) {
      // 200m threshold
      logger.info("Found nearest point", {
        lat: bestPoint.lat.toFixed(6),
        lng: bestPoint.lng.toFixed(6),
        gapMeters: minDistance.toFixed(1),
      });
      return bestPoint;
    }

    logger.warn("Streets too far apart, no valid intersection", {
      distanceMeters: minDistance.toFixed(1),
    });
    return null;
  } catch (error) {
    logger.error("Error finding intersection", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function geocodeSingleIntersection(
  intersection: string,
): Promise<Address | null> {
  const [street1Name, street2Name] = intersection
    .split("∩")
    .map((s) => s.trim());

  if (!street1Name || !street2Name) {
    logger.error("Invalid intersection format", { intersection });
    return null;
  }

  const geom1 = await getStreetGeometryFromOverpass(street1Name);
  const geom2 = await getStreetGeometryFromOverpass(street2Name);

  if (!geom1 || !geom2) {
    return null;
  }

  const intersectionPoint = findGeometricIntersection(geom1, geom2);

  if (!intersectionPoint) {
    logger.error("Could not find intersection");
    return null;
  }

  return {
    originalText: intersection,
    formattedAddress: intersection,
    coordinates: { lat: intersectionPoint.lat, lng: intersectionPoint.lng },
    geoJson: {
      type: "Point",
      coordinates: [intersectionPoint.lng, intersectionPoint.lat],
    },
  };
}

/**
 * Main geocoding function using Overpass API and Turf.js
 */
export async function overpassGeocodeIntersections(
  intersections: string[],
): Promise<Address[]> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Overpass mock for intersections");
    return mockService.overpassGeocodeIntersections(intersections);
  }

  const results: Address[] = [];

  for (let i = 0; i < intersections.length; i++) {
    const intersection = intersections[i];
    try {
      const result = await geocodeSingleIntersection(intersection);
      if (result) results.push(result);
    } catch (error) {
      logger.error("Error processing intersection", {
        intersection,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Rate limiting between requests
    if (i < intersections.length - 1) {
      await delay(OVERPASS_DELAY_MS);
    }
  }

  return results;
}

/**
 * Get street section geometry between two intersection points
 * Returns the actual OSM geometry of the street segment
 */
export async function getStreetSectionGeometry(
  streetName: string,
  startCoords: Coordinates,
  endCoords: Coordinates,
): Promise<Position[] | null> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Overpass mock for street section geometry");
    return mockService.getStreetSectionGeometry(
      streetName,
      startCoords,
      endCoords,
    );
  }

  try {
    logger.info("Finding street section", {
      streetName,
      from: { lat: startCoords.lat, lng: startCoords.lng },
      to: { lat: endCoords.lat, lng: endCoords.lng },
    });

    // Get full street geometry
    const streetGeometry = await getStreetGeometryFromOverpass(streetName);
    if (!streetGeometry) {
      logger.warn("No geometry found for street", { streetName });
      return null;
    }

    // Create points from coordinates
    const startPoint = turf.point([startCoords.lng, startCoords.lat]);
    const endPoint = turf.point([endCoords.lng, endCoords.lat]);

    // Find which segments contain or are near our start/end points
    const allSegments = streetGeometry.geometry.coordinates;
    let bestSection: Position[] | null = null;
    let minTotalDistance = Infinity;

    // Try each segment as a potential section
    for (const segment of allSegments) {
      if (segment.length < 2) continue;

      const line = turf.lineString(segment);

      // Check if both points are close to this segment
      const startSnapped = turf.nearestPointOnLine(line, startPoint);
      const endSnapped = turf.nearestPointOnLine(line, endPoint);

      const startDist = turf.distance(startPoint, startSnapped, {
        units: "meters",
      });
      const endDist = turf.distance(endPoint, endSnapped, { units: "meters" });

      // If both points are within 50m of this segment, it might be our section
      if (startDist < 50 && endDist < 50) {
        const totalDist = startDist + endDist;

        if (totalDist < minTotalDistance) {
          minTotalDistance = totalDist;

          // Extract the subsection between the two snapped points
          const startIndex = startSnapped.properties.index || 0;
          const endIndex = endSnapped.properties.index || segment.length - 1;

          const minIndex = Math.min(startIndex, endIndex);
          const maxIndex = Math.max(startIndex, endIndex);

          // Extract coordinates between the indices
          let section = segment.slice(minIndex, maxIndex + 2);

          // CRITICAL: Preserve directionality from start→end
          // If startIndex > endIndex, we need to reverse the section
          // to maintain the semantic order (from start coords to end coords)
          if (startIndex > endIndex) {
            section = section.slice().reverse();
          }

          bestSection = section;
        }
      }
    }

    if (bestSection && bestSection.length >= 2) {
      logger.info("Found street section", { points: bestSection.length });
      return bestSection;
    }

    // Fallback: try to connect multiple segments
    logger.info("No single segment found, trying to connect segments");

    // Build a path by connecting segments
    const connectedPath: Position[] = [];
    let currentPoint = startPoint;
    const usedSegments = new Set<number>();

    while (
      connectedPath.length === 0 ||
      turf.distance(
        turf.point(connectedPath[connectedPath.length - 1]),
        endPoint,
        { units: "meters" },
      ) > 10
    ) {
      // Find nearest unused segment to current point
      let nearestSegmentIdx = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < allSegments.length; i++) {
        if (usedSegments.has(i)) continue;

        const segment = allSegments[i];
        if (segment.length < 2) continue;

        const line = turf.lineString(segment);
        const snapped = turf.nearestPointOnLine(line, currentPoint);
        const dist = turf.distance(currentPoint, snapped, { units: "meters" });

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestSegmentIdx = i;
          // nearestSnap = snapped; // unused but kept for potential debugging
        }
      }

      if (nearestSegmentIdx === -1 || nearestDist > 50) {
        logger.info("Cannot connect segments", {
          minDistanceMeters: nearestDist,
        });
        break;
      }

      // Add this segment
      usedSegments.add(nearestSegmentIdx);
      const segment = allSegments[nearestSegmentIdx];

      // Determine direction and add coordinates
      if (connectedPath.length === 0) {
        connectedPath.push(...segment);
      } else {
        // Check if we need to reverse
        const lastPoint = turf.point(connectedPath[connectedPath.length - 1]);
        const segmentStart = turf.point(segment[0]);
        const segmentEnd = turf.point(segment[segment.length - 1]);

        const distToStart = turf.distance(lastPoint, segmentStart, {
          units: "meters",
        });
        const distToEnd = turf.distance(lastPoint, segmentEnd, {
          units: "meters",
        });

        if (distToEnd < distToStart) {
          // Reverse and add
          connectedPath.push(...segment.slice().reverse());
        } else {
          connectedPath.push(...segment);
        }
      }

      currentPoint = turf.point(connectedPath[connectedPath.length - 1]);

      // Safety check
      if (usedSegments.size > 10) {
        logger.info("Too many segments, giving up");
        break;
      }
    }

    if (connectedPath.length >= 2) {
      logger.info("Connected segments into path", {
        segments: usedSegments.size,
        points: connectedPath.length,
      });
      return connectedPath;
    }

    logger.info("Could not extract street section");
    return null;
  } catch (error) {
    logger.error("Error getting street section geometry", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Normalize an address for Nominatim queries
 * - Strips "№" symbol (Nominatim doesn't understand it)
 * - Normalizes whitespace
 */
export function normalizeAddressForNominatim(address: string): string {
  return address.replaceAll(/№\s*/g, "").replaceAll(/\s+/g, " ").trim();
}

/**
 * Geocode a specific address with house number using Nominatim
 */
async function geocodeAddressWithNominatim(
  address: string,
): Promise<Coordinates | null> {
  try {
    const normalizedAddress = normalizeAddressForNominatim(address);

    // Use normalized address with bounded search
    // The bounds parameter limits results to the configured locality
    const fullAddress = normalizedAddress;

    // Add bounded search to locality area and increase limit to filter results
    const bounds = getLocalityBounds();
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      fullAddress,
    )}&format=json&limit=5&addressdetails=1&bounded=1&viewbox=${
      bounds.west
    },${bounds.south},${bounds.east},${bounds.north}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "OborishteMap/1.0",
      },
    });

    if (!response.ok) {
      logger.warn("Nominatim API error", { status: response.status });
      return null;
    }

    const data = await response.json();

    if (data && data.length > 0) {
      // Find first result that is actually within Sofia boundaries
      for (const result of data) {
        const coords = {
          lat: Number.parseFloat(result.lat),
          lng: Number.parseFloat(result.lon),
        };

        // Validate coordinates are within locality
        const locality = getLocality();
        if (isWithinBounds(locality, coords.lat, coords.lng)) {
          logger.info("Nominatim geocoded address", {
            address,
            lat: coords.lat,
            lng: coords.lng,
          });
          return coords;
        }
        logger.warn("Nominatim result outside target locality", {
          address,
          locality,
          lat: coords.lat,
          lng: coords.lng,
        });
      }

      logger.warn("All Nominatim results outside Sofia", { address });
      return null;
    }

    logger.warn("Nominatim found no results", { address });
    return null;
  } catch (error) {
    logger.error("Error geocoding with Nominatim", {
      address,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveSingleAddress(
  address: string,
): Promise<Coordinates | null> {
  // Pattern: "ул. Name Number" or "бул. Name Number"
  const hasNumber = /\d+/.test(address);

  if (hasNumber) {
    logger.info("Geocoding numbered address with Nominatim", { address });
    return geocodeAddressWithNominatim(address);
  }

  // Use Overpass for street names (get center of street)
  const geom = await getStreetGeometryFromOverpass(address);
  if (!geom) return null;

  const centerCoords = turf.center(geom).geometry.coordinates;
  return { lat: centerCoords[1], lng: centerCoords[0] };
}

/**
 * Geocode individual addresses using Overpass API
 */
export async function overpassGeocodeAddresses(
  addresses: string[],
): Promise<Address[]> {
  // Use mock if enabled
  if (USE_MOCK && mockService) {
    logger.info("Using Overpass mock for addresses");
    return mockService.overpassGeocodeAddresses(addresses);
  }

  const results: Address[] = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];

    try {
      const coords = await resolveSingleAddress(address);
      if (coords) {
        results.push({
          originalText: address,
          formattedAddress: address,
          coordinates: coords,
          geoJson: {
            type: "Point",
            coordinates: [coords.lng, coords.lat],
          },
        });
      } else {
        logger.warn("Failed to geocode address", { address });
      }
    } catch (error) {
      logger.error("Error geocoding address", {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Rate limiting
    if (i < addresses.length - 1) {
      await delay(OVERPASS_DELAY_MS);
    }
  }

  return results;
}
