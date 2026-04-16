---
name: cli-scripts
description: Standard pattern for writing CLI scripts using Commander.js
version: 1.0.0
keywords:
  - cli
  - script
  - commander
  - argv
  - process.argv
---

# CLI Scripts with Commander.js Skill

**IMPORTANT**: Using CLI Scripts skill! All JS/TS scripts that accept command-line arguments **must** use [Commander.js](https://github.com/tj/commander.js). Never use raw `process.argv` parsing.

## Standard Pattern

Every CLI script in `ingest/` follows this structure:

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { logger } from "@/lib/logger";

const program = new Command();

program
  .name("script-name")
  .description("One-line description of what this script does")
  .option("--dry-run", "Preview changes without writing")
  .option("-s, --source <type>", "Filter by source type")
  .option("-l, --limit <n>", "Maximum items to process", parseInt)
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm tsx ingest/scripts/script-name
  $ pnpm tsx ingest/scripts/script-name --dry-run
`,
  )
  .action(async (opts) => {
    // Load env INSIDE the action — never at module level
    dotenv.config({ path: resolve(process.cwd(), ".env.local") });

    try {
      await run(opts);
    } catch (error) {
      logger.error("Fatal error", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });

program.parse();
```

For scripts with async actions use `program.parseAsync()` instead of `program.parse()`.

## Rules

1. **Always use Commander.js** — never `process.argv.includes()`, `process.argv.find()`, or manual argument loops.
2. **`dotenv.config()` inside `.action()`** — never at the top level of the file. This prevents env vars from loading during import/parse time (critical for Firebase Admin).
3. **Dynamic imports inside `.action()`** — any module that transitively imports `firebase-admin` or other heavy deps must be imported inside the action, not at the top of the file.
4. **`program.parse()` at the bottom** — the last statement of top-level scripts.
5. **Async scripts** — use `program.parseAsync().catch(...)` if the action is async and you need top-level error handling.
6. **Reusable scripts** — if the script exports a function (e.g., `ingest()`), wrap the Commander setup in `if (require.main === module) { ... }` so the module stays importable without side effects.

## Existing Examples to Read

- `ingest/crawl.ts` — required option, dynamic import, `program.parse()`
- `ingest/pipeline.ts` — multiple boolean flags, `addHelpText` with dynamic content
- `ingest/sources-clean.ts` — `requiredOption`, `--dry-run`
- `ingest/notify.ts` — no options, simple action
- `ingest/messageIngest/from-sources.ts` — wrapped in `require.main === module`, exports `ingest()`
- `ingest/scripts/reprocess-failed-messages.ts` — `--execute` flag (inverted dry-run), `--days <n>`

## Quick Checks Before Shipping

- [ ] `import { Command } from "commander"` is present
- [ ] No `process.argv` access anywhere in the file
- [ ] `dotenv.config()` is called inside `.action()`, not at module level
- [ ] Heavy imports (firebase-admin, db) are dynamic imports inside `.action()`
- [ ] `program.parse()` or `program.parseAsync()` is the last statement
- [ ] `.name()` and `.description()` are set
- [ ] Help text includes at least one usage example

---

## Finding Existing Scripts

All one-off / maintenance scripts live in `ingest/scripts/`. **Before writing a new script, check whether one already exists.**

Every script in that directory has its purpose, steps, and usage documented in the first ~20 lines as a JSDoc/block comment. To discover what's available, read just those headers:

```bash
# List all scripts
ls ingest/scripts/

# Skim the header of any candidate
head -20 ingest/scripts/<name>.ts
```

When asked to perform a data operation (delete messages, reprocess sources, seed the emulator, manage geocode cache, etc.), always list `ingest/scripts/` and read the top of relevant files before writing anything new.
