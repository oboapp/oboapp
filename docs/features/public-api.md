# Public API

> ⚠️ **API v1 is deprecated.** The v1 endpoints will be removed on **October 14, 2026**. New integrations should use [v2](#api-v2-current). Existing callers should [migrate](#migrating-from-v1-to-v2).

---

## API v2 (Current)

**Base URL:** `https://api.oboapp.online/v2`

**Interactive documentation:** [`https://api.oboapp.online/v2/docs`](https://api.oboapp.online/v2/docs)

### Overview

v2 is identical to v1 except that five pipeline-internal fields have been removed from the `Message` object. All of the contained location data is already available through the `geoJson` field, making the removed fields redundant and leaking internal pipeline structure.

**Removed fields:** `addresses`, `pins`, `streets`, `cadastralProperties`, `busStops`

### Endpoints

| Method | Path                 | Description                                                          |
| ------ | -------------------- | -------------------------------------------------------------------- |
| `GET`  | `/v2/sources`        | List all data sources                                                |
| `GET`  | `/v2/messages`       | Fetch messages filtered by geographic bounds and optional categories |
| `GET`  | `/v2/messages/by-id` | Fetch a single message by ID                                         |
| `GET`  | `/v2/openapi`        | OpenAPI 3.0 specification (no key required)                          |

### Message Object (v2)

| Field               | Type                 | Description                              |
| ------------------- | -------------------- | ---------------------------------------- |
| `id`                | `string?`            | 8-character message ID                   |
| `text`              | `string`             | Original raw text                        |
| `plainText`         | `string?`            | Plain-text version (no markdown)         |
| `markdownText`      | `string?`            | Markdown-formatted version               |
| `source`            | `string?`            | Source identifier                        |
| `sourceUrl`         | `string?`            | URL to the original source document      |
| `locality`          | `string`             | Locality identifier (e.g. `bg.sofia`)    |
| `categories`        | `Category[]?`        | Assigned categories                      |
| `geoJson`           | `FeatureCollection?` | Full GeoJSON geometry for the event      |
| `crawledAt`         | `string?`            | ISO 8601 — when the source was crawled   |
| `createdAt`         | `string`             | ISO 8601 — when the record was created   |
| `finalizedAt`       | `string?`            | ISO 8601 — when processing was completed |
| `timespanStart`     | `string?`            | ISO 8601 — start of the disruption       |
| `timespanEnd`       | `string?`            | ISO 8601 — end of the disruption         |
| `cityWide`          | `boolean?`           | Whether the event affects the whole city |
| `responsibleEntity` | `string?`            | Entity responsible for the disruption    |

### Migrating from v1 to v2

Replace the base URL and remove any reads of the five dropped fields:

```diff
- GET https://api.oboapp.online/v1/messages
+ GET https://api.oboapp.online/v2/messages
```

Fields removed in v2 — stop reading these from the response:

| Removed field         | Alternative                                                |
| --------------------- | ---------------------------------------------------------- |
| `addresses`           | Use `geoJson` features with `Point` geometry               |
| `pins`                | Use `geoJson` features; pin timespans are in feature props |
| `streets`             | Use `geoJson` features with `LineString` geometry          |
| `cadastralProperties` | Use `geoJson` features with `Polygon` geometry             |
| `busStops`            | Use `geoJson` features tagged with bus-stop properties     |

---

## API v1 (Deprecated)

> ⚠️ v1 is deprecated. Sunset: **October 14, 2026**. Use [v2](#api-v2-current) for new integrations.

**Base URL:** `https://api.oboapp.online/v1`

**Interactive documentation:** [`https://api.oboapp.online/v1/docs`](https://api.oboapp.online/v1/docs)

All data endpoints require a registered API key. The OpenAPI specification is available without authentication.

v1 responses include the `Deprecation: true`, `Sunset`, and `Link` HTTP response headers on all data endpoints.

### Endpoints

| Method | Path                 | Description                                                          |
| ------ | -------------------- | -------------------------------------------------------------------- |
| `GET`  | `/v1/sources`        | List all data sources                                                |
| `GET`  | `/v1/messages`       | Fetch messages filtered by geographic bounds and optional categories |
| `GET`  | `/v1/messages/by-id` | Fetch a single message by ID                                         |
| `GET`  | `/v1/openapi`        | OpenAPI 3.0 specification (no key required)                          |

---

## Authentication

All data endpoints require a valid API key sent in the `X-Api-Key` request header:

```http
GET https://api.oboapp.online/v1/messages?north=42.8&south=42.6&east=23.4&west=23.2
X-Api-Key: obo_abc123...
```

Missing or invalid keys receive a `401 Unauthorized` response.

## Getting an API Key

Registered OboApp users can generate and revoke their own API key from the **Settings** page (under "Публичен API достъп"). Each user can hold at most one active key.

Guest mode does not include API key management; users must sign in with Google first.

When generating a key, users must provide a URL to a public website, repository, or project page that describes where the data will be used.

Keys have the format `obo_<random>` and can be viewed from the Settings page — treat them as secrets and store them securely.

## Revoking an API Key

From the Settings page, click **Отмени API ключа**. Revocation requires typing **ОТМЕНИ** in the confirmation dialog. This is permanent.
