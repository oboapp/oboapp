# Contributing to OboApp

Thank you for your interest in contributing!

## Quick Start

**Choose your development path:**

- **Front-end only** (no Java/Docker): **[Quick Start with MSW](docs/setup/quick-start-frontend-msw.md)** - Mock Service Worker for UI development
- **Full-stack** (zero cloud deps): **[Quick Start with Emulators](docs/setup/quick-start-emulators.md)** - Firebase emulators for backend integration
- **Production setup**: **[Production Setup Guide](docs/setup/production-setup.md)** - Real Firebase/Google Cloud configuration

## Project Structure

Monorepo with three main directories:

- **`/web`** - Next.js application (frontend + API routes)
- **`/ingest`** - Data pipeline (crawlers, AI processing, geocoding)
- **`/api`** - Public REST API server (Hono, `/v1` routes)

Each has its own `.env.local` configuration.

## Development Resources

- **[AGENTS.md](AGENTS.md)** - Required code patterns and standards for AI agents and developers
- **[APM Agent Resources](docs/setup/apm-agent-resources.md)** - How agent primitives (instructions, prompts, agents, skills) are managed via APM
- **[Public API](docs/features/public-api.md)** - `/api/v1` contract, API key auth, and client onboarding
- **[External API Mocks](docs/features/external-api-mocks.md)** - Mock Gemini, Geocoding, Overpass, Cadastre
- **[Geocoding](ingest/geocoding/README.md)** - Hybrid geocoding system documentation
- **[Fork and Upstream PR Workflow](docs/setup/fork-upstream-pr-workflow.md)** - Branch from `oboapp/oboapp:main`, push to your fork, and open the PR upstream when the change belongs in the base repo

## Code Standards

- Follow patterns in [AGENTS.md](AGENTS.md)
- TypeScript strict mode, named exports, no barrel files
- Tailwind theme colors from `web/lib/colors.ts` - never hardcode
- Never use `eslint-disable` comments - fix the issue instead
- Add Vitest tests for new functionality (**at least for the pure functions**)

## Pull Request Process

1. Fork and create feature branch

   - For shared or upstream-facing work, follow the [Fork and Upstream PR Workflow](docs/setup/fork-upstream-pr-workflow.md).

2. Follow [AGENTS.md](AGENTS.md) patterns
3. Add tests for new functionality
4. Run `pnpm test:run` in `web/`, `ingest/`, and `api/`
5. Submit PR with clear description
