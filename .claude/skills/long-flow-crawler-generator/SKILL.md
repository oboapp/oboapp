---
name: long-flow-crawler-generator
description: Build a website or feed source package and connect it to Obo's text ingestion pipeline
agent-name: copilot
version: 2.0.0
keywords:
  - crawler
  - source-package
  - long-flow
  - wordpress
---

# Collecting website and feed notices

Implement provider requests and extraction in [oboapp/sources](https://github.com/oboapp/sources). Obo's scheduled runner checks existing identifiers, validates content and persists complete raw records. Text notices then go through filtering, categorization, location extraction and geocoding. See `docs/features/source-packages.md` and `ingest/messageIngest/README.md` in the application.

## Establish coverage and identity

- For a migration, read the current implementation and tests. Record the source ID, exact item identifiers, date and content rules, listing window, request spacing, locality and schedule. Compare old and new public links when a provider has changed its website.
- Look for an advertised RSS or Atom feed, a JSON API, or the endpoint used by a public listing. Verify discovery, full article content and publication dates with representative notices. Use browser navigation when the provider requires rendered content.
- For a new source, establish which sections carry relevant notices. A small recent page works for a newest-first feed. Preserve existing limits for migrated sources. Document pagination and gaps in the package README.
- Keep representative fixtures with the package tests. For a rendered site, retain the listing and article screenshot baselines alongside the Obo integration.

## Implement the provider package

1. Follow the sources repository's `AGENTS.md` and `RELEASING.md`. Use the released SDK and a similar provider package as the starting point. Compare Triaditsa for a full-content feed or Oborishte for feed discovery with browser details.
2. Export `createSource` and an isolated `/metadata` entrypoint. Return literal historical identifiers from `discoverItems`. Keep serialized discovery payloads within the SDK limit. Keep larger content in the current source instance when the provider supplies it in a listing.
3. Return the title, message and publication timestamp from `fetchItem`. Preserve provider-specific Markdown, attachments and date fallbacks. A text-only notice can omit geometry. For each request, honor the provider's pacing and distinguish an empty listing from an HTTP or parsing error. Release pages and browsers on success and failure.
4. Exercise the actual package factory, both module formats and isolated metadata. Cover repeated identifiers, missing content, partial failures, fallbacks and cleanup. Use the sources repository's README template to describe coverage, limitations and runtime dependencies.
5. Follow the package's review, release archive and npm publication workflow. Verify the registry version and archive integrity before pinning that version in an instance.

## Connect and verify the Obo instance

1. Install the exact published package with `pnpm --dir ingest add --save-exact`. Connect its factory and metadata in `ingest/crawlers/<source-id>/index.ts` using the scheduled source runner. Follow the existing entrypoint pattern for dotenv and lazy database initialization.
2. Keep the browser-safe source definition in `shared/src/sources/<source-id>.ts` consistent with the package metadata. Select it in `shared/src/sources.ts` and `ingest/terraform/source-jobs.<locality>.json` for instances that should run it. Add a 200 × 200 source logo for a new catalog entry. A migration keeps the source's deployed job key, resources and schedule.
3. Run `pnpm --dir ingest exec tsx scripts/check-source-config.ts`. Use an in-memory store or the emulator to exercise collection through raw persistence and downstream message ingestion. Check historical base64 and MD5 identifiers, repeat scans and retries after failure. For preliminary provider checks, use the runner's database-free preview.
4. Run the repository's build, lint, TypeScript and test checks. Review CI and the actual quality gate. After the fork deploys, verify the image and a scheduled scan before backporting the integration upstream.
