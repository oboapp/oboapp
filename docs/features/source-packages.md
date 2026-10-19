# Source package migration

Tracking: [#586](https://github.com/oboapp/oboapp/issues/586). The independently versioned SDK lives in [oboapp/sources](https://github.com/oboapp/sources). Existing crawlers remain active while additive prerequisites land; package versions do not trigger refetching historical identifiers.

## Durable discovery registration

`openDiscoveryCheckpoint` and `registerDiscoveryPage` in `ingest/sources/register-discovery.ts` prepare the platform side of the SDK contract. Callers supply the selected package's metadata, a supported locality, and the database obtained through `getDb()` after environment loading. No existing scheduler calls these helpers yet.

Checkpoints are scoped by source ID and locality and stored in `sourceDiscovery`. Pending references live in `sourceWork`, without a `processed` field. Registration never writes incomplete documents to the raw `sources` collection, so existing ingestion cannot mistake pending work for raw content.

The complete page is validated before any item is registered. Limits are 500 items and 1 MiB of prepared JSON per page, 256 KiB per discovery payload, 8 KiB per identifier, and 4 KiB per cursor/revision. Source IDs are limited to 128 UTF-8 bytes. These are rejection boundaries: identifiers and payloads are never silently truncated or normalized. Sources must return smaller pages when necessary.

Each identifier is checked against both historical base64 and MD5 raw-document IDs, regardless of processing state. New references are atomically created under the existing MD5 identifier convention. Rediscovery retains original pending context; provider revisions and package changes do not overwrite it. Once all items are registered or known, a conditional update rotates the checkpoint token and advances its cursor. An omitted next cursor completes the scan and stores `null`; an empty string remains a valid opaque cursor.

If a page fails partway through, its checkpoint remains unchanged. Replaying it safely skips already registered items. Concurrent callers can register the same references, but only one can advance a given checkpoint token. A caller that loses the token must reload before continuing.

This slice does not fetch or activate sources. Sofia's additional legacy-title lookup must be integrated before its migration, and cutover must avoid running old/new implementations for the same source simultaneously. Database-backed concurrency checks remain required before the first pilot becomes active.

## Atomic worker claims

`DbClient.compareAndUpdate(collection, id, tokenField, expectedToken, data)` atomically compares a top-level string field and merges a plain update only when it matches. It returns `false` for a missing document, absent/non-string field, or stale token. Database errors propagate. Token comparisons are case-sensitive, including on MongoDB collections with a different default collation. Updates cannot contain operators, dotted fields, `_id`, or top-level undefined values.

Firestore performs the comparison and write inside a transaction. MongoDB uses a single conditional update without upsert. A future source worker can read a pending record, check its lease time, then claim it by comparing its current token and writing a fresh unique token with its new lease. Every claim, renewal, completion, and reclamation must rotate or check that token as appropriate so a stale worker cannot mutate a newer claim. The primitive itself does not implement leases, retry policy, or a queue.

The capability is optional on `DbClient` for compatibility with existing custom adapters. All built-in adapters implement it. Queue code must explicitly require it and fail closed when absent; a separate read followed by `updateOne` is not a safe fallback.

In dual-write mode, only the configured primary decides whether a conditional update succeeds. A rejected or failed primary write never reaches the secondary. After success, the secondary receives the plain update on a best-effort basis, consistent with existing dual-write behavior; a secondary failure is logged and does not undo the primary claim. This is not a distributed transaction. Workers must use one authoritative backend, and switching `DB_READ_SOURCE` requires stopping/draining workers and reconciling pending state first. The secondary must not independently grant claims.

The adapter tests use mocked storage boundaries to verify transactional/conditional writes, stale-token behavior, error propagation, and dual-write routing. They are not emulator-backed concurrency tests. The queue slice must add page replay, lease recovery, and stale-worker integration coverage before activating a packaged source.
