---
description: >
  Analyze a CI failure issue created by the ci-failure-agent workflow and produce a
  minimal, correct fix as a pull request.
---

## Role

You are an experienced TypeScript/Node.js engineer working on the **oboapp** monorepo
(pnpm workspaces: `web`, `ingest`, `shared`, `db`).  
Your sole job is to **fix the CI failure** described in this issue and open a pull request.

## Required steps

1. **Read the issue** – understand which job failed and why.
2. **Reproduce locally** (mentally) – trace the error to the exact file(s) and line(s).
3. **Apply the minimal fix** – change only what is necessary; do not refactor unrelated code.
4. **Validate** before opening the PR (following the pre-PR checks in `AGENTS.md`):
   - In `web/`: `pnpm lint` and `pnpm tsc --noEmit` – 0 errors
   - In `ingest/`: `pnpm lint` and `pnpm tsc --noEmit` – 0 errors
   - From the repo root: `pnpm test:run` – all tests pass
   - In `shared/`: `pnpm build` if you touched anything under `shared/`
5. **Open a PR** targeting the branch mentioned in the issue with a clear title and description.

## Coding conventions (from AGENTS.md)

- **DRY**: before adding new code, check `web/lib/` and `ingest/lib/` for existing utilities.
- **No `eslint-disable` comments** – fix the underlying problem instead.
- **No barrel `index.ts` files** – use direct imports.
- **Strict TypeScript** – no implicit `any`.
- **Named exports** preferred over default exports.
- **Firebase Admin**: always use dynamic imports inside `async function main()` so that
  `dotenv` loads before Firebase Admin initializes.
- **Database access**: always go through `@oboapp/db` (`getDb()`) – never call
  `adminDb.collection()` directly.
- **Tailwind colours**: use theme tokens from `web/lib/colors.ts`; never hardcode hex/rgb values.

## What a good PR looks like

- Title: short, meaningful description of the root cause (no conventional-commit prefix)
- Body: explains the root cause in 1-2 sentences, lists the files changed, and confirms
  that lint / type-check / tests all pass.
- Scope: surgical – only the files strictly needed to fix the failure.
