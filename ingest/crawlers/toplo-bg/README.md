# Toplo listing snapshots

The Toplo adapter records every verified complete listing in `sourceSnapshots`.
Snapshots contain the source ID, locality, observation time, count and complete
incident details. The count includes accidents and repairs before geometry
filtering or message deduplication.

The source package calls its optional `onListing` observer with the HTML from its
single provider request. The adapter checks the expected page structure and
matches embedded incident identities with the visible listing before saving.
A complete empty listing records zero. HTTP failures, malformed metadata and
incomplete listings leave earlier observations unchanged.

The observation time is recorded after reading the response body and stored in
UTC. Snapshot collection uses no calendar-day grouping or scheduler timezone.
Each successful listing creates an observation even when all its messages have
already been saved. The existing create-only source records keep their original
values. Snapshot validation and storage happen before message persistence;
later geometry or message-processing failures preserve a verified observation.

Dry runs validate the listing without initializing database access or writing
snapshots or messages. The existing source ID, literal incident identifiers,
locality, request timeout and scheduling remain compatible.

## Package prerequisite

The adapter uses the published
[`@oboapp/source-toplo-bg@0.2.0`](https://www.npmjs.com/package/@oboapp/source-toplo-bg/v/0.2.0).
Its [release](https://github.com/oboapp/sources/releases/tag/source-toplo-bg-v0.2.0)
includes the inspected npm archive and checksum. The package supplies the
listing observer directly. Verify the `vbuch/oboapp` deployment before opening
an upstream application backport.

## Reading the latest count

`GET /v1/sources/toplo-bg/snapshot` returns the latest successful count and
observation time through the normal API key authentication and rate limiting.
It returns 404 when the source is not selected for the instance, the locality
does not match, or no successful observation exists. A stored zero is returned
as a successful response. Consumers should retain the observation time when
displaying older data.

Toplo remains an optional source. Keep the instance's `shared/src/sources.ts`
selection and deployment jobs aligned. The upstream demo selection is preserved.
Deploy the `sourceSnapshots` index before enabling snapshot reads. The index is
defined for both database adapters through `@oboapp/db`; the Firestore deployment
definition is also in `ingest/firestore.indexes.json`.

See the [public API contract](../../../docs/features/public-api.md) for response
fields and errors. Daily counts, incident history and observed transitions are
separate follow-up changes.
