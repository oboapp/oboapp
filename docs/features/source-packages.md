# Source package migration

Tracking: [#586](https://github.com/oboapp/oboapp/issues/586). Packages live in [oboapp/sources](https://github.com/oboapp/sources). Prefer a small, readable integration over infrastructure that has no demonstrated need.

## Scheduled source runner

`runSource` in `ingest/sources/run-source.ts` receives the database from `getDb()`, package metadata, and a `CreateSource` factory. Load environment variables before obtaining the database. The runner validates `LOCALITY` against the package metadata and creates one source instance for the scan.

The flow is: list candidates, skip identifiers already stored, fetch new content, validate it, and save a complete raw document. Pagination stays in memory within the run. Items are processed sequentially so sources can reuse browser sessions and enforce their provider's rate limits. The source is closed in `finally`.

Historical base64 and MD5 lookups remain supported. Identifiers are preserved byte for byte. A create-only write prevents overlapping scans from overwriting an existing raw record or resetting its processing state. Obo owns source ID, locality, URL, crawl timestamp, and `processed=false`; package content cannot override those fields. Dates and GeoJSON are converted to the existing raw-ingest representation. Invalid content never creates a partial raw record.

An individual lookup, fetch, validation, or save failure is logged and counted while other items continue. The caller receives saved/skipped/failed totals. Listing failures and repeated pagination cursors fail the run. A later scheduled scan starts listing again, skips successful items, and retries missing items that are still available. An item can be missed if it disappears before a successful fetch; this is an accepted limitation of the initial migration.

There is no pending-work collection, persisted cursor, lease, or separate fetch service. `discoverItems` is simply the package operation that lists candidates. `fetchItem` can transform listing payload directly for full-content feeds or synthetic identifiers; it need not make another request.

Existing crawlers remain active until their individual pilot cutovers. Preserve each source's output, schedule, and special legacy deduplication, including Sofia's title fallback, before switching it. Do not run legacy and packaged implementations for the same source during cutover. Package upgrades never trigger refetching old identifiers.

## Existing atomic database primitive

`DbClient.compareAndUpdate(collection, id, tokenField, expectedToken, data)` was added before the runner was simplified. The runner does not use it. It remains available for callers that actually require an atomic string-token comparison.

Firestore compares and writes in a transaction; MongoDB uses a conditional update without upsert. A missing record or stale token returns false. In dual-write mode only the primary decides success, and successful updates replicate best-effort. This is not a distributed transaction. Adapter tests mock the storage boundaries; they are not database-backed concurrency tests.
