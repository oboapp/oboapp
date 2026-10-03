# Notifications report

`/notifications-report` is a public aggregate report backed by
`notifications/report.json` in `GCS_GENERIC_BUCKET`. Its footer link and page
use the same configuration gate as the history report. The web API reads only
the snapshot, never notification matches. There is no heatmap in this version.

## Metric definitions

The reporting unit is a processed notification match, not an individual device.
`notified: true` means the sender processed the match; it does **not** establish
that a push was sent. The report partitions processed records into:

- `sent`: at least one entry in `deviceNotifications` has `success: true`.
  Multiple successful devices count once. This means FCM accepted a send,
  not that the device displayed the notification.
- `failed`: a nonempty device-result array in which every attempt failed.
- `noSubscriptions`: an empty device-result array.
- `unknownDelivery`: missing or malformed device results, including legacy
  records and matches marked processed without a send result. They are never
  assumed to have been sent successfully.

`uniqueUsers` counts distinct recipients in the successful-send cohort.
`clicked` counts successful matches with a valid `clickedAt` recorded by the
push redirect at `/n/[id]`. `opened` counts successful matches with a valid
`openedAt` recorded when an item is opened from notification history. These are
different, potentially overlapping actions, each counted once per match.
Neither is a device-delivery receipt. `readAt` from bulk mark-as-read is not an
open and is excluded.

`periodStart` and `periodEnd` are the earliest and latest valid `notifiedAt`
values in the processed records. `firstRecordedClickAt` is the earliest observed
click among successful matches, **not** when tracking was enabled. Missing
dates stay null. The report describes retained records, not an immutable
lifetime total: message cleanup and account deletion can reduce counts.

Sources use the source captured at send time, falling back to the current
message source for older records. Deleted messages without a snapshot source
are grouped under `(unknown)`.

## Generation and deployment

From `ingest/`:

```sh
pnpm notifications-report --dry-run
pnpm notifications-report
```

Dry run reads the database and logs aggregate counts without writing GCS.
Normal execution requires `GCS_GENERIC_BUCKET` and fails if saving fails. It
uses the normal `getDb()` configuration for database access and Application
Default Credentials for GCS writes (the Cloud Run execution service account).
The Firebase service account key is not used for snapshot uploads.

The generator reads processed matches in pages of 500 ordered by native document
ID, preserving MongoDB ObjectId cursors and handling mixed string/ObjectId IDs.
The database integration regression can be run against a disposable MongoDB
instance by setting `DB_TEST_MONGODB_URI` and running
`pnpm --filter @oboapp/db test:run`. It creates and drops a uniquely named test database.
It looks up missing sources sequentially in batches of ten, selecting only the
source field. It retains only the current page, source totals and distinct
successful recipient IDs in memory. No recipient IDs, notification IDs, device
tokens, message text or coordinates are written to the public snapshot.
The scan is not transactional; concurrent sends or engagement may appear in the
next weekly refresh. A database-read failure prevents publication of a partial
report. GCS object replacement happens only after aggregation completes.

The Firestore adapter maps `_id` filtering and ordering to document IDs. The
query uses the ascending single-field `notified` index and its default ascending
document-ID ordering; retain that index if field overrides are configured.
See [Firestore index ordering](https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the_name_field).
MongoDB uses the `notified_id` compound index from `db/src/indexes.ts`; ensure
indexes through the existing database index workflow when using MongoDB.

Terraform creates the `notifications-report` Cloud Run job and scheduler when
`gcs_generic_bucket` is configured. The default schedule is Monday at 03:00 in
`schedule_timezone`, overridable via `schedules.notifications_report`. The job
uses the current ingest image, a 600-second timeout and 512 MiB memory. It logs
structured errors for the accompanying Cloud Monitoring alert policy.

After deploying the ingest image and Terraform configuration, execute the job
once to produce the initial snapshot, then verify `/api/notifications/report`
and the page. The API returns 503 while the report is disabled or missing, and
500 for an unreadable or invalid snapshot. Successful responses are cached for
an hour. The shared versioned Zod schema validates both publication and reads;
the API strips fields outside the public schema.
