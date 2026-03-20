# Geocoding

The router ([`router.ts`](router.ts)) dispatches each location type extracted from a message to the appropriate service:

| Location type            | Service                                | Output    |
| ------------------------ | -------------------------------------- | --------- |
| Specific address (pin)   | [Google](google/README.md)             | Point     |
| Street section           | [Overpass/OSM](overpass/README.md)     | LineString |
| Cadastral property (УПИ) | [Cadastre](cadastre/README.md)         | Polygon   |
| Bus stop code            | GTFS (`gtfs/`)                         | Point     |

All results are validated against the configured locality boundary before use. Results outside the boundary are rejected.

## Pre-resolved coordinates

When the source already includes coordinates (e.g. Rayon Oborishte messages), geocoding is skipped for that location and the coordinates are used directly.

## Event-based skip

When [event matching](../lib/event-matching/) finds a high-quality match before geocoding, the matched event's geometry is reused and all geocoding API calls are skipped.

## Related

- [Message Ingest Pipeline](../messageIngest/README.md)
- [Location Extraction Prompt](../prompts/extract-locations.md)
