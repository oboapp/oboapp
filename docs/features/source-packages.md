# Source package migration

Tracking: [#586](https://github.com/oboapp/oboapp/issues/586). Packages live in [oboapp/sources](https://github.com/oboapp/sources). Prefer a small, readable integration over infrastructure that has no demonstrated need.

## Current transition state

Triaditsa, Oborishte and Slatina use published source packages. Triaditsa was first piloted in [vbuch/oboapp PR #29](https://github.com/vbuch/oboapp/pull/29). Both collection paths remain in use during migration.

| Responsibility | Legacy sources | Packaged sources |
| --- | --- | --- |
| Provider parsing and content conversion | `ingest/crawlers/{id}/` and local helpers | `@oboapp/source-triaditsa-org@0.2.0`, `@oboapp/source-rayon-oborishte-bg@0.1.0` and `@oboapp/source-so-slatina-org@0.1.0` in the sources repository |
| Database lookup and raw persistence | Legacy crawler helpers in Obo | `ingest/sources/run-source.ts` in Obo |
| Scheduled entrypoint | Existing `crawl --source {id}` job | Same job and command, with an adapter in `crawlers/{id}/index.ts` |
| Web catalog and deployment selection | Instance source assembly (`shared/src/sources.ts`) and Terraform | The same instance assembly and Terraform configuration |
| Processing after collection | Existing raw-source ingestion, event matching, notifications | The same processing pipeline |

```mermaid
flowchart TD
    job[Existing scheduled source job] --> entry[crawl --source ID]
    entry -->|Other sources| legacy[Legacy crawler and local helpers]
    entry -->|Packaged sources| adapter[Package adapter]
    adapter --> runner[Simple Obo runner]
    runner -->|List and fetch| package[npm source package]
    package -->|Identifiers and content| runner
    legacy --> raw[(Complete raw sources via @oboapp/db)]
    runner --> raw
    raw --> ingest[Existing ingestion and event matching]
    ingest --> notify[Existing notifications]
```

Each source uses one collection path. Text sources continue through AI extraction and geocoding; sources with precomputed GeoJSON use their existing processing path.

The current deployment image includes legacy crawler code. Developers update the source catalog and Terraform lists by hand. A later stage will build these lists from installed packages and include only selected sources in the image.

## Scheduled source runner

`runSource` in `ingest/sources/run-source.ts` receives the database from `getDb()`, package metadata, and a `CreateSource` factory. Load environment variables before obtaining the database. The runner validates `LOCALITY` against the package metadata and creates one source instance for the scan.

The flow is: list candidates, skip identifiers already stored, fetch new content, validate it, and save a complete raw document. Pagination stays in memory within the run. Items are processed sequentially so sources can reuse browser sessions and enforce their provider's rate limits. The source is closed in `finally`.

Historical base64 and MD5 lookups remain supported. Identifiers are preserved byte for byte. A create-only write prevents overlapping scans from overwriting an existing raw record or resetting its processing state. Obo owns source ID, locality, URL, crawl timestamp, and `processed=false`; package content cannot override those fields. Dates and GeoJSON are converted to the existing raw-ingest representation. Invalid content never creates a partial raw record.

An individual lookup, fetch, validation, or save failure is logged and counted while other items continue. The caller receives saved/skipped/failed totals. Listing failures and repeated pagination cursors fail the run. A later scheduled scan starts listing again, skips successful items, and retries missing items that are still available. An item can be missed if it disappears before a successful fetch; this is an accepted limitation of the initial migration.

`discoverItems` lists candidates. `fetchItem` returns their content; full-content feeds and synthetic-identifier sources can supply it directly from the listing payload. The runner handles both operations within the scheduled scan.

Triaditsa, Oborishte and Slatina delegate from their existing entrypoints to their respective packages through the runner. Their Cloud Run jobs, schedules, catalog entries, and source identities stay unchanged. Other crawlers retain their existing implementation until their individual cutovers. Preserve each source's special legacy deduplication, including Sofia's title fallback, before switching it. Package upgrades never trigger refetching old identifiers.

Oborishte and Slatina use RSS for discovery and a reused Chromium browser for article details. Their package versions use Playwright 1.61.1. The ingest image must include the matching browser revision. Their handoff tests cover historical base64 and MD5 identifiers, repeat scans and retry after a page failure.

## Trying the Triaditsa pilot

With the normal ingest environment configured (`LOCALITY=bg.sofia` and database credentials), run `pnpm --dir ingest crawl --source triaditsa-org`. This scan writes new raw records and logs saved/skipped/failed totals. Existing records should be skipped on a second run. Use the existing Triaditsa job as the single scheduled entrypoint.

The source package uses the same RSS Accept header as the shared RSS fetcher. Its own tests compare output against a fixture captured from the legacy parser and Markdown conversion. To roll back, revert the pilot switch commit and redeploy the previous entrypoint. Existing stored records remain valid.

Version `0.2.0` collects the News feed and `https://triaditza.org/feed/?post_type=announcements`. It deduplicates shared URLs, preserves publication dates and document links, and removes embedded styles and scripts from Markdown. Obo's handoff test covers both feeds reaching ingestion and repeat scans skipping stored items.

## Moving the next source

1. Add contract tests for the source's existing identifiers, content, locality, schedule, and historical lookup rules. Include provider fixes made in the deployment fork.
2. Move the code that reads and converts provider data into the package. Provide separate runtime and metadata entrypoints so the web app can load catalog metadata on its own. Keep database access in Obo.
3. Publish and check the reviewed package. Set its exact version in an Obo integration PR. Replace the existing entrypoint with an adapter that calls the package through the runner. Then remove the old local source code.
4. Test the full path from the package through raw storage to ingestion. Check that known items are skipped and failures are handled. Keep the existing scheduled job.
5. Deploy the integration, inspect the source job's saved/skipped/failed totals, and confirm repeat scans skip known records. Record the migrated source in this guide and update diagrams when the architecture changes.

Parser fixes belong in the source package; runner and ingestion fixes belong in Obo. Package publication and Obo deployment are separate steps. Once all sources use packages and share one configuration, update this guide and its diagrams to show the completed migration.

## Existing atomic database primitive

`DbClient.compareAndUpdate(collection, id, tokenField, expectedToken, data)` was added before the runner was simplified. The runner does not use it. It remains available for callers that actually require an atomic string-token comparison.

Firestore compares and writes in a transaction; MongoDB uses a conditional update without upsert. A missing record or stale token returns false. In dual-write mode only the primary decides success, and successful updates replicate best-effort. This is not a distributed transaction. Adapter tests mock the storage boundaries; they are not database-backed concurrency tests.
