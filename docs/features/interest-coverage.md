# Public interest coverage report

`/interest-coverage` displays a precomputed, anonymized snapshot of saved zones
at generation time through the public `GET /api/interests/report` endpoint. No sign-in is
required. Both are available when `GCS_GENERIC_BUCKET` is configured, using the
same report-page gate and footer section as the history report.

## Generation and storage

From `ingest/`, run `pnpm interest-coverage-report` or
`pnpm interest-coverage-report --dry-run`. The script loads dotenv before database
initialization, reads only user ID, coordinates and radius through `@oboapp/db`,
and uploads **only the approved aggregate** to `interests/report.json`.
Terraform schedules a Cloud Run job weekly on Monday at 06:00 in
`schedule_timezone` (Europe/Sofia by default). Override
`schedules.interest_coverage_report` to change the cadence, or execute the job
manually. A failed job logs an error and is covered by the standard log alert.

The report uses the existing generic bucket's ten-day retention, which covers
the weekly interval. Each run overwrites the previous JSON. The web service uses
the same read access as other report pages. The ingest job alone writes the
report; there are no revision markers or additional web write permissions.

## Coverage and privacy

The map uses the same Leaflet heat renderer and blue-to-yellow-to-red gradient
as `/history`, with pan and zoom available. Published cells are sampled uniformly
for rendering and weighted by their user-band lower bound, relative to the
densest published cell. These samples are not zone centers or new location data.
Smoothing stays at a fixed geographic scale across zoom levels and may extend
color beyond a published cell; colors are relative density, not exact counts or
coverage boundaries. The existing version-1 JSON remains compatible; deploying
this display change does not require regenerating reports.

Active means valid zones saved when the report is generated, with circle coverage intersecting the
configured locality's shared rectangular bounds. It does not imply a registered
push device. Malformed IDs/coordinates and radii outside 100–1000 meters are
excluded. Zones centered just outside the bounds can contribute if their circles
intersect the city grid. The default locality is Sofia; forks can use another
locality present in the shared bounds registry.

The fixed grid uses approximately 2 km cells (clipped at the city bounds).
Circle/rectangle intersections use a local metric approximation. A colored cell
means some zone coverage intersects that cell, not that every address in it is
covered. The map intentionally sacrifices precision and completeness.

1. Fewer than ten distinct contributing users produces an unavailable snapshot
   with **no cells and no counts**. Multiple zones from one user count once.
2. Each user's union of touched cells forms a coarse spatial signature. Only
   signatures shared by at least ten users contribute to the published map. This
   protects uncommon multi-cell combinations as well as isolated cells.
3. Each cell counts distinct users from those eligible groups. Overlapping zones
   belonging to one user never inflate its density. Counts are published in
   ten-wide bands; total zone/user bands include valid saved zones even when their
   spatial contribution is suppressed. No group memberships or signatures are
   published.
4. Empty and suppressed cells are indistinguishable: both have no published
   color. Never describe an uncolored cell as confirmed zero coverage.
5. The report/API contain no raw centers, radii, labels, IDs or individual records.
   The server validates the schema, fixed-grid coordinates and minimum band sizes.
   There are no geographic/category/source filters or alternate grid resolutions;
   zooming displays the same coarse aggregates through a smoothed heatmap.

This is conservative spatial suppression, not a claim of differential privacy or
protection against every auxiliary-data attack. Public snapshots can be copied
and compared over time. Review changes to grid resolution, thresholds, bands and
release cadence as changes to the privacy policy; never introduce raw details or
personalized subsets. If no signature can be published, the whole map is withheld.

## Snapshot freshness

Privacy thresholds and spatial suppression are reevaluated from the data read on
every scheduled or manual generation. If the next run has fewer than ten users
or no safely publishable cells, it writes an unavailable snapshot with no counts
or geometry, replacing the previous map.

The public endpoint only reads and validates the stored JSON. Like the other
reports, successful responses use a one-hour public cache with up to a day of
stale-while-revalidate; missing/error responses are not cached. The page fetches
once on load and shows **Генериран: <date time>** using the shared `formatDateTime`
helper. There is no live refresh, database query, zone-mutation hook or effect on
account/zone changes. Changes appear in the next generated report; the timestamp
describes the snapshot's age rather than the current subscriber population.

This weekly snapshot behavior is the agreed downstream scope. It deliberately
does not implement immediate withdrawal after individual zone changes. Keep the
bucket private and expose the approved JSON through the public report endpoint.

## Interpreting a heartbeat with no matches

The timestamp says when **coverage** was sampled. It does not identify messages
eligible during the heartbeat's default 24-hour lookback. `/history` displays
historic finalized message locations and cannot establish recent eligibility.

Check notification pipeline logs and `message-fetcher.ts` / `match-processor.ts`
for: unprocessed status, expired `timespanEnd`, message creation after the zone
was created, geometry/city-wide matching, category/source preferences and
experimental-source opt-in. City-wide messages can match without local geometry.
Match creation and successful push delivery are separate; a user can have zones
without a registered push device. Coverage alone cannot establish pipeline health,
delivery success, or a shortage of eligible messages.
