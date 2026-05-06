---
name: long-flow-crawler-generator
description: Generate WordPress-style crawlers for public infrastructure disruption sources
agent-name: copilot
version: 1.0.0
keywords:
  - crawler
  - scraper
  - long-flow
  - wordpress
---

# Long-Flow Crawler Generator Skill

**IMPORTANT**: Using Crawler Creation skill!

This skill guides you through creating a new long-flow crawler for the oboapp project. Long-flow crawlers fetch HTML content from WordPress-style websites and process them through the full AI-powered ingestion pipeline (filter & split → categorize → extract locations → geocoding → GeoJSON generation).

## Phase 1: Research Existing Patterns

**MANDATORY: You must complete this research before asking ANY questions or writing ANY code.**

1. **Read shared utilities** in `ingest/crawlers/shared/`:
   - `webpage-crawlers.ts` - Main orchestration functions
   - `extractors.ts` - Generic extraction helpers
   - `database-utils.ts` - Firestore operations
   - `playwright-utils.ts` - Browser management
   - `date-utils.ts` - Bulgarian date parsing
   - `markdown.ts` - HTML to Markdown conversion
   - `types.ts` - Shared interfaces

2. **Study existing long-flow crawlers** (read at least 1-2):
   - `ingest/crawlers/rayon-oborishte-bg/` - Standard WordPress pattern
   - `ingest/crawlers/sofia-bg/` - Complex extraction logic
   - `ingest/crawlers/mladost-bg/` - URL filtering example
   - `ingest/crawlers/studentski-bg/` - Alternative structure
   - `ingest/crawlers/sredec-sofia-org/` - Recent implementation

3. **Understand the 5-file structure**:
   - `index.ts` - Entry point, constants, orchestration
   - `extractors.ts` - Scraping functions (index + post detail)
   - `selectors.ts` - CSS selector definitions
   - `types.ts` - TypeScript interfaces
   - `tsconfig.json` - TypeScript configuration

4. **Read pipeline documentation**:
   - `ingest/crawlers/README.md` - Crawler system overview
   - `ingest/messageIngest/README.md` - Ingestion flow details
   - `ingest/README.md` - Overall architecture
   - `AGENTS.md` - Development guidelines (especially Crawler Development section)

## Pre-Phase: Check for an Exposed API

**Before designing any Playwright scraper, check whether the site exposes a machine-readable feed.**

Many government and CMS-backed sites (WordPress, Drupal, IBM WebSphere Portal, etc.) publish content via RSS, ATOM, or a JSON API alongside their HTML. Using these avoids Playwright entirely for listing pages and is far more reliable.

Steps:

1. **Check well-known feed URLs** — append `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/api/posts`, or `/?feed=rss2` to the site root and common section paths.
2. **Inspect `<link>` tags** in the page `<head>` for `type="application/rss+xml"` or `type="application/atom+xml"`.
3. **Check JS source** for AJAX calls — look for `fetch(`, `XMLHttpRequest`, or CMS-specific objects (e.g. `PortalXMLHttpRequestObject`). Trace the request URL; it may be a plain HTTP endpoint that returns XML or JSON without needing a browser.
4. **Try a `curl` request** to any candidate URL to confirm it returns parseable data.

If a feed is found:

- Use `fetch()` (Node built-in) to retrieve it — no Playwright, no browser launch.
- Parse with simple regex for fixed machine-generated XML, or with a lightweight parser if the structure is complex.
- Playwright is still appropriate for **detail/post pages** if they are server-side rendered.
- Document the feed URL and parameters in `selectors.ts` (or a dedicated constants file) with a comment explaining the discovery.

### General Rule: Prefer First Page + Small Batches

When results are sorted by recency (newest first), default to fetching only the first page and a small number of records (for example 20) unless there is a clear product requirement to backfill history immediately.

Rationale:

- We only need fresh items for ongoing crawls.
- Older items are usually irrelevant for ingestion/notifications.
- Historical coverage accumulates naturally over time across repeated runs.
- Smaller pages reduce timeouts, bandwidth, parsing cost, and source load.

If unsure between "fetch many" vs "fetch few", choose few.

> **Real example**: `serdika.egov.bg` renders its listing via client-side AJAX (`PortalXMLHttpRequestObject`), which Cloud Run IPs cannot reach. The underlying portal search feed at `/wps/contenthandler/searchfeed/search` is a plain HTTP ATOM endpoint that works fine — switching to it eliminated the `ERR_CONNECTION_RESET` failures entirely.

---

## Phase 2: Gather Requirements

Ask the user for the following information:

1. **Target URL**: What is the starting URL for the crawler?
2. **Source identifier**: What should the crawler be named (e.g., `rayon-mladost-bg`)?
3. **Pagination**: Should the crawler process multiple pages or just the first page?
4. **HTML samples**: "Will you provide local HTML files or should I fetch them?"
   - If user wants you to fetch, create a script in `tmp/fetch-{{source-name}}-html.ts` that uses Playwright to save index and post HTML to `tmp/` directory
   - Reference the pattern from any existing fetch scripts in `tmp/` directory
5. **Logo readiness**: Is the 200x200px PNG logo ready for `web/public/sources/{{source-name}}.png`?
6. **Site structure confirmation**: Does the site use WordPress-style architecture (blog index with post links)?
7. **Screenshot artifacts**: Confirm screenshot capture plan for crawler baselines:
   - One listing/entry screenshot (`_entry.png` preferred)
   - One message/detail screenshot (`_message.png` preferred)
   - Stored in `ingest/crawlers/{{source-name}}/`

## Phase 3: Implementation

### File Structure

Create these 5 files in `ingest/crawlers/{{source-name}}/`:

1. **`index.ts`** - Main entry point
   - Read `ingest/crawlers/rayon-oborishte-bg/index.ts` for the standard pattern
   - Must include: shebang, dotenv config BEFORE imports, constants (INDEX_URL, SOURCE_TYPE, DELAY_BETWEEN_REQUESTS=2000)
   - Export `crawl()` function that calls `crawlWordpressPage` from shared utilities
   - Include main execution block with error handling

2. **`extractors.ts`** - Scraping logic
   - Read `ingest/crawlers/rayon-oborishte-bg/extractors.ts` (with URL filter) or `ingest/crawlers/sofia-bg/extractors.ts` (custom logic)
   - Must export two functions: `extractPostLinks(page)` and `extractPostDetails(page)`
   - Use `extractPostLinksShared` and `extractPostDetailsGeneric` from `../shared/extractors`

3. **`selectors.ts`** - CSS selector constants
   - Read `ingest/crawlers/rayon-oborishte-bg/selectors.ts` for the structure
   - Define `SELECTORS` object with `INDEX` and `POST` properties
   - Use user's HTML samples to identify correct selectors via browser DevTools

4. **`types.ts`** - TypeScript interfaces
   - Read `ingest/crawlers/rayon-oborishte-bg/types.ts`
   - Extend `BaseSourceDocument` with crawler-specific `sourceType`
   - Re-export `PostLink` from shared types

5. **`tsconfig.json`** - TypeScript config
   - Copy pattern from `ingest/crawlers/rayon-oborishte-bg/tsconfig.json`

### Required Visual Baseline Artifacts

Add screenshot companions in `ingest/crawlers/{{source-name}}/`:

- `_entry.png` - full-page screenshot of the listing/index page used for extraction
- `_message.png` - full-page screenshot of a representative message/detail page

Notes:

- Preferred naming is `_entry.png` and `_message.png`; source-specific names are acceptable when page types differ.
- If screenshots cannot be captured in the current environment, add a TODO item in your final report and block completion until artifacts are provided.

### Unit Tests

Create `extractors.test.ts`:

- Read `ingest/crawlers/rayon-oborishte-bg/extractors.test.ts` for the pattern
- Test `extractPostLinks` with mock Page object
- Test both success and empty result cases

## Phase 4: Validation Checklist

Before finalizing, verify:

- ✅ `dotenv.config()` is called BEFORE any Firebase imports in `index.ts`
- ✅ Shebang `#!/usr/bin/env node` is present at top of `index.ts`
- ✅ Document IDs use `createUrlBasedDocumentId(url)` for deterministic IDs
- ✅ `DELAY_BETWEEN_REQUESTS` is set to 2000ms (2 seconds)
- ✅ NO `geoJson` field is set (AI generates this in pipeline)
- ✅ NO `timespanStart`/`timespanEnd` fields are set (AI extracts these)
- ✅ NO `markdownText` field is set manually (comes from `buildWebPageSourceDocument`)
- ✅ Source document fields: `url`, `title`, `datePublished`, `message`, `sourceType`, `crawledAt`
- ✅ Unit tests written for `extractPostLinks` function
- ✅ Crawler runs via `pnpm crawl --source={{source-type}}`
- ✅ Crawler handles errors per-post (logs and continues, doesn't fail entire crawl)
- ✅ Uses named exports (not default exports)
- ✅ No barrel files (`index.ts` for re-exports)
- ✅ Baseline screenshots are present in crawler directory (`_entry.png` + `_message.png` or equivalent)
- ✅ Logging follows `logging-conventions` skill: `info` only for start/summary, `debug` for per-item steps, all entries include `sourceType`

### Testing Against Test Database

**CRITICAL: Always test with a test database first, never production.**

1. **Configure test database**: Ensure `.env.local` points to a test Firebase project
2. **Run the crawler**:
   ```bash
   pnpm crawl --source={{source-type}}
   ```
3. **Verify sources collection**: Check Firestore sources collection for crawled documents
   - Confirm `sourceType` matches
   - Verify `url`, `title`, `datePublished`, `message` fields are populated correctly
   - Check that `crawledAt` timestamp is present
   - Ensure no `geoJson`, `timespanStart`, `timespanEnd`, or `markdownText` fields exist
4. **Run ingestion pipeline**: Process the crawled content through the pipeline
   ```bash
   pnpm ingest
   ```
5. **Verify messages collection**: Check Firestore messages collection for processed output
   - Confirm messages were categorized correctly
   - Verify location fields (`pins`, `streets`, `cadastralProperties`, `busStops`) are populated
   - Check that `geoJson` was generated
   - Validate `markdownText` is present and formatted correctly
   - Confirm `timespanStart`/`timespanEnd` were extracted if dates exist

**Only switch to production database after successful test verification.**

## Phase 5: Documentation

Create `README.md` in the crawler directory following the pattern from existing crawlers. Keep it concise and target QA/admin audience (not developers).

Include:

- Source description
- URL pattern
- Data structure overview
- Any quirks or special handling

## Phase 6: Front-End Integration

Create the source definition file and register it in the instance assembly:

1. Create `shared/src/sources/{source-name}.ts` — use `export default` for the `SourceDefinition` object (so the importer can choose the local name). Include `id`, `url`, `name`, `localities`. If this is an emergent crawler (30-min interval), add `emergent: true`.
2. In `shared/src/sources.ts`, import the default export under a descriptive local name and add it to the `SOURCES` array. `EMERGENT_CRAWLERS` is derived automatically from the `emergent` flag — no separate list to update.
3. Add logo at `web/public/sources/{{source-name}}.png`

## Critical Rules from AGENTS.md

- **DRY**: Use shared utilities, don't duplicate code
- **No GeoJSON**: Long-flow crawlers do NOT handle GeoJSON at crawl time
- **Rate Limiting**: 2000ms between requests (respect source servers)
- **Document IDs**: Must be deterministic and stable (URL-based)
- **Error Handling**: Catch per-post errors, continue crawling
- **Logging**: Follow the `logging-conventions` skill — use `logger.debug` for per-item steps, `logger.info` only for start/summary with `sourceType` and counts
- **Testing**: Unit tests only for extractors, no integration/e2e tests
- **Theme**: If adding UI, use theme colors from `web/lib/colors.ts`
- **Precomputed GeoJSON (non-long-flow crawlers only)**: For crawlers that explicitly provide `precomputedGeoJson` (not generated via this long-flow crawler skill), ingestion bypasses all AI processing stages (Filter & Split, Categorize, Extract Locations). Timespans transfer from source to message during ingestion.
- **City-Wide Messages (non-long-flow crawlers only)**: For non-long-flow crawlers that manage `geoJson` directly, set `cityWide: true` with a non-null empty FeatureCollection (`{ type: "FeatureCollection", features: [] }`) for alerts applying to the entire city. The `geoJson` field must be non-null so downstream null-filters don't drop city-wide messages. This bypasses viewport filtering (always visible) and uses `sofia.geojson` for notification matching.

## Running the Crawler

Once implemented, the crawler runs via:

```bash
pnpm crawl --source={{source-type}}
```

This executes `ingest/crawl.ts` which dynamically imports the crawler's `crawl()` function.
