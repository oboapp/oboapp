import type {
  ArcGisFeature,
  LayerConfig,
  SofiyskaVodaSourceDocument,
} from "./types";
import type { GeoJSONFeature, GeoJSONFeatureCollection } from "@/lib/types";
import {
  sanitizeText,
  ensureDate,
  buildPlainTextMessage,
  buildMarkdownMessage,
} from "./formatters";
import { logger } from "@/lib/logger";

export { buildPlainTextMessage, buildMarkdownMessage } from "./formatters";

const SOURCE_TYPE = "sofiyska-voda";
const LOCALITY = "bg.sofia";
const BASE_URL =
  "https://gispx.sofiyskavoda.bg/arcgis/rest/services/WSI_PUBLIC/InfoCenter_Public/MapServer";

type FeatureProperty = string | number;
type NullableFeatureProperty = FeatureProperty | null;

/**
 * Build URL for a specific feature
 */
export function getFeatureUrl(layerId: number, objectId: number): string {
  return `${BASE_URL}/${layerId}/${objectId}`;
}

/**
 * Build title from feature attributes
 */
export function buildTitle(
  attributes: ArcGisFeature["attributes"],
  layer: LayerConfig,
): string {
  const parts = [
    layer.titlePrefix,
    sanitizeText(attributes?.LOCATION),
    sanitizeText(attributes?.ALERTTYPE),
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  if (parts.length === 0 && attributes?.ALERTID) {
    parts.push(`Инцидент ${attributes.ALERTID}`);
  }

  return (
    parts.join(" – ") ||
    `${layer.titlePrefix} ${attributes?.OBJECTID ?? ""}`.trim()
  );
}

/**
 * Build GeoJSON feature properties
 */
export function buildFeatureProperties(
  attributes: ArcGisFeature["attributes"],
  layer: LayerConfig,
): Record<string, FeatureProperty> {
  const sanitized = (
    value?: NullableFeatureProperty,
  ): NullableFeatureProperty => {
    if (typeof value === "string") {
      return sanitizeText(value);
    }
    return value ?? null;
  };

  const rawEntries: [string, NullableFeatureProperty][] = [
    ["layerId", layer.id],
    ["layerName", layer.name],
    ["titlePrefix", layer.titlePrefix],
    ["alertId", attributes?.ALERTID ?? null],
    ["status", sanitized(attributes?.ACTIVESTATUS) ?? null],
    ["alertType", sanitized(attributes?.ALERTTYPE) ?? null],
    ["location", sanitized(attributes?.LOCATION) ?? null],
    ["district", attributes?.SOFIADISTRICT ?? null],
  ];

  const filteredEntries: [string, FeatureProperty][] = rawEntries
    .filter(
      (entry): entry is [string, FeatureProperty] =>
        entry[1] !== null && entry[1] !== "",
    );

  return Object.fromEntries(filteredEntries);
}

/**
 * Create a FeatureCollection from a single feature
 */
export function createFeatureCollection(
  feature: GeoJSONFeature,
): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [feature],
  };
}

/**
 * Build GeoJSON FeatureCollection from ArcGIS feature
 */
export function buildGeoJsonFeatureCollection(
  feature: ArcGisFeature,
  layer: LayerConfig,
): GeoJSONFeatureCollection | null {
  const geometry = feature.geometry;
  if (!geometry) {
    return null;
  }

  const properties = buildFeatureProperties(feature.attributes ?? {}, layer);

  if (geometry.rings?.length) {
    const coordinates: [number, number][][] = geometry.rings.map((ring) =>
      ring.map((coord): [number, number] => [coord[0], coord[1]]),
    );
    return createFeatureCollection({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates,
      },
      properties,
    });
  }

  if (geometry.paths?.length) {
    const firstPath = geometry.paths.find((path) => path.length > 1);
    if (firstPath) {
      const coordinates: [number, number][] = firstPath.map(
        (coord): [number, number] => [coord[0], coord[1]],
      );
      return createFeatureCollection({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties,
      });
    }
  }

  if (typeof geometry.x === "number" && typeof geometry.y === "number") {
    return createFeatureCollection({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [geometry.x, geometry.y],
      },
      properties,
    });
  }

  return null;
}

/**
 * Build complete SourceDocument from ArcGIS feature
 */
export async function buildSourceDocument(
  feature: ArcGisFeature,
  layer: LayerConfig,
  dateFormatter?: Intl.DateTimeFormat,
): Promise<SofiyskaVodaSourceDocument | null> {
  const objectId = feature.attributes?.OBJECTID;
  if (typeof objectId !== "number") {
    logger.warn("Skipping feature without OBJECTID", { sourceType: SOURCE_TYPE, layerId: layer.id });
    return null;
  }

  const url = getFeatureUrl(layer.id, objectId);
  const attrs: Record<string, unknown> | undefined = feature.attributes
    ? { ...feature.attributes }
    : undefined;
  const message = buildPlainTextMessage(
    attrs,
    layer,
    dateFormatter,
  );
  const markdownText = buildMarkdownMessage(
    attrs,
    layer,
    dateFormatter,
  );
  const geoJson = buildGeoJsonFeatureCollection(feature, layer);
  if (!geoJson) {
    logger.warn("Skipping feature without geometry", { sourceType: SOURCE_TYPE, url });
    return null;
  }
  const lastUpdate =
    ensureDate(feature.attributes?.LASTUPDATE) ??
    ensureDate(feature.attributes?.START_) ??
    new Date();

  // Extract timespans from ArcGIS attributes
  let timespanStart: Date | undefined =
    ensureDate(feature.attributes?.START_) ?? undefined;
  let timespanEnd: Date | undefined =
    ensureDate(feature.attributes?.ALERTEND) ?? undefined;

  // Validate extracted dates (import at top of file)
  const { validateTimespanRange } = await import("@/lib/timespan-utils");
  const isStartValid = timespanStart
    ? validateTimespanRange(timespanStart)
    : false;
  const isEndValid = timespanEnd ? validateTimespanRange(timespanEnd) : false;

  // Use single date for both if only one available and valid
  if (isStartValid && !isEndValid) {
    timespanEnd = timespanStart;
  } else if (!isStartValid && isEndValid) {
    timespanStart = timespanEnd;
  }

  // Fallback to lastUpdate if invalid or missing
  if (!isStartValid || !isEndValid) {
    if (!isStartValid && feature.attributes?.START_) {
      logger.warn("START_ outside valid range", {
        sourceType: SOURCE_TYPE,
        objectId: feature.attributes.OBJECTID,
        startValue: feature.attributes.START_,
      });
    }
    if (!isEndValid && feature.attributes?.ALERTEND) {
      logger.warn("ALERTEND outside valid range", {
        sourceType: SOURCE_TYPE,
        objectId: feature.attributes.OBJECTID,
        alertEnd: feature.attributes.ALERTEND,
      });
    }
    timespanStart = lastUpdate;
    timespanEnd = lastUpdate;
  }

  return {
    url,
    deepLinkUrl: "", // sofiyska-voda URL is an ArcGIS API endpoint, not a user-facing page
    datePublished: lastUpdate.toISOString(),
    title: buildTitle(feature.attributes, layer),
    message,
    markdownText,
    sourceType: SOURCE_TYPE,
    locality: LOCALITY,
    crawledAt: new Date(),
    geoJson,
    categories: ["water"],
    isRelevant: true,
    timespanStart,
    timespanEnd,
  };
}
