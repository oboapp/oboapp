import { GeoJsonFeatureCollection } from "@oboapp/shared";

/**
 * Aggregate geometry quality across all features in a GeoJSON feature collection.
 *
 * Uses conservative min() rule: the overall message quality is the minimum quality
 * of all its features. This ensures we only trust the message at the level of the
 * weakest link.
 *
 * Non-integer quality values are floored (conservative). If no features carry a
 * quality stamp (legacy / external GeoJSON), `ungradedFallback` is returned instead
 * of 0 so that existing geometry is not silently degraded.
 *
 * @param geoJson - GeoJSON feature collection with geometryQuality in feature.properties
 * @param ungradedFallback - Value to return when features exist but none are graded (default 0)
 * @returns Aggregated geometry quality (0–3), or 0 if no features
 */
export function aggregateMessageGeometryQuality(
  geoJson: GeoJsonFeatureCollection | null | undefined,
  ungradedFallback = 0,
): number {
  if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
    return 0; // No geometry
  }

  let minQuality: number | null = null;
  let anyGraded = false;

  for (const feature of geoJson.features) {
    const quality = feature.properties?.geometryQuality;
    const hasQualityKey = quality !== undefined;
    const isValid = typeof quality === "number" && isFinite(quality);
    const effectiveQuality = isValid
      ? Math.min(3, Math.max(0, Math.floor(quality)))
      : 0;
    // Treat any feature with a geometryQuality key as graded, even if the value is
    // invalid (string/NaN/Infinity). Invalid values clamp to 0 rather than triggering
    // the legacy ungradedFallback, preventing corrupt data from appearing high-quality.
    if (hasQualityKey) anyGraded = true;
    if (minQuality === null) {
      minQuality = effectiveQuality;
    } else {
      minQuality = Math.min(minQuality, effectiveQuality);
    }
  }

  // Features exist but none carry quality stamps (legacy / external GeoJSON)
  if (!anyGraded) {
    return ungradedFallback;
  }

  return minQuality ?? 0;
}
