# Source package migration

Tracking: [#586](https://github.com/oboapp/oboapp/issues/586). The independently versioned SDK lives in [oboapp/sources](https://github.com/oboapp/sources). Existing crawlers remain active while additive prerequisites land; package versions do not trigger refetching historical identifiers.

## Atomic worker claims

`DbClient.compareAndUpdate(collection, id, tokenField, expectedToken, data)` atomically compares a top-level string field and merges a plain update only when it matches. It returns `false` for a missing document, absent/non-string field, or stale token. Database errors propagate. Token comparisons are case-sensitive, including on MongoDB collections with a different default collation. Updates cannot contain operators, dotted fields, `_id`, or top-level undefined values.

Firestore performs the comparison and write inside a transaction. MongoDB uses a single conditional update without upsert. A future source worker can read a pending record, check its lease time, then claim it by comparing its current token and writing a fresh unique token with its new lease. Every claim, renewal, completion, and reclamation must rotate or check that token as appropriate so a stale worker cannot mutate a newer claim. The primitive itself does not implement leases, retry policy, or a queue.

The capability is optional on `DbClient` for compatibility with existing custom adapters. All built-in adapters implement it. Queue code must explicitly require it and fail closed when absent; a separate read followed by `updateOne` is not a safe fallback.

In dual-write mode, only the configured primary decides whether a conditional update succeeds. A rejected or failed primary write never reaches the secondary. After success, the secondary receives the plain update on a best-effort basis, consistent with existing dual-write behavior; a secondary failure is logged and does not undo the primary claim. This is not a distributed transaction. Workers must use one authoritative backend, and switching `DB_READ_SOURCE` requires stopping/draining workers and reconciling pending state first. The secondary must not independently grant claims.

The adapter tests use mocked storage boundaries to verify transactional/conditional writes, stale-token behavior, error propagation, and dual-write routing. They are not emulator-backed concurrency tests. The queue slice must add page replay, lease recovery, and stale-worker integration coverage before activating a packaged source.
