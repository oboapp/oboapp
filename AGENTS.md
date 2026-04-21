# Agent Development Guidelines

Critical patterns and non-obvious rules for AI agents working on `oboapp`. For detailed domain docs, see the referenced READMEs.

## 0. Editing Agent Primitives (Skills, Instructions, Prompts)

**NEVER edit AI primitive files directly in `.github/skills/`, `.github/instructions/`, `.github/prompts/`, `.github/agents/`, or `.claude/`.** Those are generated outputs [managed by APM](./docs/setup/apm-agent-resources.md). `.github/workflows/` is edited directly as normal.

The canonical source is `agent-context/.apm/` (skills, instructions, prompts, agents). After editing there, run:

```bash
pnpm apm:install
```

Then commit **both** the `agent-context/` source change and the regenerated `.github/` / `.claude/` files together.

`CLAUDE.md` is also a "special" file — it simply re-exports `AGENTS.md` via `@AGENTS.md` and must not be edited directly.

---

## 1. Pre-PR Quality Checks

Before submitting any PR, **all** of these must pass:

```bash
pnpm build              # in shared/ (other packages depend on it)
pnpm lint               # in both ingest/ and web/
pnpm tsc --noEmit       # in both ingest/ and web/
pnpm test:run           # all tests must pass
```

---

## 2. Technical Standards

### Firebase Admin & Environment Variables

**CRITICAL:** `dotenv` must load _before_ Firebase Admin initializes. Always use **dynamic imports** for `@/lib/firebase-admin` inside your main function:

```typescript
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { adminDb } = await import("@/lib/firebase-admin"); // Dynamic import
}
```

### Database Access

**All database operations MUST go through `@oboapp/db`** — never use `adminDb.collection()` directly. Use `getDb()` from `@/lib/db` (lazy singleton available in both `ingest/` and `web/`).

### GeoJSON

- **Coordinates:** Always **[longitude, latitude]** order.
- **Types:** Use `GeoJSONFeatureCollection` from `@/lib/types` (not the `geojson` npm package).
- **Validation:** Use `validateAndFixGeoJSON` from `ingest/crawlers/shared/geojson-validation.ts`.

### TypeScript

- **Strict mode** — no implicit `any`.
- **Exports:** Prefer **named exports** in libraries and shared modules. Use **default exports** where required by frameworks (e.g., Next.js pages/layouts/components in `web/app/**`) or to match existing framework entrypoints.
- **Imports / barrel files:** Avoid "barrel" re-export files in application code; import from the concrete module path instead (e.g., `import { Button } from "@/components/Button"`, not `from "@/components"`).

### ESLint

**NEVER use `eslint-disable` comments.** Fix the underlying issue. If a rule is wrong project-wide, configure it in `eslint.config.mjs`. Exception: generated code or vendor files you cannot modify.

### Tailwind Theme

**Never hardcode color classes** (`bg-blue-*`, `text-gray-*`). Use theme tokens from `web/lib/colors.ts` and `web/lib/theme.ts`. See the `tailwind-theme` skill for the full color system and button API.

### Adding Dependencies

Always use `pnpm add` (or `pnpm add -D`), never edit `package.json` directly.

---

## 3. Domain Guidelines

### Message Ingestion Pipeline

The pipeline processes public infrastructure disruption messages for Sofia, Bulgaria. Crawlers with precomputed GeoJSON skip AI processing entirely. Others go through three LLM stages: **Filter & Split → Categorize → Extract Locations**, then geocoding and event matching.

See `ingest/README.md` for the full pipeline overview and `ingest/messageIngest/README.md` for stage details.

### Event Aggregation

**CRITICAL — Event schema mirrors Message schema.** `EventSchema` fields use the same names and types as `MessageSchema` (`plainText`, `markdownText`, `geoJson`, `categories`, `timespanStart/End`, `cityWide`, `locality`, `embedding`, etc.). Keep field names consistent when adding new event fields.

See `docs/features/event-aggregation.md` for matching logic and thresholds.

### Crawler Development

For the full implementation guide, see the `long-flow-crawler-generator` skill. Key traps:

- **Check for an exposed API first:** Before writing any Playwright scraper, check if the site publishes an RSS/ATOM feed or JSON API (try `/feed`, `/rss.xml`, `/atom.xml`, inspect `<link rel="alternate">` in `<head>`, and trace any AJAX calls in the page JS). A plain HTTP feed is far more reliable than headless Chromium.

- **Workflow Sync (CRITICAL):** When adding/removing crawlers, update ALL:
  1. `ingest/crawlers/{source-name}/` — implementation
  2. `local.crawlers` in `ingest/terraform/main.tf` — add entry (set `emergent = true` for 30-min crawlers)
  3. `shared/src/sources.ts` — `SOURCES` array (display name, URL, localities)
  4. If emergent (30-min intervals): also `EMERGENT_CRAWLERS` in `ingest/pipeline.ts`

- **Emergent Classification:** Emergent crawlers run every 30 minutes; all others run 3× daily. This affects workflow definitions and Cloud Scheduler.

### Geocoding Rate Limits

See `ingest/geocoding/README.md` for service routing details. **Rate limits are critical:**

| Service  | Delay  | Reason                                      |
| -------- | ------ | ------------------------------------------- |
| Google   | 200ms  | API pricing/quota                           |
| Overpass | 500ms  | Fair use (free OSM)                         |
| Cadastre | 2000ms | Session management + respect government API |

### Bulgarian Language

UI text is in Bulgarian using informal (ти) register. See `.github/instructions/bulgarian-language.instructions.md`.

### Public API

- Endpoints exposed under `/api/v1` with API key auth.
- `docs/features/public-api.md` is the single source of truth.
