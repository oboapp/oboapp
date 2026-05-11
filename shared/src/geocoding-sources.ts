export type {
  GeocodingResolverConfig,
  GeocodingSourceMetadata,
  OpenDataSource,
} from "./geocoding-source-definition";

import type {
  GeocodingResolverConfig,
  GeocodingSourceMetadata,
  OpenDataSource,
} from "./geocoding-source-definition";

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE ASSEMBLY — replace this file in your fork
// ─────────────────────────────────────────────────────────────────────────────
// This file is the DEMO shipped with the upstream repo. It is configured for
// Sofia, Bulgaria. Replace it in your fork to configure geocoding for your city.
//
// When you fork oboapp for your city:
//   1. Replace this file with your own geocoding configuration.
//   2. Set GEOCODING_RESOLVERS to the providers appropriate for your locality.
//   3. Set GEOCODING_SOURCES to the data sources to display on the web sources page.
//
// See docs/setup/new-locality-instance.md for the full guide.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geocoding resolver configuration — used by ingest to select the right provider
 * per location type. Validated with Zod at ingest startup (fail-fast).
 * Replaces ingest/localities/{locality}.yaml.
 */
export const GEOCODING_RESOLVERS: GeocodingResolverConfig = {
  pins: { provider: "google" },
  streets: { provider: "overpass" },
  "cadastral-properties": { provider: "cadastre" },
  "bus-stops": {
    provider: "gtfs",
    url: "https://gtfs.sofiatraffic.bg/api/v1/static",
  },
  "educational-facilities": {
    provider: "educational-facilities",
    "schools-url": "https://api.sofiaplan.bg/datasets/166",
    "kindergartens-url": "https://api.sofiaplan.bg/datasets/142",
  },
};

/**
 * Open-data sources displayed on the /open-source page.
 * Fork operators replace this with their city's public datasets.
 */
export const OPEN_DATA_SOURCES: readonly OpenDataSource[] = [
  {
    name: "Sofia Traffic GTFS",
    url: "https://gtfs.sofiatraffic.bg",
    description: "спирки и маршрути на градския транспорт",
  },
  {
    name: "Sofia Plan",
    url: "https://sofiaplan.bg",
    description: "училища и детски градини от Столична община",
  },
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    description: "геокодиране и улична геометрия",
  },
  {
    name: "sensor.community",
    url: "https://sensor.community",
    description: "данни за качеството на въздуха от граждански сензори",
  },
];

/**
 * Geocoding source metadata — displayed on the web sources page.
 * Replaces web/lib/geocoding.json.
 */
export const GEOCODING_SOURCES: readonly GeocodingSourceMetadata[] = [
  { id: "google-maps", name: "Google Maps", url: "https://maps.google.com" },
  {
    id: "bulgarian-cadastre",
    name: "КАИС Портал - Агенция по геодезия, картография и кадастър",
    url: "https://kais.cadastre.bg",
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
  },
  {
    id: "gtfs-sofia-traffic",
    name: "Статични GTFS данни - urbandata.sofia.bg / sofiatraffic.bg",
    url: "https://urbandata.sofia.bg/dataset/gtfs-static",
  },
  {
    id: "sofiaplan-educational-facilities",
    name: "Училища и детски градини - urbandata.sofia.bg / sofiaplan.bg",
    url: "https://sofiaplan.bg",
  },
];
