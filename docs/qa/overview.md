# Quality Assurance Overview

This document outlines the quality assurance strategy across the oboapp monorepo.

## Approach Summary

| Layer | Tool | When |
|-------|------|------|
| Static analysis (lint) | ESLint | Pre-commit hook; run manually before opening a PR |
| Circular dependency check | dpdm | Every PR in CI |
| Unit tests | Vitest | CI on every PR (`ingest`, `web`); run locally for all packages |
| Integration tests | Vitest (real APIs) | Manual, before merging pipeline changes |
| Component tests | Testing Library + MSW | CI on every PR |
| LLM prompt evaluation | promptfoo | Manual, before merging prompt changes |
| Browser checks | Playwright with Node's test runner | Local MSW checks before UI changes are merged |
| E2E specifications | Gherkin (`.feature` files) | Reference; not yet run in CI |

## Static Analysis

A pre-commit hook (Husky + lint-staged) runs ESLint automatically on staged files in `web/`, `ingest/`, and `shared/` before each commit.

**`eslint-disable` comments are generally not permitted** — lint errors must be fixed at the source. Exceptions are allowed only for generated or vendor code that cannot be modified.

Run lint and TypeScript checks manually before opening a PR (from the respective package directory):

```bash
pnpm lint
pnpm tsc --noEmit
```

Or lint all packages at once from the repo root:

```bash
pnpm lint:all
```

Circular dependency detection uses `dpdm` and runs in CI on every pull request to catch import cycles across all packages.

## Unit Tests

Unit tests live alongside source files and use Vitest across the five packages (`api`, `db`, `shared`, `ingest`, `web`).

```bash
cd web    && pnpm test:run
cd ingest && pnpm test:run
cd db     && pnpm test:run
cd shared && pnpm test
cd api    && pnpm test:run
```

## Integration Tests

Integration tests for the AI pipeline call the live Gemini API with real source fixtures. They are excluded from the standard `test:run` command and require API credentials set in `ingest/.env.local` (`GOOGLE_AI_API_KEY`, `GOOGLE_AI_MODEL`).

```bash
cd ingest
GOOGLE_AI_API_KEY=your_key pnpm test:integration
```

Run these before merging changes to the AI pipeline. See [Message Filtering](../features/message-filtering.md) for the pipeline under test.

## Component Tests (Web)

React components are tested with [Testing Library](https://testing-library.com/) and [happy-dom](https://github.com/capricorn86/happy-dom). API calls are intercepted by Mock Service Worker (MSW) during tests, using the same handlers that power [MSW-based local development](../setup/quick-start-frontend-msw.md).

## LLM Prompt Evaluation

AI prompts (filter/split, categorize, extract-locations, verify-event-match) are validated with promptfoo against Gemini using fixture inputs and Zod schema assertions.

Run before merging any changes to prompt files or AI service schemas. See [Prompt Evaluation](prompt-evaluation.md) for details.

## Browser Checks

The My zones browser check uses a local app running with
[MSW mock data](../setup/quick-start-frontend-msw.md) and a working Google Maps key.
It checks visible event cards below saved zones, opening event details, zone
filtering, map interaction, existing filters, and zone deletion through the user
interface. It also checks the phone and tablet layouts, where zone badges center
the map and the event list follows the current map area.

With the local server running, execute from the repository root:

```bash
pnpm --filter oboapp-web exec node --test e2e/my-zones.e2e.mjs
```

Install Chromium with `pnpm --filter oboapp-web exec playwright install chromium`,
or set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge browser.
The test verifies mock data before changing zones and accepts only a local URL.

## E2E Specifications

Gherkin feature files in `e2e/` describe expected end-to-end behavior for key API endpoints and UI flows. They serve as specifications; their step definitions are not automated yet. Running browser tests in CI is a future goal (see [Future Plans](#future-plans)).

## CI/CD Pipeline

Every pull request triggers the [CI pipeline](../../.github/workflows/ci.yml):

1. **Dependency check** — `dpdm` circular dependency scan across all packages
2. **Test ingest** — `pnpm test:run` in `ingest/`
3. **Test web** — `pnpm test:run` in `web/`
4. **Build web** — Next.js build check

The web build job sets `NEXT_PUBLIC_LOCALITY` explicitly for deterministic behavior in upstream CI. Instance forks can change this value in their own workflow configuration when targeting a different locality.

On push to `main`, a separate [deploy workflow](../../.github/workflows/deploy.yml) handles Docker build, push to GCP, and Terraform apply. This workflow lives only in instance forks, not in the upstream `oboapp/oboapp` repo.

A [CI failure agent](../../.github/workflows/ci-failure-agent.yml) creates GitHub issues for failed runs and labels them for Copilot triage (`ci-failure`, `copilot`).

## Local Development Environment

For testing locally without cloud dependencies, see:

- [Quick Start with Emulators](../setup/quick-start-emulators.md) — Firebase Emulators + mock external APIs
- [External API Mocks](../features/external-api-mocks.md) — Mock Gemini, Google Geocoding, Overpass, Cadastre
- [Quick Start with MSW](../setup/quick-start-frontend-msw.md) — Frontend development without emulators

## Future Plans

- Run E2E tests in CI against a staging environment (implement step definitions for `e2e/*.feature` files)
- Expand promptfoo eval fixtures to cover more edge cases and regression scenarios
