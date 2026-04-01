/**
 * Source trust configuration for event aggregation.
 *
 * Maps crawler names to trust scores and default geometry quality levels.
 * Trust (0–1): how reliable the source's metadata is.
 * Geometry quality (0–3): default quality of geometry this source produces.
 *   3 = official GeoJSON (precomputed)
 *   2 = geocoded exact address
 *   1 = street / intersection
 *   0 = unknown / no geometry
 */

interface SourceTrustEntry {
  readonly trust: number;
  readonly geometryQuality: number;
}

const SOURCE_TRUST: Record<string, SourceTrustEntry> = {
  // Precomputed GeoJSON sources (quality 3)
  "toplo-bg": { trust: 1.0, geometryQuality: 3 },
  "sofiyska-voda": { trust: 1.0, geometryQuality: 3 },
  "erm-zapad": { trust: 0.9, geometryQuality: 3 },
  "nimh-severe-weather": { trust: 0.9, geometryQuality: 3 },
  "sensor-community": { trust: 0.6, geometryQuality: 3 },

  // Municipality / district websites (geocoded, quality 2)
  "sofia-bg": { trust: 0.8, geometryQuality: 2 },
  "rayon-oborishte-bg": { trust: 0.8, geometryQuality: 2 },
  "mladost-bg": { trust: 0.8, geometryQuality: 2 },
  "studentski-bg": { trust: 0.8, geometryQuality: 2 },
  "sredec-sofia-org": { trust: 0.8, geometryQuality: 2 },
  "so-slatina-org": { trust: 0.8, geometryQuality: 2 },
  "lozenets-sofia-bg": { trust: 0.8, geometryQuality: 2 },
  "raioniskar-bg": { trust: 0.8, geometryQuality: 2 },
  "rayon-ilinden-bg": { trust: 0.8, geometryQuality: 2 },
  "rayon-pancharevo-bg": { trust: 0.8, geometryQuality: 2 },
  "triaditsa-org": { trust: 0.8, geometryQuality: 2 },
  "krasna-polyana-org": { trust: 0.8, geometryQuality: 2 },
  "vrabnitsa-org": { trust: 0.8, geometryQuality: 2 },
  "nadezhda-org": { trust: 0.8, geometryQuality: 2 },
};

const DEFAULT_TRUST: SourceTrustEntry = { trust: 0.5, geometryQuality: 0 };

/** Get trust configuration for a source. Returns defaults for unknown sources. */
export function getSourceTrust(source: string): SourceTrustEntry {
  return SOURCE_TRUST[source] ?? DEFAULT_TRUST;
}

/** Get geometry quality for a source, optionally overridden by precomputed GeoJSON. */
export function getGeometryQuality(
  source: string,
  hasPrecomputedGeoJson: boolean,
): number {
  if (hasPrecomputedGeoJson) return 3;
  return (SOURCE_TRUST[source] ?? DEFAULT_TRUST).geometryQuality;
}
