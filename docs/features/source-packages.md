# Source package migration

Tracking: [#586](https://github.com/oboapp/oboapp/issues/586). Published collectors and their provider documentation live in [oboapp/sources](https://github.com/oboapp/sources).

## Current transition

Each selected source uses either a published package or a remaining legacy crawler. Both collection paths save complete raw records for the same ingestion, event-matching and notification pipeline. Sources that supply GeoJSON keep their existing processing path.

| Responsibility | Legacy sources | Packaged sources |
| --- | --- | --- |
| Provider requests, parsing and content conversion | Collector code in Obo | Independently versioned source packages |
| Historical lookup, validation and raw persistence | Obo's collection helpers | Obo's scheduled source runner |
| Scheduling, catalog selection and downstream processing | Obo | Obo |

Installed package versions are pinned in `ingest/package.json` and `pnpm-lock.yaml`. The [remaining migration tracker](https://github.com/oboapp/oboapp/issues/609) records source cutovers. [Selection and deployment work](https://github.com/oboapp/oboapp/issues/610) tracks selected-only installation, builds and images.

The current build still compiles all source integrations and includes legacy collector code in the image. Building with only selected implementations remains unfinished.

## Scheduled scan behavior

A scan lists candidates, skips known identifiers, fetches new content, validates it, and saves complete raw records. Pagination stays within that scan. One source instance handles the batch and closes afterward, allowing provider sessions and rate limits to be reused.

Identifiers remain byte-for-byte compatible with historical URLs, including synthetic URLs. Both legacy base64 and MD5 document lookups remain supported. Known identifiers are skipped even when the provider changes an item or a package version changes.

Obo assigns the source ID, locality, identifier, crawl timestamp and initial processing state. Validation runs before persistence. Writes create new records and preserve existing records during overlapping scans.

An individual lookup, fetch, validation or save failure is logged and counted while unrelated items continue. Listing failures and repeated pagination cursors fail the scan. The next scheduled run lists again and retries identifiers that are still missing. A provider can remove an item before a successful retry; this is an accepted recovery limit of the initial migration.

## Collection patterns and compatibility

Website packages can reuse Chromium for listing and detail requests. Full-content feeds and listing/API packages can reuse content already obtained during discovery. Discovery context must stay within the SDK's serializable payload limit; larger content can remain in the source instance until fetched.

Each migration preserves provider-specific URL filtering, date fallback, content conversion and legacy deduplication. Contract fixtures protect these behaviors before the old provider implementation is removed. Sofia's historical title fallback must remain supported when that source migrates.

Toplo illustrates synthetic identifiers: raw-record URLs identify incidents, while empty public detail links prevent navigation to invented detail pages. Its restricted compatibility profile preserves historical empty titles and malformed publication-date strings while validating content and geometry. Its preview validates candidates without database initialization; preview counts describe items that would be saved.

## Instance selection and deployment

Keep the selected catalog in `shared/src/sources.ts` aligned with `ingest/terraform/source-jobs.<locality>.json`. Job keys identify deployed resources, so preserve them when translating existing configuration. Terraform selects locality maps through `var.localities`. A non-empty `var.crawlers` is an explicit manual override outside the checked selection.

The `crawl` and `pipeline` commands share a [runtime registry](../../ingest/sources/registry.ts) derived from the selected `SOURCES` array. Their help lists selected sources. `crawl --source <source-id>` rejects unselected IDs even when their directories exist. `pipeline --all` runs every selected source; `pipeline --emergent` runs selected sources whose definition has `emergent: true`. Implementations load only when their selected source runs, after environment configuration.

The upstream demo selects a small source set. `ingest/source-package-policy.json` explicitly lists unselected packages retained for compilation and integration tests during the transition. Retained packages still require isolated valid metadata, exact versions and unique source IDs. Unexpected unselected dependencies and stale policy entries fail validation. Remove a package's retention entry when selecting its source or removing its dependency. An absent or empty policy enables strict selection for all installed source packages.

The default Sofia job file matches the demo. The full Sofia template under `ingest/terraform/examples/` is inactive. Existing deployments must retain their own catalog and job selection when rebasing. See the [instance setup guide](../setup/new-locality-instance.md) for translating the full template and updating the retention policy before deployment.

Check configuration without provider or database access:

```sh
pnpm --dir ingest exec tsx scripts/check-source-config.ts
```

The check rejects version ranges, duplicate IDs, metadata differences, unsupported localities, missing entrypoints, missing or extra jobs, reused job keys and emergent schedule differences. It loads browser-safe metadata without loading provider runtimes. The image build also checks compiled entrypoints and launches each packaged browser as the production user.

## Moving a source

1. Capture contracts for literal identifiers, historical lookups, content, dates, locality and scheduling. Include fixes already deployed by an instance.
2. Publish and review the independent package. Preserve provider parsing tests and source-mapped coverage in the sources repository.
3. Install the exact version with `pnpm --dir ingest add --save-exact <package>@<version>`. Connect the existing command entrypoint to Obo's runner, remove the replaced provider code, and update selection or retention configuration.
4. Test the actual package through raw persistence and ingestion. Cover historical skips, repeated scans, failed-item continuation, later retry and session cleanup. Run the repository's required quality checks and inspect the actual Sonar quality gate.
5. Deploy using the existing job identity. Inspect saved/skipped/failed totals, verify complete raw records reach ingestion, and confirm a later scan skips known identifiers. Record deployment evidence in the migration issue.

With the normal ingest environment configured, `pnpm --dir ingest crawl --source <source-id>` runs a scan and saves new records. A successful empty listing alone does not establish provider health; compare the result with the provider's current eligible items.

To roll back, revert the source integration and deploy the previous image. Existing raw records remain compatible. Preserve the instance catalog and deployment job selection during rollback.

## Production follow-ups and quality

Mladost's package reports unsuccessful HTTP navigation as a failure. Provider access from Cloud Run remains blocked in [#677](https://github.com/oboapp/oboapp/issues/677); its migration still needs a healthy discovery and deduplication scan in [#673](https://github.com/oboapp/oboapp/issues/673). Legacy provider repairs remain part of the remaining migration tracker.

Obo tests the package-to-ingestion contract. The sources repository owns provider implementation tests, source-mapped coverage and its own Sonar analysis. [#663](https://github.com/oboapp/oboapp/issues/663) records the verified quality-gate setup for extracted code.
