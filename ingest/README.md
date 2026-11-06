# Ingest Pipeline

Data collection and processing pipeline for OboApp. Collects infrastructure disruption notices from public sources (water, heating, road repairs) across Sofia, processes them into geocoded GeoJSON, and delivers notifications to interested users.

## ⚠️ WORKSPACE SETUP

This package is part of a pnpm workspace. **Run `pnpm install` at the repository root**, not in this directory.

The shared package (@oboapp/shared) is built automatically during workspace installation via postinstall hook.

## Pipeline Overview

```mermaid
graph LR
    B[crawl.ts: existing source entrypoints] --> L[Legacy crawler implementations]
    B --> T[Source package adapters]
    T --> R[Simple source runner]
    R --> P[npm source: list and fetch]
    P --> R
    L --> C[(Raw sources via @oboapp/db)]
    R --> C
    C --> D[ingest.ts]
    D --> E[(Firestore: messages)]
    E --> F[notify.ts]
    F --> G[Users via FCM]

    style B fill:#e1f5ff
    style D fill:#e1f5ff
    style F fill:#e1f5ff
```

During the [source-package transition](../docs/features/source-packages.md), the existing command and Cloud Run jobs run either a local crawler or a source package. Migrated sources use package adapters; remaining sources keep their code in `crawlers/`. Both paths feed the same processing pipeline. The package supplies data. Obo's runner handles deduplication, validation, and persistence: it skips known items, checks new content, and saves valid records.

## Components

- **[crawlers/](crawlers/README.md)** - Automated scrapers that fetch raw data from external sources
- **[sources/](sources/run-source.ts)** - Simple scheduled runner for packaged sources
- **[messageIngest/](messageIngest/README.md)** - Processing pipeline: AI extraction → geocoding → GeoJSON conversion
- **[geocoding/](geocoding/README.md)** - Geocoding services (Google, Overpass, Cadastre, GTFS) with persistent cache
- **[notifications/](notifications/README.md)** - Geographic matching and push notification delivery

## Usage

```bash
# Run a specific crawler
pnpm crawl --source rayon-oborishte-bg

# Sync GTFS bus stop data
pnpm gtfs-stops

# Process all sources into messages
pnpm ingest

# Send notifications for new messages
pnpm notify

# Run emergent pipeline (emergent crawlers + ingest + notify)
pnpm pipeline:emergent

# Run full pipeline (all crawlers + ingest + notify)
pnpm pipeline:all

# Generate geocoding frequency report (uploads to GCS)
pnpm geocode-cache:report

# Pre-cache a geocoded address/street from an existing message
pnpm geocode-cache:add --message <id> --address "..." --type pin|street
```

## Pipeline Schedules

The system runs two automated pipelines via Cloud Scheduler:

- **GTFS Sync** (`gtfs-stops`) - Daily at 3:00 AM EET
  - Downloads latest GTFS static data from Sofia Traffic
  - Updates bus stop coordinates in Firestore
  - Enables geocoding of messages containing bus stop codes

- **Educational Facilities Sync** (`educational-facilities-sync`) - Monthly on the 1st at 4:00 AM EET
  - Downloads schools and kindergartens from Sofia open data (sofiaplan.bg)
  - Updates facility coordinates in database
  - Enables geocoding of messages referencing numbered schools and kindergartens

- **Emergent Pipeline** (`pipeline:emergent`) - Every 30 minutes, 7:00AM-10:30PM
  - Crawlers: Sources that publish short-lived disruptions
  - Runs ingest and notify after crawling
  - Handles short-lived messages and emergency works

- **Full Pipeline** (`pipeline:all`) - 3 times daily (10:00, 14:00, 16:00 EET)
  - Crawlers: All sources
  - Runs ingest and notify after crawling
  - Handles regularly scheduled announcements

## Deployment

Dockerized for Google Cloud Run Jobs. See `Dockerfile` and `terraform/` directory.

## Testing Toolchain Note

Both ingest and web use Vitest 4. Ingest runs with the ESM configuration in `vitest.config.mts`; `vitest.config.ts` re-exports it for compatibility. Use `pnpm --dir ingest test:run` for the normal crawler and pipeline suite.

## AI Prompt Evaluation

The three AI pipeline prompts (filter-split, categorize, extract-locations) are evaluated using [promptfoo](https://www.promptfoo.dev/). Eval configs live in `prompts/__evals__/`.

**Prerequisites:** `GOOGLE_AI_API_KEY` and `GOOGLE_AI_MODEL` env vars must be set (same as for integration tests).
