# Overpass/OpenStreetMap Geocoding Service

## Overview

Retrieves street geometries and calculates intersection points from OpenStreetMap data. Used for drawing street sections between cross-streets when infrastructure announcements describe road closures or repairs.

## When Used

- **Street sections** defined by two cross-streets
- **Drawing line geometry** for road closures, repairs, or disruptions
- **Fallback for numbered addresses** when specific building numbers are not available

**Example**: "Ремонт на бул. Витоша между ул. Граф Игнатиев и ул. Московска" → Overpass retrieves OSM geometry for "бул. Витоша", calculates intersections with both cross-streets → LineString segment

## Multiple Servers

Uses a two-instance fallback chain for reliability:

1. **Primary**: overpass.private.coffee (no rate limit applied)
2. **Fallback**: overpass-api.de (main instance, ~10k queries/day)

Requests failing on the primary server automatically fall through to the fallback.

## Adaptive Retry Policy

For transient failures on a single instance (429 Too Many Requests or request timeouts), the service retries the **same instance** up to `OVERPASS_RETRY_MAX_ATTEMPTS = 3` times before falling back to the next instance.

**Backoff**: exponential with ±25% jitter, starting at 1 s, capped at 30 s.

```
attempt 1 → fail → wait ~1s
attempt 2 → fail → wait ~2s
attempt 3 → fail → move to next instance
```

**`Retry-After` header**: honoured on 429 responses (supports both delta-seconds and HTTP-date formats, capped at 30 s).

Other transient errors (5xx, network errors) skip per-instance retry and immediately try the next instance.

## Run-Scoped Circuit Breaker

To prevent a saturated run from hammering Overpass with hundreds of failing requests, each geocoding run tracks consecutive transient failures via `AsyncLocalStorage`.

After **`CIRCUIT_BREAKER_THRESHOLD = 5`** consecutive transient failures:

- The circuit opens for the current run.
- Subsequent street geometry lookups are **deferred** (no network call) until the retry pass.
- The circuit **resets** on the first successful response.

The two-pass structure of `overpassGeocodeIntersections` naturally accommodates this: the first pass collects deferred streets, the circuit resets, and deferred streets are retried in the second pass.

Cached streets (already in memory from a previous lookup) are **always served** regardless of circuit state — no network call needed.

## Street Name Normalization

Automatically normalizes Bulgarian street prefixes for better OSM matching:

- **Prefixes handled**: "бул." (boulevard), "ул." (street), "площад" (square), "пл." (square)
- **Quote removal**: Strips quotation marks for cleaner matches
- **Fuzzy matching**: Attempts variations when exact match fails

**Example**: Input "ул. „Граф Игнатиев"" → Normalized "Граф Игнатиев" → OSM match

## Intersection Calculation

**Geometric Intersection**: Calculates where two street geometries intersect using spatial analysis.

**Buffer Zones**: Applies 30-meter buffer when streets don't geometrically intersect but pass near each other (configurable via `BUFFER_DISTANCE_METERS`).

**Nearest Points**: Falls back to nearest point calculation when streets are too far apart (>200m threshold).

## Nominatim Fallback

When numbered addresses are available but Google geocoding is not used, Overpass falls back to Nominatim geocoding service:

- **5 result limit** with Sofia filtering
- **Boundary validation** applied to results
- **Use case**: Addresses with building numbers when Google API unavailable

## Related Documentation

- [Geocoding Router](../README.md)
- [Message Ingest Pipeline](../../messageIngest/README.md)
