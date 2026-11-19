# Locality Configuration

## Overview

The project supports hosting data for a single configurable locality through the `locality` field and environment-based configuration.

## Architecture

### Locality Field

- **Format:** `{country}.{locality}` (e.g., `bg.sofia` for Sofia, Bulgaria)
- **Storage:** Added to both `sources` and `messages` collections in Firestore
- **Collection:** The Obo runner reads `LOCALITY`, checks that the selected package supports it, and writes the locality on new raw records. [Source runner](../../ingest/sources/run-source.ts)

### Environment Configuration

Required environment variables (no defaults):

**Backend/Ingest:**

```bash
LOCALITY=bg.sofia
```

**Frontend/Web:**

```bash
NEXT_PUBLIC_LOCALITY=bg.sofia
```

### Bounds Registry

Bounds are stored in the shared package (`@oboapp/shared`):

```typescript
export const BOUNDS: Record<string, BoundsDefinition> = {
  "bg.sofia": { south: 42.605, west: 23.188, north: 42.83, east: 23.528 },
  // Add new localities here
};
```

### Locality Metadata Registry

Display names and descriptions are stored in the shared package (`@oboapp/shared`):

```typescript
export const LOCALITY_METADATA: Record<string, LocalityMetadata> = {
  "bg.sofia": {
    name: "София", // Display name in local language
    description: "Следи събитията в София", // PWA manifest description
  },
};
```

Functions:

- `getLocalityMetadata(locality)` - Get full metadata object
- `getLocalityName(locality)` - Get display name
- `getLocalityDescription(locality)` - Get description (with fallback)

These are used for:

- PWA manifest generation (`/manifest.json`)
- Page metadata and SEO

### GeoJSON Files

Each locality requires a corresponding GeoJSON file for locality-wide messages:

- Naming convention: `{locality}.geojson` (e.g., `bg.sofia.geojson`)
- Location: `ingest/localities/` directory
- Used by notification matching for locality-wide messages

## Adding a New Locality

1. **Add bounds and center** in `shared/src/bounds.ts`:

   ```typescript
   export const BOUNDS: Record<string, BoundsDefinition> = {
     "bg.sofia": {
       /* existing */
     },
     "bg.plovdiv": { north: 42.2, south: 42.1, east: 24.85, west: 24.7 },
   };

   export const CENTERS: Record<string, { lat: number; lng: number }> = {
     "bg.sofia": {
       /* existing */
     },
     "bg.plovdiv": { lat: 42.1354, lng: 24.7453 },
   };
   ```

2. **Add locality metadata** in `shared/src/bounds.ts`:

   ```typescript
   export const LOCALITY_METADATA: Record<string, LocalityMetadata> = {
     "bg.sofia": {
       /* existing */
     },
     "bg.plovdiv": {
       name: "Пловдив",
       description: "Следи събитията в Пловдив",
     },
   };
   ```

3. **Create GeoJSON file** at `ingest/localities/bg.plovdiv.geojson` containing the administrative boundary as a FeatureCollection

4. **Create a locality context file** at `ingest/prompts/localities/bg.plovdiv.yaml` with the following fields:
   - `city`, `country`, `primary-language`
   - `districts` — list of residential complexes, quarters, and industrial zones sourced from OpenStreetMap
   - `address-hints` — address format notes injected into AI prompts for geocoding

5. **Select supported provider packages.** Check that each package declares `bg.plovdiv` in its metadata. Connect its adapter, select its source definition in `shared/src/sources.ts`, and add the matching job to `ingest/terraform/source-jobs.bg.plovdiv.json`. [Source package integration](source-packages.md) · [New locality setup](../setup/new-locality-instance.md)

6. **Set environment variables**:
   ```bash
   LOCALITY=bg.plovdiv                    # Backend/Ingest
   NEXT_PUBLIC_LOCALITY=bg.plovdiv        # Frontend/Web
   ```

## Migration

The [locality backfill script](../../db/migrate/2026-02-10-add-locality-field.ts) runs from the `db/` directory.

- Backfills `locality: "bg.sofia"` to all existing records
- Safe to run multiple times (skips records that already have locality)
- From the repository root, run `pnpm --dir db exec tsx migrate/2026-02-10-add-locality-field.ts`.
