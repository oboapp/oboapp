# Message URLs

## Overview

Messages use short, URL-friendly document IDs as their Firestore document key. Each message ID is an 8-character alphanumeric string (e.g., `aB3xYz12`), enabling clean shareable URLs like `oboapp.online/m/aB3xYz12`.

## URL Format

### Internal Navigation (Query Params)

**Format**: `/?messageId={id}`

**Example**: `https://oboapp.online/?messageId=aB3xYz12`

Internal links (map clicks, message cards, notification history) use query parameters so the message detail opens as an overlay on the homepage map. This avoids unmounting the map and preserves context.

### Shareable/External Links

**Format**: `/m/{id}`

**Example**: `https://oboapp.online/m/aB3xYz12`

External links (push notifications, social sharing) use the clean `/m/{id}` path format. The `/m/[slug]` route renders a standalone message page on the server with message-specific title, description, canonical URL, and Schema.org JSON-LD. Its "Виж на картата" link opens the homepage overlay.

- **Short**: 8 characters, easy to share
- **Persistent**: Document ID never changes
- **Unique**: Base62 encoding provides 218 trillion possible combinations

## ID Generation

### Character Set

IDs use base62 encoding (0-9, A-Z, a-z) for URL-safety and readability:

- No special characters requiring URL encoding
- Case-sensitive for maximum entropy
- Human-readable and typeable

### Collision Handling

The system uses atomic document creation with retry on collision:

1. Generate random 8-character ID
2. Attempt atomic `doc(id).create()` in Firestore
3. If collision detected (ALREADY_EXISTS error), retry with new ID (max 5 attempts)
4. Use unique ID as the Firestore document key

With 62^8 possible combinations (218 trillion), collision probability is negligible even for millions of messages. The atomic operation ensures no race conditions under concurrent writes.

### Deduplication

Message deduplication is handled separately via the `sourceDocumentId` field (a deterministic hash of the source URL), not the document ID. This means random IDs do not affect dedup logic.

## Frontend Integration

### Link Generation

Use `createMessageUrl()` from `web/lib/url-utils.ts`:

```typescript
import { createMessageUrl } from "@/lib/url-utils";

const url = createMessageUrl(message);
// Returns: "/?messageId=aB3xYz12"
```

For notification cards with partial data:

```typescript
import { createMessageUrlFromId } from "@/lib/url-utils";

const url = createMessageUrlFromId(messageId);
// Returns: "/?messageId=aB3xYz12"
```

### Route Handling

Internal message details render as an overlay on the homepage map; shareable URLs render a standalone page:

1. **Homepage `/?messageId={id}`** — Primary route
   - `HomeContent` looks up the message in viewport messages by ID
   - If not found in viewport (e.g., message outside current map bounds), fetches via `/api/messages/by-id`
   - Renders `MessageDetailView` as a slide-in panel over the map
   - Uses `router.push()` to add history entry when opening (enables browser back to close)
   - Uses `router.back()` when explicitly closing, with a `router.replace()` fallback if there is no prior history entry (avoids duplicate history entries)

2. **`/m/[slug]/page.tsx`** — Shareable message page
   - Fetches and renders the message in the initial HTML response
   - Provides a canonical URL, social metadata, and Schema.org `CreativeWork` JSON-LD with source and AI processing metadata where available
   - Links to `/?messageId={id}` for the map overlay
   - Note: The file is named `[slug]` for Next.js dynamic routing, but the parameter represents the message ID

### Browser History Behavior

The message detail overlay manages history to provide natural navigation:

- **Opening a detail**: Uses `router.push()` to add a history entry with `?messageId={id}`
- **Browser back button**: Navigates back in history, which closes the detail
- **Explicit close** (X button, ESC, backdrop): Uses `router.back()` to navigate to previous history entry (avoids polluting history with duplicate entries)

This provides intuitive PWA navigation:
- Users can press back to close details
- Explicitly closing details goes back in history (same as pressing back button)
- No duplicate entries are created when opening and closing multiple details
- Fallback to `router.replace()` if no history is available (e.g., direct link to detail)

## API Endpoints

### Fetch by ID

**GET** `/api/messages/by-id?id={id}`

Fetches a message by its document ID.

**Response**:

```json
{
  "message": {
    "id": "aB3xYz12",
    "text": "...",
    "geoJson": {...},
    ...
  }
}
```

**Error Codes**:

- `400` - Invalid ID format (must be 8 alphanumeric characters)
- `404` - Message not found
- `500` - Server error

## Push Notifications

Notification payloads include slug-based URLs:

```json
{
  "data": {
    "url": "https://oboapp.online/m/aB3xYz12",
    ...
  },
  "webpush": {
    "fcmOptions": {
      "link": "https://oboapp.online/m/aB3xYz12"
    }
  }
}
```

Users clicking notifications navigate directly to the standalone message page via clean URLs and can open the map overlay from there.
