# Public API

## Overview

OboApp exposes a read-only public REST API for external consumption of Sofia city-infrastructure disruption data.

The public API is served by the dedicated API module and (sub)domain.
The web app does not serve public API endpoints directly.

For backwards compatibility with existing clients that still call the web domain, web permanently redirects `/api/v1/*` requests to the configured public API host.

**Base URL:** `https://api.oboapp.online/v1`

**Interactive documentation:** [`https://api.oboapp.online/v1/docs`](https://api.oboapp.online/v1/docs)

All data endpoints require a registered API key. The OpenAPI specification is available without authentication.

## Legacy Client Redirect

If clients still call `<web>/api/v1/...`, web redirects those requests to the public API host.

## Endpoints

| Method | Path                 | Description                                                          |
| ------ | -------------------- | -------------------------------------------------------------------- |
| `GET`  | `/v1/sources`        | List all data sources                                                |
| `GET`  | `/v1/messages`       | Fetch messages filtered by geographic bounds and optional categories |
| `GET`  | `/v1/messages/by-id` | Fetch a single message by ID                                         |
| `GET`  | `/v1/openapi`        | OpenAPI 3.0 specification (no key required)                          |

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
