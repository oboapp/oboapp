# Google Geocoding Service

## Overview

Converts specific street addresses with building numbers into GPS coordinates for point locations (pins) on the map. Used for precise addresses like "ул. Раковски 35, София" or contact locations in infrastructure announcements.

## When Used

- **Pin locations** with specific building numbers extracted by AI
- **Primary geocoding path** for addresses in `pins[]`
- **Sofia locality restriction** applied to all requests

**Example**: "Аварийни дейности на ул. Иван Вазов 15" → Google geocodes "ул. Иван Вазов 15, София" → Point at (42.6977, 23.3219)

## Validation

**Sofia Locality Filter**: All requests include `components: "locality:Sofia|country:BG"` parameter to restrict results to Sofia, Bulgaria addresses only.

**Boundary Check**: Validates returned coordinates fall within Sofia administrative boundaries using `isWithinSofia()`. Coordinates outside bounds are rejected even if Google returns them.

**Multiple Results**: When Google returns multiple matches, the first result within Sofia boundaries is selected.

## Related Documentation

- [Geocoding Router](../README.md)
- [Message Ingest Pipeline](../../messageIngest/README.md)
