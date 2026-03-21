# Event Aggregation

## Overview

Multiple sources (crawlers) sometimes report the same real-world incident — for example, both the municipality's website and Toplofikatsia may announce the same heating outage. Without aggregation, each announcement becomes a duplicate marker on the map.

The **Event Aggregation** layer groups related messages into a single **Event** representing one real-world incident. Each Event tracks which messages contributed to it, selects the best available geometry, and provides a canonical description.

## Design Principle: Events Mirror the Message Shape

**Events intentionally use the same field names and types as messages.** Fields like `plainText`, `markdownText`, `geoJson`, `categories`, `timespanStart`, `timespanEnd`, `cityWide`, `locality`, and `embedding` exist on both documents with identical semantics.

This is a deliberate forward-compatibility decision: the next phase will switch the map and public API from showing individual messages to showing events. Because the shapes are aligned, that switch requires only a data-source change — no schema migration, no API contract break, no frontend rewiring.

When adding fields to the `EventSchema`, always check whether the same field belongs on `MessageSchema` too, and keep naming consistent.

## How It Works

When a message is finalized with GeoJSON, the pipeline automatically tries to match it against existing events:

1. **Find candidates** — queries events in the same locality within a ±2 day time window
2. **Score each candidate** — computes a weighted score based on location proximity, time overlap, text similarity (via embeddings), and category similarity
3. **Decide:**
   - Score ≥ 0.70 → **auto-attach** to the event
   - Score 0.55–0.70 → **ask Gemini to verify** whether both texts describe the same incident; attach only if confirmed
   - Score < 0.55 → **create a new event**

Matching never blocks the main pipeline — failures are logged but don't prevent message finalization.

### What Happens When a Message Matches

- **Timespans** expand to cover both the existing event and the new message
- **Geometry** upgrades if the new message comes from a more trusted source
- **Sources** and **categories** merge (deduplicated)

### City-Wide Events

City-wide messages only match against other city-wide events. They always score maximum location similarity since they apply to the entire city.

### Pre-Geocoding Reuse

Before geocoding, the pipeline checks if a high-quality event already exists for the same incident. If found (score ≥ 0.80, geometry quality ≥ 2), the event's geometry is reused and geocoding is skipped entirely. This saves Google/Overpass API calls when a trusted source has already been geocoded. When embeddings are available, the threshold lowers to 0.75 since text similarity provides an additional matching signal.

Pre-geocoding scoring uses time overlap and category match (no spatial comparison since GeoJSON doesn't exist yet). When embeddings are available, text similarity is included in the pre-geocode score.

### Text Similarity (Embeddings)

Messages and events store text embeddings generated via Gemini `gemini-embedding-001` (768 dimensions). When both a message and a candidate event have embeddings, cosine similarity is included as a matching signal. Embeddings are optional — old messages/events without embeddings use fallback weights automatically.

Scoring weights and fallback formulas are defined alongside other matching constants in the event-matching module.

**Configuration:** Set `GOOGLE_EMBEDDING_MODEL` environment variable to control the embedding model.

**Cleanup:** Expired messages/events have their embedding fields removed to save storage. A cleanup script in `ingest/scripts/` can be run manually or scheduled as a weekly cron.

### LLM Verification (Uncertain Matches)

When a candidate scores between 0.55 and 0.70, the score alone isn't confident enough for automatic matching. The pipeline asks Gemini to compare the two texts and determine if they describe the same real-world incident.

- **Input**: both message texts, plus optional location and time context
- **Output**: `{ isSameEvent: boolean, reasoning: string }`
- **Conservative fallback**: if the LLM call fails or returns invalid data, the match is rejected (new event created). This avoids incorrectly merging unrelated incidents.
- **Cost**: only ~5–15% of messages fall in the uncertain zone, so LLM verify calls are infrequent

## Source Trust

Higher-trust sources (e.g., utility companies with official GeoJSON) produce higher-quality geometry. When a more trusted source reports the same incident, its geometry replaces the existing one.

## Migration

An idempotent migration script in `db/migrate/` creates initial 1:1 events from existing finalized messages. Running it again skips already-linked messages.

## Web Observability Page

The `/events` page provides a read-only view of all events for observability before events replace messages on the map.

- **Single-message events** (1:1) render as flat cards
- **Multi-message events** render as collapsed accordions — expanding shows linked messages with their confidence scores and source names
- Pagination loads older events on demand
- Accessible via the footer link "Групирани съобщения"

API endpoints:

- `GET /api/events` — paginated event list (cursor-based, sorted by `updatedAt` desc, filtered by locality)
- `GET /api/events/messages?eventId=X` — messages linked to a specific event with `EventMessage` match metadata

## Related

- [database-layer.md](database-layer.md) — DB access patterns for `events` and `eventMessages` collections, and the linking model (`eventMessages` as authoritative source of truth vs `messages.eventId` as denormalized cache)
