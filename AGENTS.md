# Agent Development Guidelines

Critical patterns and non-obvious rules for AI agents working on `oboapp`. For detailed domain docs, see the referenced READMEs.

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

- **Workflow Sync (CRITICAL):** When adding/removing crawlers, update ALL:
  1. `ingest/crawlers/{source-name}/` — implementation
  2. `ingest/terraform/workflows/all.yaml` — parallel execution step
  3. `shared/src/sources.ts` — `SOURCES` array (display name, URL, localities)
  4. If emergent (30-min intervals): also `ingest/terraform/workflows/emergent.yaml` and `EMERGENT_CRAWLERS` in `ingest/pipeline.ts`

- **Unique `logN` Step Names (CRITICAL):** Error-handler steps in `all.yaml` and `emergent.yaml` use sequential `logN` names. GCP Workflows requires these to be **unique within each file**. Always **read the file first**, find the highest `logN`, and use `logN+1`. Numbering resets per file.

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
