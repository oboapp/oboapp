# Geocoding

The router ([`router.ts`](router.ts)) dispatches each location type extracted from a message to the appropriate service:

| Location type            | Service                                | Output    |
| ------------------------ | -------------------------------------- | --------- |
| Specific address (pin)   | [Google](google/README.md)             | Point     |
| Street section           | [Overpass/OSM](overpass/README.md)     | LineString |
| Cadastral property (УПИ) | [Cadastre](cadastre/README.md)         | Polygon   |
| Bus stop code            | GTFS (`gtfs/`)                         | Point     |

All results are validated against the configured locality boundary before use. Results outside the boundary are rejected.

## Geotagged coordinates

Some sources practice [geotagging](https://en.wikipedia.org/wiki/Geotagging) — embedding coordinates directly in their messages (e.g. Rayon Oborishte). When geotagged coordinates are present, geocoding is skipped for that location and the coordinates are used directly.

## Cache

Frequently repeated addresses and streets can be pre-cached in the database to skip API calls entirely. On each ingestion run, the cache is loaded into memory at startup. When a location matches a cached entry, the stored geometry is used directly — no external API call is made.

The cache covers pins (Google Geocoding results) and streets (Overpass geometries). Entries are populated manually via a CLI tool after reviewing a frequency report. See [Geocode Cache](../../docs/features/geocode-cache.md) for the full workflow.

## Event-based skip

When [event matching](../lib/event-matching/) finds a high-quality match before geocoding, the matched event's geometry is reused and all geocoding API calls are skipped.

## Related

- [Message Ingest Pipeline](../messageIngest/README.md)
- [Location Extraction Prompt](../prompts/extract-locations.md)
