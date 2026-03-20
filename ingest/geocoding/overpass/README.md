# Overpass/OpenStreetMap Geocoding Service

## Overview

Retrieves street geometries and calculates intersection points from OpenStreetMap data. Used for drawing street sections between cross-streets when infrastructure announcements describe road closures or repairs.

## When Used

- **Street sections** defined by two cross-streets
- **Drawing line geometry** for road closures, repairs, or disruptions
- **Fallback for numbered addresses** when specific building numbers are not available

**Example**: "Ремонт на бул. Витоша между ул. Граф Игнатиев и ул. Московска" → Overpass retrieves OSM geometry for "бул. Витоша", calculates intersections with both cross-streets → LineString segment

## Multiple Servers

Uses fallback chain with 4 OpenStreetMap Overpass servers for reliability:

1. **Primary**: overpass.private.coffee (no rate limit applied)
2. **Fallback servers**: Automatically retried on failure

**Auto-Retry**: Requests failing on primary server automatically retry on fallback servers.

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
