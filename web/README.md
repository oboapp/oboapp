# Web Application

Next.js web application for **OboApp** - a civic engagement platform for residents of Sofia, Bulgaria. Aggregates and visualizes public announcements about local events, infrastructure work, and service disruptions on an interactive map.

## ⚠️ WORKSPACE SETUP

This package is part of a pnpm workspace. **Run `pnpm install` at the repository root**, not in this directory.

## ⚠️ SHARED PACKAGE HOT RELOAD

Next.js uses `transpilePackages: ['@oboapp/shared']` to automatically transpile and hot-reload changes from the shared package during development. No manual rebuild of shared is needed while running `pnpm dev`.

## Tech Stack

- **Next.js 16** with React 19 and TypeScript
- **Firebase** (Authentication, Firestore, Cloud Messaging)
- **Google Maps API** for interactive mapping
- **Turf.js** for geospatial analysis
- **Tailwind CSS v4** with centralized theme system
- **@oboapp/shared** - Shared Zod schemas from workspace

## Hosting

The web app is a standard Next.js application and can be hosted on any platform that supports Node.js or a Next.js build output. Hosting configuration is a downstream/fork concern; the upstream repository is platform-neutral.

## Styling

The application uses a centralized Tailwind CSS theme system:

- **Theme colors**: Defined in [lib/colors.ts](lib/colors.ts) as the single source of truth
- **CSS variables**: Implemented in [app/globals.css](app/globals.css) using Tailwind v4 @theme
- **Utilities**: Button styles and helpers available in [lib/theme.ts](lib/theme.ts)

See [AGENTS.md](../AGENTS.md#tailwind-theme-system) for usage guidelines.

## Key Features

- Interactive map displaying geolocated messages from municipal sources
- User-defined interest zones with customizable radius
- Push notifications for new messages in areas of interest
- Progressive Web App with offline support

## Push Notifications

### Browser Support

Push notifications are supported on:

- **Chrome/Edge/Opera** (Desktop & Android) - works in regular browser
- **Firefox** (Desktop & Android) - works in regular browser
- **Safari** (macOS 16.4+) - works in regular browser
- **Safari** (iOS 16.4+) - **requires PWA installation**

### iOS Safari Requirements

**Important:** On iOS Safari, push notifications only work when the app is installed as a PWA (added to Home Screen). This is a platform limitation by Apple.

To enable notifications on iOS Safari:

1. Open the app in Safari
2. Tap the Share button (square with arrow)
3. Select "Add to Home Screen"
4. Open the app from your Home Screen
5. Grant notification permission when prompted

The app automatically detects iOS Safari and displays installation instructions when needed.

## Ingestion

Backend data ingestion handled by the [`/ingest`](../ingest) folder.
