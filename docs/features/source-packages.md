# Source packages and Obo adapters

All 23 source integrations use published npm packages. To change how a provider discovers items or parses their content, edit its package in `oboapp/sources`. To connect a package to an Obo instance, use the adapter and catalog in this repository. [Provider packages](https://github.com/oboapp/sources/tree/main/packages) · [Obo adapter guide](../../ingest/crawlers/README.md)

## Package, adapter and runner

| Component | Responsibility |
| --- | --- |
| Provider package | Lists identifiers and returns the content for each item. Provider requests, parsing, fixtures and parsing tests belong with the package. |
| Obo adapter | Exports `crawl` from `ingest/crawlers/<source-id>/index.ts` and connects the package factory to the runner. It supplies instance services when a provider needs them. For example, Sofia BG checks historical article titles and Sensor.Community reads stored measurements. [Sofia BG adapter](../../ingest/crawlers/sofia-bg/index.ts) · [Sensor.Community adapter](../../ingest/crawlers/sensor-community/index.ts) |
| Obo runner | Supplies the configured locality, checks known identifiers, validates returned content and saves new raw records through `@oboapp/db`. Obo then processes those records for the map, API and notifications. [Source runner](../../ingest/sources/run-source.ts) |

The upstream demo selects Sofia BG, Sofiyska Voda and Sensor.Community. Its development workspace retains the other 20 packages for integration tests. The Sofia production fork selects 22 sources and retains Sensor.Community for development. The selected catalog controls the CLI and build. The locality job file controls what Terraform deploys. [Instance catalog](../../shared/src/sources.ts) · [Sofia jobs](../../ingest/terraform/source-jobs.bg.sofia.json) · [Development retention policy](../../ingest/source-package-policy.json)

## Scheduled scan behavior

A scan lists candidates, skips known identifiers, fetches new content, validates it, and saves complete raw records. Pagination stays within that scan. One source instance handles the batch and closes afterward, allowing provider sessions and rate limits to be reused.

Identifiers remain byte-for-byte compatible with historical URLs, including synthetic URLs. Both legacy base64 and MD5 document lookups remain supported. Known identifiers are skipped even when the provider changes an item or a package version changes.

Obo assigns the source ID, locality, identifier, crawl timestamp and initial processing state. Validation runs before persistence. Writes create new records and preserve existing records during overlapping scans.

Source content may include an optional boolean `cityWide` for notices covering the
entire selected locality. The runner preserves both `true` and `false`, leaves an
omitted field absent, and rejects other values before writing a raw record.
Ingestion receives the stored scope alongside the source's validated GeoJSON,
including an empty FeatureCollection for city-wide weather warnings.

An individual lookup, fetch, validation or save failure is logged and counted while unrelated items continue. Listing failures and repeated pagination cursors fail the scan. The next scheduled run lists again and retries identifiers that are still missing. A retry can recover an item while the provider still lists it.

## Collection patterns and compatibility

Website packages can reuse Chromium for listing and detail requests. Full-content feeds and listing/API packages can reuse content already obtained during discovery. Discovery context must stay within the SDK's serializable payload limit; larger content can remain in the source instance until fetched.

The integration tests cover these provider contracts.

| Source | Behavior covered by integration tests |
| --- | --- |
| Sofia BG | Repairs listings, news RSS and listing fallback. Obo checks historical titles, URL aliases and both raw document ID formats before fetching a detail. When an article heading differs from the listing title, Obo stores both titles on the new record so future scans recognize either one. |
| Sofia Capital of Sport | WordPress RSS discovery, browser article detail and historical publication dates. |
| Serdika | HTTP collection across messages, news and events, preserving article identifiers and per-section discovery. The district's redirect omits an intermediate TLS certificate. [Production access follow-up](https://github.com/oboapp/oboapp/issues/711) |
| Krasna Polyana | Current WordPress notices use their public links. The July 2026 cutover keeps earlier Joomla records under their original identifiers. |
| Sensor.Community | The adapter supplies locality bounds and a read-only window of stored sensor readings. The package calculates air-quality alerts. Obo persists the historical grid-cell identifiers and native GeoJSON. |

Toplo illustrates synthetic identifiers: raw-record URLs identify incidents, while empty public detail links prevent navigation to invented detail pages. Its restricted compatibility profile preserves historical empty titles and malformed publication-date strings while validating content and geometry. Its preview validates candidates without database initialization; preview counts describe items that would be saved.

NIMH uses `@oboapp/source-nimh-severe-weather@0.1.1` with SDK 0.2.0. Chromium
waits for `domcontentloaded` before reading the server-rendered warning text and
tables, so discovery can finish while background requests remain active.
Discovery keeps complete warning data in the source instance, and fetching
returns that cached content for the historical synthetic identifier. The package
preserves browser-serialized warning hashes, city-wide scope, empty GeoJSON and
fixed `+02:00` forecast timespans. The adapter fails the job when every new
warning fails to process. Warning-free scans succeed. Provider parsing tests live
in the sources repository; Obo tests the published package through persistence
and ingestion.

### Lozenets

Lozenets pins [`@oboapp/source-lozenets-sofia-bg@0.2.0`](https://www.npmjs.com/package/@oboapp/source-lozenets-sofia-bg/v/0.2.0), prepared in [sources#43](https://github.com/oboapp/sources/pull/43). The published npm archive matches the inspected [GitHub release](https://github.com/oboapp/sources/releases/tag/source-lozenets-sofia-bg-v0.2.0), and the registry README and repository metadata are verified. It uses shared RSS helper 0.5.0.

Feed discovery makes at most two attempts within one 30-second budget covering requests, body reads and the retry delay. Eligible transient failures wait at least two seconds before another attempt. Supported `Retry-After` values can extend the delay when it fits the remaining budget. The [helper's retry policy](https://github.com/oboapp/sources/blob/source-web-utils-v0.5.0/packages/source-web-utils/README.md#rss-retries-and-diagnostics) defines eligible network codes and HTTP statuses. Persistent access, certificate and invalid-content failures remain scan failures.

The adapter records `RSS feed retry scheduled` as a warning and `RSS feed recovered after retry` as information in Cloud Logging and Sentry breadcrumbs. Flat diagnostic fields include `sourceType`, `feedUrl`, `diagnosticCode` and feed attempt counts, alongside Cloud Run execution and task context. Feed attempt counts describe requests inside one scan; `cloudRunTaskAttempt` identifies the scheduler attempt. Breadcrumbs accompany later Sentry exceptions, while successful recovery remains visible in Cloud Logging. Final failures retain the feed identity, attempt count and sanitized nested network cause.

Literal article URLs, RSS dates, article extraction, two-second detail pacing, source ID `lozenets-sofia-bg` and locality `bg.sofia` remain compatible. Historical base64/MD5 lookups and create-only persistence preserve stored records. The native RSS investigation in [#688](https://github.com/oboapp/oboapp/issues/688) and the older browser-navigation issue [#451](https://github.com/oboapp/oboapp/issues/451) concern different collection stages; article navigation uses `domcontentloaded`. Deployment and subsequent scheduled scans still need to confirm production recovery before closing #688.

## Instance selection and deployment

Pin each provider to an exact version in `ingest/package.json` and commit `pnpm-lock.yaml`. The build recognizes `@oboapp/source-*` dependencies, excluding the SDK and web utilities. A selected source needs a package whose metadata matches its catalog definition. [Package discovery](../../ingest/sources/installed-packages.ts) · [Instance setup](../setup/new-locality-instance.md)

Select sources in `shared/src/sources.ts` and configure the matching jobs in `ingest/terraform/source-jobs.<locality>.json`. Keep existing job keys when updating a deployment. Terraform loads these files for `var.localities`. A non-empty `var.crawlers` overrides the job files. The full Sofia template under `ingest/terraform/examples/` is an example.

The `crawl` and `pipeline` commands use the same runtime registry. Their help lists selected sources. `crawl --source <source-id>` rejects unselected IDs even if an adapter exists. `pipeline --all` runs every selected source. `pipeline --emergent` runs those marked `emergent: true`. The registry loads the selected adapter after environment setup. [Runtime registry](../../ingest/sources/registry.ts)

List each unselected provider kept for development in `ingest/source-package-policy.json`. Configuration validation rejects unlisted extra providers, stale entries, duplicate source IDs and missing selected packages. Remove a retention entry when selecting or uninstalling its provider. The Docker builder and runtime install only selected providers.

Check configuration without provider or database access:

```sh
pnpm --dir ingest exec tsx scripts/check-source-config.ts
```

The check rejects version ranges, duplicate IDs, metadata differences, unsupported localities, missing entrypoints, missing or extra jobs, reused job keys and emergent schedule differences. It loads browser-safe metadata without loading provider runtimes. The image build also checks compiled entrypoints. Source-package Chromium checks follow selected installed packages and their declared browser dependencies, including Playwright supplied through `@oboapp/source-web-utils`, and run as the production user.

## Building selected sources

Run `pnpm --dir ingest build` after building the database package. The build reads `SOURCES` from the shared instance assembly and uses each selected crawler's `index.ts` as a compiler entrypoint. Other crawler directories and test helpers are excluded from broad file discovery; imported shared helpers and runtime mock services remain available.

To remove an integration from a fork's checkout, remove its unselected provider dependency with `pnpm --dir ingest remove <package>`, remove its retention-policy entry, and remove its unselected crawler directory. Keep the source catalog and deployment jobs aligned. The production build requires selected entrypoints and their imports. Repository-wide integration tests still cover retained integrations, so forks removing them must also adapt the corresponding tests.

## Preparing builder dependencies

Docker installs root tooling first, then projects the frozen workspace inputs before installing provider packages. The projection removes retained unselected providers while preserving selected providers, ordinary dependencies, locked resolutions and configured patches. Development manifests and the lockfile stay unchanged.

The builder validates installed packages against the selected catalog and deployment jobs with the retention policy absent. Normal development checks continue to validate the original retention policy and all retained integrations.

To inspect the projected inputs after installing root tooling, use a new or empty target directory:

```sh
node ingest/scripts/prepare-build-workspace.mjs . tmp/build-workspace
pnpm --dir tmp/build-workspace install --frozen-lockfile --ignore-scripts
```

## Preparing production dependencies

The [production workspace preparation script](../../ingest/scripts/prepare-production-workspace.ts) creates disposable installation inputs containing the root, shared, database and ingest manifests. It reads installed source metadata to match package names to the selected `SOURCES` IDs, then removes unselected provider dependencies from the normal and optional production dependencies. Ordinary application dependencies and workspace links remain available.

The generated lockfile updates the matching importer entries and preserves surviving resolutions, integrity values, peer suffixes and patch references. Root overrides, patch configuration and patch files stay aligned with the lockfile. The repository's development manifests, lockfile and retained integration dependencies stay unchanged.

After building shared, database and ingest, run from the repository root:

```sh
node ingest/dist/scripts/prepare-production-workspace.js tmp/production-workspace
pnpm --dir tmp/production-workspace install --frozen-lockfile --prod --ignore-scripts
```

The target must be a new or empty directory. Docker uses `/app/production-workspace` for these installation inputs and adds the compiled application artifacts separately.

The production image installs this generated workspace into a fresh layer with `pnpm install --frozen-lockfile --prod --ignore-scripts`. It keeps the generated manifests alongside the compiled output, so package metadata and browser checks see the production selection. Browser checks resolve only the selected providers' declared browser dependencies.

The production stage sets `COREPACK_HOME=/home/node/.cache/node/corepack` before preparing pnpm. The runtime user owns this cache, making pinned pnpm available on first startup without downloading it.

The two-source configuration passed a Cloud Run deployment check on 19 November 2026. See the execution evidence below.

## Verifying a minimal image

The independent `Test Minimal Source Image` CI job creates a Docker context containing the packaged HTTP sources for Triaditsa and Sofiyska Voda, alongside shared helpers. Other crawler directories are absent. The context retains development provider dependencies and records unselected packages in its retention policy, so the ordinary Dockerfile must remove them before builder installation.

To run the same check locally after workspace installation, use a new or empty fixture directory:

```sh
pnpm --dir ingest build
node ingest/dist/scripts/prepare-source-image-fixture.js tmp/source-image
docker build --progress=plain --target builder -t oboapp-source-builder:local -f tmp/source-image/ingest/Dockerfile tmp/source-image
node ingest/dist/scripts/check-source-builder-image.js oboapp-source-builder:local
docker build --progress=plain -t oboapp-source-image:local -f tmp/source-image/ingest/Dockerfile tmp/source-image
node ingest/dist/scripts/check-source-image.js oboapp-source-image:local
```

The fixture command changes copied configuration while preserving the working checkout. Both image verifiers check selected package versions, physical dependency-store contents, source directories and entrypoint loading. The builder check also requires the retention policy to be absent. The production check verifies `USER node`, offline startup, pinned pnpm availability, selected CLI help and rejection of an unselected source.

Offline runtime checks load the selected entrypoints and run the HTTP-only browser check. They verify that database initialization and browser runtimes stay unloaded.

On 19 November 2026, Cloud Build built the two-source fixture from fork revision `c6175377`. Two isolated Cloud Run jobs executed image `sha256:3051fcaf165412558ff7894a32a1466e2b5abb0b8f041265ff5b0a0592befa9a`. Each checked the runtime registry, compiled source directories, non-root user and installed provider packages. The package store contained the SDK, Triaditsa and Sofiyska Voda.

The jobs ran the source runner in database-free preview mode against the live providers. Execution `proof586-triaditsa-c617-plhkm` validated 20 notices. Execution `proof586-voda-c617-mk7rg` validated four. Both completed with zero item failures. [Deployment tracker](https://github.com/oboapp/oboapp/issues/610)

## Updating a provider

1. Change discovery, parsing and provider fixtures in `oboapp/sources`. Keep literal identifiers and supported metadata compatible with existing records. Publish the tested package and verify its registry archive. [Release procedure](https://github.com/oboapp/sources/blob/main/RELEASING.md)
2. Pin the release with `pnpm --dir ingest add --save-exact <package>@<version>`. If the package needs new Obo services, update its adapter. For a new selection, update the catalog, job file and retention policy as described above.
3. Test the installed package through the adapter, raw record persistence and ingestion. Cover historical skips, retries and cleanup when changing those behaviors. Run the source configuration check before deploying. [Adapter guide](../../ingest/crawlers/README.md)
4. Deploy under the existing job identity for an update. Review saved, skipped and failed totals against the provider's eligible items. Check that a later scan recognizes saved identifiers. To roll back, deploy the previous image.

With the ingest environment configured, `pnpm --dir ingest crawl --source <source-id>` runs the selected adapter and saves new records.

## Production follow-ups and quality

In the final Sofia rollout, Sofia BG, Sofia Capital of Sport and Krasna Polyana completed production scans. Serdika's connection to the district site failed and is tracked separately. The four production adapters and the upstream demo's Sensor.Community adapter use published `0.1.0` releases. [Migration record](https://github.com/oboapp/oboapp/issues/586) · [Fork deployment](https://github.com/vbuch/oboapp/pull/81) · [Serdika access](https://github.com/oboapp/oboapp/issues/711)

### Pancharevo

Pancharevo uses the published `0.1.1` package for the current planned-repairs RSS feed and article structure. Feed failures fail discovery before saving records. Cloud Run still receives HTTP 403 responses, tracked in [#687](https://github.com/oboapp/oboapp/issues/687). Provider changes to historical paths and numeric IDs also require a deduplication review before collection resumes. Keep historical backfill separate.

### Other sources

Mladost's package reports unsuccessful HTTP navigation as a failure. Provider access from Cloud Run remains blocked in [#677](https://github.com/oboapp/oboapp/issues/677); production recovery is tracked in [#673](https://github.com/oboapp/oboapp/issues/673). Krasna Polyana's provider change and production verification are documented in [#675](https://github.com/oboapp/oboapp/issues/675).

Obo tests the package-to-ingestion contract. The sources repository owns provider implementation tests, source-mapped coverage and its own Sonar analysis. [#663](https://github.com/oboapp/oboapp/issues/663) records the verified quality-gate setup for extracted code.
