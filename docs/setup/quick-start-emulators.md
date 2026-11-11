# Quick Start with Firebase Emulators

Run oboapp locally with Firebase Emulators and mock AI and geocoding services.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+

## Setup (5 minutes)

### 1. Configure Environment

```bash
# Copy environment templates
cp ingest/.env.example.emulator ingest/.env.local
cp web/.env.example.emulator web/.env.local
```

### 2. Install Dependencies

```bash
pnpm install
```

**Note:** run dependency installation the root folder of the monorepo

### 3. Start Emulators

#### 3.1. via Docker

```bash
docker-compose up firebase-emulators
```

Wait for: `✔  All emulators ready! It is now safe to connect your app.`

#### 3.2. without using Docker

```bash
cd ingest
pnpm emulators
```

Wait for: `✔  All emulators ready! It is now safe to connect your app.`
**Emulator UI:** http://localhost:4000

### 4. Seed Test Data (First Time)

Open new terminal:

```bash
cd ingest
pnpm emulator:seed
```

Seeded messages are intentionally labeled as test data so they are clearly fake if they are viewed outside the emulator workflow.

Stop emulators (Ctrl+C), then restart. Data persists across restarts.

### 5. Start Web App

```bash
cd web
pnpm dev
```

Make sure to add your Google Maps API key to the `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` variable in `web/.env.local`.

**App:** http://localhost:3000

## What You Get

- Firestore database with sample messages, sources, interest zones
- Firebase Authentication (Google Sign-In mocked)
- Mock AI and geocoding APIs (Gemini, Google Geocoding, Overpass, Cadastre)
- Emulator UI for data inspection

## Common Operations

**Collect source data into the emulator:**

```bash
cd ingest
pnpm exec playwright install chromium
pnpm crawl --source rayon-oborishte-bg
```

Install Chromium once for browser-backed sources. With the emulator configuration from step 1 active, this command reads live Oborishte pages and saves raw source documents in your local Firestore emulator. The `MOCK_*` flags apply to AI and geocoding calls during ingestion.

**Run ingestion pipeline (mocked):**

```bash
cd ingest
pnpm ingest
```

**Reset data:**

```bash
cd ingest
pnpm emulator:clear
pnpm emulator:seed
```

Run the reseed commands after pulling changes to the seed fixtures so existing local emulator data picks up the latest warning text.

## Troubleshooting

**Emulators won't start:** Install firebase-tools globally: `pnpm add -g firebase-tools`

**Web app can't connect:** Verify `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `web/.env.local`

**Empty Firestore UI:** Navigate to http://localhost:4000/firestore/default/data?ns=demo-project

**Mock APIs not working:** Verify `MOCK_*=true` variables in `ingest/.env.local`

## Known Limitations

- Firebase Cloud Messaging has no emulator
- Firestore indexes are ignored
- Source collection uses live provider sites

For production setup, see [production-setup.md](production-setup.md).

For mock customization, see [external-api-mocks.md](../features/external-api-mocks.md).
