# Quality Assurance Overview

This document outlines the quality assurance strategy across the oboapp monorepo.

## Approach Summary

| Layer | Tool | When |
|-------|------|------|
| Static analysis | ESLint + TypeScript | Every commit (pre-commit hook) and CI |
| Circular dependency check | dpdm | Every PR in CI |
| Unit tests | Vitest | Every commit (pre-commit hook) and CI |
| Integration tests | Vitest (real APIs) | Manual, before merging pipeline changes |
| Component tests | Testing Library + MSW | Every commit and CI |
| LLM prompt evaluation | promptfoo | Manual, before merging prompt changes |
| E2E specifications | Gherkin (`.feature` files) | Reference — not yet run in CI |

## Static Analysis

All packages enforce ESLint rules and TypeScript type checking. Pre-commit hooks (Husky + lint-staged) run these automatically before each commit.

**No `eslint-disable` comments are permitted** — lint errors must be fixed at the source.

Run manually in `web/` or `ingest/`:

```bash
pnpm lint
pnpm tsc --noEmit
```

Circular dependency detection uses `dpdm` and runs in CI on every pull request to catch import cycles across all packages.

## Unit Tests

Unit tests live alongside source files and use Vitest. ~140 test files are spread across the four packages (`db`, `shared`, `ingest`, `web`).

```bash
cd web    && pnpm test:run
cd ingest && pnpm test:run
cd db     && pnpm test:run
cd shared && pnpm test:run
```

Watch mode during development:

```bash
pnpm test  # runs Vitest in watch mode
```

## Integration Tests

Integration tests for the AI pipeline call the live Gemini API with real source fixtures. They are excluded from the standard `test:run` command and require API credentials.

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

## E2E Specifications

Gherkin feature files in `e2e/` describe expected end-to-end behavior for key API endpoints and UI flows:

- `heatmap-api.feature` — Heatmap API endpoint
- `history-heatmap.feature` — Historical heatmap data
- `notification-filters.feature` — Notification filtering UI

These are specification documents. There is no automated runner configured yet — executing E2E tests in CI is a future goal (see [Future Plans](#future-plans)).

## CI/CD Pipeline

Every pull request triggers the [CI/CD pipeline](../../.github/workflows/ci-cd.yml):

1. **Dependency check** — `dpdm` circular dependency scan across all packages
2. **Test ingest** — `pnpm test:run` in `ingest/`
3. **Test web** — `pnpm test:run` in `web/`
4. **Build & Deploy** — (main branch only) Docker build, push to GCP, Terraform apply

A [CI failure agent](../../.github/workflows/ci-failure-agent.yml) creates GitHub issues for failed runs and auto-assigns them to Copilot for investigation.

## Local Development Environment

For testing locally without cloud dependencies, see:

- [Quick Start with Emulators](../setup/quick-start-emulators.md) — Firebase Emulators + mock external APIs
- [External API Mocks](../features/external-api-mocks.md) — Mock Gemini, Google Geocoding, Overpass, Cadastre
- [Quick Start with MSW](../setup/quick-start-frontend-msw.md) — Frontend development without emulators

## Future Plans

- Run E2E tests in CI against a staging environment (implement step definitions for `e2e/*.feature` files)
- Expand promptfoo eval fixtures to cover more edge cases and regression scenarios
