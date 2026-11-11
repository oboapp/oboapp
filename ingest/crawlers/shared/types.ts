export interface BaseSourceDocument {
  url: string;
  datePublished: string;
  title: string;
  message: string;
  sourceType: string;
  crawledAt: Date;
  markdownText?: string; // Optional markdown-formatted message for display
  timespanStart?: Date; // Optional - for precomputed sources with temporal data
  timespanEnd?: Date; // Optional - for precomputed sources with temporal data
  locality: string; // Locality identifier (e.g., 'bg.sofia')
}

export interface SourceDocumentWithGeoJson extends BaseSourceDocument {
  geoJson: import("../../lib/types").GeoJSONFeatureCollection | string;
  markdownText: string; // Required for crawlers with precomputed GeoJSON
  categories: string[];
  isRelevant: boolean;
  deepLinkUrl?: string; // User-facing URL for the source. Empty string = no deeplink. Omit to use url field.
}

/**
 * Post link extracted from a legacy crawler's index or listing page.
 */
export interface PostLink {
  url: string;
  title: string;
  date: string;
  time?: string; // Optional provider time supplied separately from the date.
}
