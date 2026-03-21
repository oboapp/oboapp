---
name: Logging Conventions
description: Guidelines for logging in the ingest and web packages
version: 1.0.0
keywords:
  - logging
  - logger
  - console
  - log level
  - debug
  - info
  - warn
  - error
  - crawler
  - structured logging
---

# Logging Conventions Skill

**IMPORTANT**: Using Logging Conventions skill! Follow these guidelines when adding or modifying log statements.

## Two Different Worlds: `ingest` vs `web`

| | `ingest` | `web` |
|---|---|---|
| **Logger** | `import { logger } from "@/lib/logger"` | ❌ No structured logger |
| **Console** | ✅ Structured via `logger.*` | ⚠️ Allowed with caution — ESLint `no-console` at `warn` level |
| **Output target** | Cloud Logging (JSON in prod) | Browser DevTools / server stderr |

### `ingest` — Use the Structured Logger

All logging in `ingest/` **must** go through the structured logger:

```typescript
import { logger } from "@/lib/logger";

logger.debug("Fetching post", { sourceType, url });
logger.info("Crawl complete", { sourceType, saved: 4, skipped: 6 });
logger.warn("Invalid date format", { dateStr });
logger.error("Crawl failed", { sourceType, error: error.message });
```

Never use `console.log`, `console.warn`, or `console.error` directly in `ingest/` code.

### `web` — Console Statements with Caution

Console statements in `web/` are linted at `warn` level (`no-console`). Using `console.*` is fine during development, but these statements should not reach users' browsers in production. The `warn` level means we allow it but flag it for review — think twice before shipping a `console.log` to end users.

## Log Level Semantics (Ingest)

| Level | When to use | Example |
|---|---|---|
| `debug` | Per-item operational steps, intermediate progress | `"Fetching post"`, `"Saved document"`, `"Extracted pins"` |
| `info` | High-level milestones and summaries (start, finish, counts) | `"Starting crawler"`, `"Crawl complete"` |
| `warn` | Recoverable issues, fallbacks, skipped items | `"Invalid date, using current"`, `"No posts found"` |
| `error` | Failures that need attention | `"Crawl failed"`, `"Fatal error"` |

### Debug Visibility

- **Locally**: `debug` is suppressed by default. Set `LOG_LEVEL=debug` to show.
- **Production**: `debug` is always emitted for Cloud Logging filtering.

## Crawler Logging Pattern

Every crawler should emit exactly **two INFO lines** plus any warnings/errors:

```
INFO  Starting crawler   { sourceType: "sofia-bg" }
INFO  Crawl complete     { sourceType: "sofia-bg", total: 10, saved: 4, skipped: 6, failed: 0 }
```

All per-item details (fetching, saving, skipping) go to `debug`.

### Required Metadata

- Always include `sourceType` in crawler-level log entries for filtering. Shared helpers that receive a document (e.g., `saveSourceDocument`) can read `sourceType` from the document itself. Generic utilities without source context (e.g., shared extractors) are exempt.
- Summary logs should include counts: `saved`, `skipped`, `failed`, and `total`.
- Error logs should include the error message in an `error` field.

## Quick Checks

- [ ] No `console.*` in `ingest/` code — use `logger.*` instead
- [ ] No new `console.*` in `web/` code that would reach users' browsers
- [ ] Per-item logs use `debug`, not `info`
- [ ] Start/summary logs use `info` with structured metadata
- [ ] `sourceType` is included in crawler-level log entries
