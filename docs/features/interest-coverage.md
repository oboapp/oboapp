# Public interest heatmap

`/interest-coverage` shows where people have saved zones to receive notifications.
The public `GET /api/interests/report` endpoint serves a weekly precomputed
snapshot. Both require `GCS_GENERIC_BUCKET`, but no sign-in. Saved zones are an
expression of interest; they do not imply a registered push device or delivery.

## Generation and storage

From `ingest/`, run `pnpm interest-coverage-report` or
`pnpm interest-coverage-report --dry-run`. Dotenv loads before database
initialization. The generator reads user IDs, coordinates and radii through
`@oboapp/db`; individual records never reach the report bucket or browser.
Dry runs compute the image but print only status, banded totals and the timestamp.
They never write the snapshot. Both modes require the stable private key below.

Version 2 contains `version`, `locality`, `generatedAt`, `status`, `summary` and
`image`. An available image has a PNG data URL and its fixed width/height; an
unavailable report has null image and summary. There are no cell counts,
individual centers, radii, user IDs, labels, signatures or per-person layers.
The PNG is embedded in `interests/report.json`, keeping pixels and metadata
atomic and preventing mismatched image/JSON caches. PNG encoding adds no private
metadata. The bucket stays private; the endpoint validates and serves the report.

The Cloud Run job runs weekly on Monday at 06:00 in `schedule_timezone`
(Europe/Sofia by default). Override `schedules.interest_coverage_report` or run
manually. Every successful run replaces the old snapshot, including unavailable
results. Read/render/upload failures leave the prior object intact and trigger
the existing log alert. The generic bucket's ten-day retention covers the weekly
interval. Successful API responses have a one-hour public cache and up to a day
of stale-while-revalidate; missing/error responses are not cached.

## Spatial processing and interpretation

1. Validate IDs, finite coordinates and radii of 100–1000 m. Include circles
   intersecting the configured locality bounds, including circles centered just
   outside. Totals describe these valid saved zones and distinct people.
2. Shift every person's circles by the same stable vector, uniformly sampled
   within a 200 m disk using HMAC-SHA256 of the user ID and locality with a private
   key. Preserve the circle radii. Offsets do not depend on run date or record
   order, and different people receive different offsets.
3. Rasterize circles in Web Mercator at approximately 100 m ground sampling.
   The image always covers the fixed locality bounds. Count each person's union
   of circles once per pixel, so overlapping or duplicated zones do not inflate
   interest. This is circle coverage, not a map of residences or zone centers.
4. Require at least ten distinct contributing people overall. Remove pixels
   covered by fewer than **three distinct people**, then round remaining counts
   down into three-person bands. Unlike version 1, people do not need to share
   an identical complete spatial signature.
5. Smooth only the eligible field with a Gaussian of approximately 150 m sigma.
   Removed contributions do not enter the blur. Soft edges can extend beyond
   eligible pixels and are not evidence of precise coverage at those addresses.
6. Encode a transparent PNG with a fixed blue–amber–red scale (full color at
   about 20 contributors before smoothing). Opacity follows
   `230 * (1 - exp(-density / 15))`: small groups stay faint and larger overlaps
   become prominent. Do not normalize to the brightest point in a report or
   viewport. Pixels whose final alpha rounds to zero have all RGBA channels zero.

The browser places the image on the basemap. Zooming changes neither image
content nor intensity. The 100 m sampling is a rendering resolution, **not** a
claim of 100 m location accuracy. Counts in the summary remain ten-wide bands
and include zones whose spatial contribution is suppressed. No color can mean
missing or suppressed interest; it does not establish that nobody is interested.
There are no public per-user, category, source or geographic subset filters.

## Privacy limits

This is reduced-precision aggregate publication, not differential privacy or a
guarantee of anonymity. A public image still conveys geographic information and
can be downloaded, enhanced or compared with older snapshots. Transparency alone
would not protect sparse contributors: their pixels are removed before blur.
Stable offsets prevent averaging independent jitter across routine reports, but
do not eliminate inference from other information, changes over time or known
contributors. Three-person suppression is an explicit utility/privacy tradeoff,
not a universal anonymity threshold. Review changes to thresholds, smoothing,
release cadence and key management as changes to this policy.

## Stable key and rollout

Set `INTEREST_COVERAGE_JITTER_SECRET` to a persistent, cryptographically random
secret of at least 32 bytes. Missing/short keys fail before reading private data.
Never use the public user ID alone, a hardcoded fallback, or a fresh key per run.
The key stays in the ingest environment; it is never sent to the web service.

Before applying Terraform, create Secret Manager secret
`interest-coverage-jitter-key` with a random value (for example, 32 random bytes
encoded as hex). Terraform references that existing secret, consistent with the
other ingest secrets; it does not store its value in configuration or state.
The ingest runner already has secret accessor permissions. Override
`interest_coverage_jitter_secret_id` if needed. The version defaults to `1` and
must be pinned numerically using `interest_coverage_jitter_secret_version`.
Do not rotate routinely: independently shifted releases can be averaged. Treat
necessary rotation as a publication-policy decision; previous public snapshots
cannot be recalled.

Deploy the web/shared changes first: readers support both versions, and legacy
2 km snapshots are clearly labeled while awaiting regeneration. Then provision
the key, deploy ingest/Terraform and run the report job. The generator writes only
version 2. The old frontend cannot parse version 2, so retain the updated reader
when rolling back a generator. No raw-data migration is needed.

## Snapshot freshness and notification matching

The page fetches once on load and shows the generation timestamp. Account/zone
changes appear in the next generated report; there is no live database query,
mutation hook or immediate withdrawal. Cached snapshots may remain visible.

Coverage does not establish recent message eligibility or delivery. `/history`
shows historic finalized message locations. Check `message-fetcher.ts` and
`match-processor.ts` for unprocessed status, expired `timespanEnd`, creation after
the zone was saved, geometry/city-wide matching, category/source preferences and
experimental-source opt-in. Match creation and successful delivery are separate.
