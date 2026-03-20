# OboApp

A civic tech platform that helps residents of Sofia stay informed about infrastructure disruptions. The app automatically aggregates public announcements about water shutoffs, heating maintenance, road repairs, and municipal works, displaying them on an interactive map with push notifications for areas you care about.

## ⚠️ MONOREPO SETUP

**This is a pnpm workspace monorepo. Always run `pnpm install` at the repository root.**

The shared package builds automatically via postinstall hook. Dependencies are managed by pnpm with `shamefully-hoist=true`.

**CRITICAL:** When modifying shared package schemas, rebuild is required before running code in web/ingest:

- Run `pnpm build` in `shared/` directory, OR
- Run `pnpm install` at repository root (triggers postinstall hook)

## Project Structure

This monorepo contains four packages:

- **[shared/](shared)** - Shared TypeScript schemas (Zod) used by both web and ingest
- **[db/](db)** - Database abstraction layer (`@oboapp/db`) — dual-write over Firestore and MongoDB
- **[ingest/](ingest)** - Automated data collection and processing pipeline
- **[web/](web)** - Next.js web application

## How It Works

### Ingest Pipeline

Automated crawlers collect notices from public sources (water company, heating provider, municipal sites). AI-powered extraction and multi-service geocoding (Google, OpenStreetMap, Bulgarian Cadastre, GTFS) converts raw text into map-ready GeoJSON. The notification engine matches new disruptions with user-defined interest areas and sends push notifications.

See [ingest/](ingest) for details.

### Web App

Next.js application with an interactive Google Maps interface. Users can browse current disruptions, define interest circles with custom radius, and receive push notifications when new issues affect their areas. Installable as a Progressive Web App.

See [web/](web) for details.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Google Maps API
- **Backend**: Node.js, Firebase (Auth, Cloud Messaging), Firestore, MongoDB
- **Database**: `@oboapp/db` abstraction with dual-write support (see [Database Layer](docs/features/database-layer.md))
- **AI**: Google Gemini for address extraction
- **Infrastructure**: Google Cloud Run, Terraform, Docker, Vercel
- **Automation**: Playwright for web scraping

## Documentation

### Features

- [Message Filtering](docs/features/message-filtering.md) - AI-powered content filtering, address extraction, geocoding, and time-based relevance
- [Message URLs](docs/features/message-urls.md) - Short, shareable URLs for deep-linking to messages
- [Geocoding System](ingest/geocoding/README.md) - Multi-service geocoding with Google, OpenStreetMap, Bulgarian Cadastre, and GTFS APIs
- [Onboarding Flow](docs/features/onboarding-flow.md) - User onboarding state machine for notifications and zone creation
- [Database Layer](docs/features/database-layer.md) - Dual-write database abstraction over Firestore and MongoDB
- [Locality Configuration](docs/features/multi-locality-support.md) - Environment-based locality configuration for hosting in different cities
- [Public API](docs/features/public-api.md) - Read-only `/api/v1` API, API key auth, and client onboarding

### Pipeline

- [Ingest Overview](ingest/README.md) - Data collection and processing pipeline architecture
- [Message Processing](ingest/messageIngest/README.md) - Filtering, extraction, geocoding, and GeoJSON conversion flow
- [Crawlers](ingest/crawlers/README.md) - Data sources and web scraping implementations

### Operations

- [Notifications](ingest/notifications/README.md) - Push notification matching and delivery
- [Terraform](ingest/terraform/README.md) - Cloud Run deployment and infrastructure
- [Web App](web/README.md) - PWA installation and browser support

## Style

Documentation is written for technical stakeholders, system administrators, and QA personnel who need to understand system behavior and configuration. Focus is on facts and behavior rather than implementation details, with diagrams for complex flows and practical configuration guidance. We keep it short and informative. We avoid excessive explanations of topics that are standard to the industry or easy to understand.

## Contributing

**Choose your setup path based on what you're working on:**

- **Front-end only (no Java/Docker)**: [Quick Start: Front-End with MSW](docs/setup/quick-start-frontend-msw.md) - Mock Service Worker for UI development
- **Full stack (emulators)**: [Quick Start: Firebase Emulators](docs/setup/quick-start-emulators.md) - Local Firebase for backend integration
- **Production deployment**: [Production Setup Guide](docs/setup/production-setup.md) - Google Cloud configuration

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development guidelines.
