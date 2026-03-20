# Bulgarian Cadastre Geocoding Service

## Overview

Retrieves official property boundaries from the Bulgarian government cadastral system for regulated development zones (УПИ - Урегулиран поземлен имот). Used when infrastructure announcements reference specific cadastral property identifiers.

## When Used

- **Cadastral property identifiers** (УПИ numbers) extracted from announcements
- **Construction/development notices** with legal property boundaries
- **Official property boundaries** needed for accurate mapping

**Example**: "Строителство на УПИ с идентификатор 68134.1601.6124" → Cadastre retrieves polygon boundary from government database → Polygon feature on map

## Session Management

Cadastre API requires multi-step authentication for each request:

1. **Session Initialization**: Retrieve CSRF token from main cadastral portal page
2. **FastSearch**: Initiate УПИ identifier search with session token
3. **ReadFoundObjects**: Retrieve search results
4. **GetGeometry**: Fetch actual polygon geometry

**Session Handling**: New session created for each geocoding request (stateless operation).

## Coordinate Transformation

- **Input Format**: BGS 2005 (EPSG:7801 or EPSG:7802) - Bulgarian national grid system
- **Output Format**: WGS84 (EPSG:4326) - Standard GPS coordinates for mapping
- **Transformation**: Uses proj4 library for coordinate system conversion

**Technical Detail**: Handles Lambert Conformal Conic projection to geographic coordinates.

## Related Documentation

- [Geocoding Router](../README.md)
- [Location Extraction Prompt](../../prompts/extract-locations.md) - УПИ extraction rules
- [Message Ingest Pipeline](../../messageIngest/README.md)
