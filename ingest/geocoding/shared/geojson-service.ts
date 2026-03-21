import {
  ExtractedLocations,
  StreetSection,
  GeoJSONFeatureCollection,
  GeoJSONFeature,
  GeoJSONLineString,
  GeoJSONPolygon,
  IntersectionCoordinates,
} from "../../lib/types";
import { getStreetGeometry } from "../router";
import { roundCoordinate } from "./coordinate-utils";
import { logger } from "@/lib/logger";

// Constants for street buffer widths (in meters)
const BUFFER_WIDTH_BOULEVARD = 13; // 12-14m average
const BUFFER_WIDTH_AVENUE = 9; // 8-10m average
const BUFFER_WIDTH_RESIDENTIAL = 7; // 6-8m average

// Step 1 — PIN / Address Geocoding (Points)
function createPinFeature(
  pin: { address: string; timespans: { start: string; end: string | null }[] },
  preGeocodedAddresses: Map<string, IntersectionCoordinates>,
): GeoJSONFeature {
  const coords = preGeocodedAddresses.get(pin.address);

  if (!coords) {
    throw new Error(
      `Missing pre-geocoded coordinates for pin: "${pin.address}"`,
    );
  }

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [coords.lng, coords.lat],
    },
    properties: {
      feature_type: "pin",
      address: pin.address,
      start_time: pin.timespans[0]?.start || "",
      end_time: pin.timespans[0]?.end || "",
      timespans: JSON.stringify(pin.timespans), // Store all timespans as JSON string
    },
  };
}

// Step 2 — Street Centerline Retrieval
async function getStreetCenterline(
  startCoords: IntersectionCoordinates,
  endCoords: IntersectionCoordinates,
  streetName: string,
  hasGeotaggedCoordinates: boolean = false,
): Promise<GeoJSONLineString> {
  // Check if start and end are the same or very close
  const distance = Math.sqrt(
    Math.pow(endCoords.lat - startCoords.lat, 2) +
      Math.pow(endCoords.lng - startCoords.lng, 2),
  );

  // If points are within ~10 meters (roughly 0.0001 degrees), create a simple line
  if (distance < 0.0001) {
    // For a single point, we'll create a small line segment to allow buffering
    // Extend slightly in a default direction (e.g., 10 meters north-south)
    const offsetDegrees = 0.00009; // approximately 10 meters
    return {
      type: "LineString",
      coordinates: [
        [startCoords.lng, startCoords.lat - offsetDegrees / 2],
        [startCoords.lng, startCoords.lat + offsetDegrees / 2],
      ],
    };
  }

  // If both endpoints have geotagged coordinates from the source,
  // draw a straight line instead of querying Overpass for street geometry
  if (hasGeotaggedCoordinates) {
    logger.info(
      "Using straight line for street with geotagged coordinates",
      {
        street: streetName,
      },
    );
    return {
      type: "LineString",
      coordinates: [
        [startCoords.lng, startCoords.lat],
        [endCoords.lng, endCoords.lat],
      ],
    };
  }

  // Use the configured geocoding algorithm via the router
  const geometry = await getStreetGeometry(streetName, startCoords, endCoords);

  if (geometry && geometry.length >= 2) {
    return {
      type: "LineString",
      coordinates: geometry,
    };
  }

  // Fallback to straight line between the two points
  return {
    type: "LineString",
    coordinates: [
      [startCoords.lng, startCoords.lat],
      [endCoords.lng, endCoords.lat],
    ],
  };
}

// Step 3 — Line-to-Polygon Conversion
function bufferLineString(
  lineString: GeoJSONLineString,
  bufferMeters: number = 8,
): GeoJSONPolygon | null {
  const coordinates = lineString.coordinates;
  if (coordinates.length < 2) return null;

  // Convert buffer distance from meters to degrees (approximate)
  // 1 degree of latitude ≈ 111,000 meters
  // At Sofia's latitude (~42.7°), 1 degree of longitude ≈ 82,000 meters
  const bufferDegreesLat = bufferMeters / 111000;
  const bufferDegreesLon = bufferMeters / 82000;

  const leftSide: [number, number][] = [];
  const rightSide: [number, number][] = [];

  for (let i = 0; i < coordinates.length; i++) {
    const [lon, lat] = coordinates[i];

    let perpLon = 0;
    let perpLat = 1;

    if (i < coordinates.length - 1) {
      // Calculate perpendicular direction
      const [nextLon, nextLat] = coordinates[i + 1];
      const dLon = nextLon - lon;
      const dLat = nextLat - lat;
      const length = Math.sqrt(dLon * dLon + dLat * dLat);

      if (length > 0) {
        // Perpendicular vector (rotated 90 degrees)
        perpLon = -dLat / length;
        perpLat = dLon / length;
      }
    } else if (i > 0) {
      // Use previous segment's direction for last point
      const [prevLon, prevLat] = coordinates[i - 1];
      const dLon = lon - prevLon;
      const dLat = lat - prevLat;
      const length = Math.sqrt(dLon * dLon + dLat * dLat);

      if (length > 0) {
        perpLon = -dLat / length;
        perpLat = dLon / length;
      }
    }

    // Apply buffer with proper longitude/latitude scaling
    leftSide.push([
      lon + perpLon * bufferDegreesLon,
      lat + perpLat * bufferDegreesLat,
    ]);
    rightSide.push([
      lon - perpLon * bufferDegreesLon,
      lat - perpLat * bufferDegreesLat,
    ]);
  }

  // Create polygon by combining left side, reversed right side, and closing
  const polygonRing: [number, number][] = [
    ...leftSide,
    ...rightSide.reverse(),
    leftSide[0], // Close the polygon
  ];

  return {
    type: "Polygon",
    coordinates: [polygonRing],
  };
}

// Determine buffer width based on street type
function getBufferWidth(streetName: string): number {
  const lowerStreet = streetName.toLowerCase();

  if (lowerStreet.includes("boulevard") || lowerStreet.includes("булевард")) {
    return BUFFER_WIDTH_BOULEVARD;
  }
  if (
    lowerStreet.includes("avenue") ||
    lowerStreet.includes("проспект") ||
    lowerStreet.includes("collector")
  ) {
    return BUFFER_WIDTH_AVENUE;
  }
  return BUFFER_WIDTH_RESIDENTIAL;
}

// Step 4 — Closure Feature Assembly
async function createClosureFeature(
  street: StreetSection,
  preGeocodedAddresses: Map<string, IntersectionCoordinates>,
): Promise<GeoJSONFeature> {
  // Get pre-geocoded coordinates
  const startCoords = preGeocodedAddresses.get(street.from);
  const endCoords = preGeocodedAddresses.get(street.to);

  if (!startCoords) {
    throw new Error(
      `Missing pre-geocoded coordinates for street start: "${street.from}"`,
    );
  }

  if (!endCoords) {
    throw new Error(
      `Missing pre-geocoded coordinates for street end: "${street.to}"`,
    );
  }

  // Check if both endpoints have geotagged coordinates that were actually validated and used
  // We compare the coordinates we're using with the rounded version of the original geotagged coordinates
  // (since validation rounds to 6 decimal places)
  const hasGeotaggedCoordinates =
    !!street.fromCoordinates &&
    !!street.toCoordinates &&
    roundCoordinate(street.fromCoordinates.lat) === startCoords.lat &&
    roundCoordinate(street.fromCoordinates.lng) === startCoords.lng &&
    roundCoordinate(street.toCoordinates.lat) === endCoords.lat &&
    roundCoordinate(street.toCoordinates.lng) === endCoords.lng;

  // Get centerline
  const centerline = await getStreetCenterline(
    startCoords,
    endCoords,
    street.street,
    hasGeotaggedCoordinates,
  );

  // Convert to polygon
  const bufferWidth = getBufferWidth(street.street);
  const polygon = bufferLineString(centerline, bufferWidth);

  if (!polygon) {
    throw new Error(`Failed to buffer linestring for: ${street.street}`);
  }

  // Assemble feature
  return {
    type: "Feature",
    geometry: polygon,
    properties: {
      feature_type: "street_closure",
      street: street.street,
      from: street.from,
      to: street.to,
      start_time: street.timespans[0]?.start || "",
      end_time: street.timespans[0]?.end || "",
      timespans: JSON.stringify(street.timespans), // Store all timespans as JSON string
    },
  };
}

// Step 5 — Feature Collection Assembly
export async function convertToGeoJSON(
  extractedData: ExtractedLocations,
  preGeocodedAddresses: Map<string, IntersectionCoordinates>,
): Promise<GeoJSONFeatureCollection> {
  const features: GeoJSONFeature[] = [];
  const fallbackPins: typeof extractedData.pins = [];

  // Process all street closures first
  for (const street of extractedData.streets) {
    try {
      const feature = await createClosureFeature(street, preGeocodedAddresses);
      features.push(feature);
    } catch (error) {
      // If street section creation fails, convert endpoints to pins as fallback
      logger.warn("Failed to create street section", {
        street: street.street,
        from: street.from,
        to: street.to,
        error: error instanceof Error ? error.message : String(error),
      });

      const startCoords = preGeocodedAddresses.get(street.from);
      const endCoords = preGeocodedAddresses.get(street.to);

      if (startCoords && endCoords) {
        logger.info(
          "Converting street to 2 fallback pins (both endpoints have coordinates)",
        );

        // Create two pins from the street endpoints
        fallbackPins.push(
          {
            address: street.from,
            timespans: street.timespans,
          },
          {
            address: street.to,
            timespans: street.timespans,
          },
        );
      } else {
        logger.error("Cannot create fallback pins (missing coordinates)", {
          hasFrom: !!startCoords,
          hasTo: !!endCoords,
        });
      }
    }
  }

  // Process all pins (including fallback pins from failed streets)
  const allPins = [...extractedData.pins, ...fallbackPins];
  for (const pin of allPins) {
    try {
      const feature = createPinFeature(pin, preGeocodedAddresses);
      features.push(feature);
    } catch (error) {
      logger.error("Failed to create pin", {
        address: pin.address,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
