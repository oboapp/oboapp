import { GEOCODING_SOURCES, type GeocodingSourceMetadata } from "@oboapp/shared";

type MutableGeocodingSourceMetadata = {
  -readonly [K in keyof GeocodingSourceMetadata]: GeocodingSourceMetadata[K];
};

/**
 * Geocoding sources array re-exported for web consumers.
 * Cloned into fully mutable objects to maintain compatibility
 * with components that expect non-readonly properties.
 */
const geocodingSources: MutableGeocodingSourceMetadata[] = GEOCODING_SOURCES.map((src) => ({
  ...src,
}));

export default geocodingSources;
