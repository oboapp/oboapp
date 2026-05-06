/**
 * Source trust configuration for event aggregation.
 *
 * Maps crawler names to trust scores.
 * Trust (0–1): how reliable the source's metadata is (used for embedding selection).
 *
 * NOTE: Geometry quality is now derived per-feature from geocoder provider signals.
 * This was previously hardcoded per-source; decoupling allows per-feature precision.
 */

interface SourceTrustEntry {
  readonly trust: number;
}

const SOURCE_TRUST: Record<string, SourceTrustEntry> = {
  // Precomputed GeoJSON sources
  "toplo-bg": { trust: 1.0 },
  "sofiyska-voda": { trust: 1.0 },
  "erm-zapad": { trust: 0.9 },
  "nimh-severe-weather": { trust: 0.9 },
  "sensor-community": { trust: 0.6 },

  // Municipality / district websites (non-precomputed, will be geocoded)
  "sofia-bg": { trust: 0.8 },
  "rayon-oborishte-bg": { trust: 0.8 },
  "mladost-bg": { trust: 0.8 },
  "studentski-bg": { trust: 0.8 },
  "sredec-sofia-org": { trust: 0.8 },
  "so-slatina-org": { trust: 0.8 },
  "lozenets-sofia-bg": { trust: 0.8 },
  "raioniskar-bg": { trust: 0.8 },
  "rayon-ilinden-bg": { trust: 0.8 },
  "rayon-pancharevo-bg": { trust: 0.8 },
  "triaditsa-org": { trust: 0.8 },
  "krasna-polyana-org": { trust: 0.8 },
  "vrabnitsa-org": { trust: 0.8 },
  "nadezhda-org": { trust: 0.8 },
  "inspectorat-so-org": { trust: 0.8 },
};

const DEFAULT_TRUST: SourceTrustEntry = { trust: 0.5 };

/** Get trust configuration for a source. Returns defaults for unknown sources. */
export function getSourceTrust(source: string): SourceTrustEntry {
  return SOURCE_TRUST[source] ?? DEFAULT_TRUST;
}
