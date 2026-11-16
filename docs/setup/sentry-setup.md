# Sentry Error Monitoring

Sentry is an optional error monitoring integration. When configured, it captures unhandled exceptions and error-level logs from the web app, the public API, and the ingest pipeline. The ingest pipeline also reports explicit source warnings. Errors appear in your host platform's logs and Google Cloud Logging.

## What Gets Captured

**Web (browser + API routes)**

- Unhandled JavaScript exceptions and promise rejections
- React render errors (via global error boundary)
- All `console.error()` calls in the browser and in API route handlers

**API (Hono)**

- Unhandled exceptions via the global `app.onError` handler
- All `console.error()` calls via `captureConsoleIntegration`

**Ingest (Cloud Run)**

- Unhandled exceptions and promise rejections
- All `logger.error()` calls from the pipeline
- Recoverable source warnings reported through `reportSourceWarning`, including Oborishte's RSS-to-API fallback

Pass the exception in the `error` metadata field so Sentry receives its stack and
nested cause. The structured logger also serializes these details for Cloud
Logging, including network error codes such as `ECONNRESET` and
`UND_ERR_CONNECT_TIMEOUT`. URL credentials, query strings, and fragments in error
diagnostics are removed before reporting.

When running as a Cloud Run job, log entries and Sentry error metadata include
`cloudRunJob`, `cloudRunExecution`, `cloudRunTaskIndex`, and
`cloudRunTaskAttempt`. Use the execution and task index to find all attempts of
the same task. A later `Crawl complete` or source completion entry shows that a
scheduler retry recovered; a failed attempt still reports its exception.

Source packages supply feed URLs and in-process retry details. Lozenets 0.2.0
emits retry and recovery events through its optional factory callback. Its
adapter records a warning for `rss-feed-retry` and information for
`rss-feed-recovered`, including flat `feedUrl`, `feedAttempt` or `feedAttempts`
fields and the current Cloud Run context. The same sanitized data becomes a
Sentry breadcrumb, which accompanies later captured exceptions. Successful
recovery is visible in Cloud Logging.

Feed attempts count requests within one scan. `cloudRunTaskAttempt` counts
scheduler attempts. A final Lozenets failure reports its feed identity, attempt
count and sanitized nested network cause through the existing error path. The
[package integration notes](../features/source-packages.md#lozenets) describe the
retry budget and production verification that remains for
[oboapp/oboapp#688](https://github.com/oboapp/oboapp/issues/688).

## Configuration

Use **three separate Sentry projects**, one per service. This keeps browser errors, API errors, and pipeline errors in separate buckets with independent alert rules and release tracking.

| Service | Runtime | Env var |
|---------|---------|---------|
| `web` (Next.js) | Node.js host | `NEXT_PUBLIC_SENTRY_DSN` |
| `api` (Hono) | Node.js host | `SENTRY_DSN` |
| `ingest` (pipeline) | Cloud Run | `SENTRY_DSN` |

### Web

**Local** (`web/.env.local`):
```
NEXT_PUBLIC_SENTRY_DSN=https://...@o0.ingest.sentry.io/0
```

**Production**: set `NEXT_PUBLIC_SENTRY_DSN` in your hosting platform's environment/secrets configuration.

The DSN is a public project identifier and is visible to the browser by design.

### API

**Local** (`api/.env.local`):
```
SENTRY_DSN=https://...@o0.ingest.sentry.io/0
```

**Production**: set `SENTRY_DSN` in your hosting platform's environment/secrets configuration.

### Ingest (`ingest/.env.local` for local runs)

```
SENTRY_DSN=https://...@o0.ingest.sentry.io/0
```

For production, use Google Secret Manager. See the [Google Cloud / Ingest Pipeline](#google-cloud--ingest-pipeline) section below.

## Google Cloud / Ingest Pipeline

The ingest pipeline runs on Cloud Run and reads `SENTRY_DSN` from Secret Manager.

**Create the secret once:**

Bash:
```bash
gcloud secrets create sentry-dsn --replication-policy=automatic
echo -n "https://...@o0.ingest.sentry.io/0" | gcloud secrets versions add sentry-dsn --data-file=-
```

PowerShell:
```powershell
gcloud secrets create sentry-dsn --replication-policy=automatic
Set-Content -Path dsn.txt -Value "https://...@o0.ingest.sentry.io/0" -NoNewline
gcloud secrets versions add sentry-dsn --data-file=dsn.txt
Remove-Item dsn.txt
```

**Enable it in Terraform** (`ingest/terraform/terraform.tfvars`):

```hcl
sentry_dsn_secret_id = "sentry-dsn"
```

Then run `terraform apply`. All Cloud Run jobs will receive `SENTRY_DSN` via `secret_key_ref`, the same mechanism used for other API keys. Omitting `sentry_dsn_secret_id` (or leaving it empty) disables Sentry for all jobs with no other changes required.

## Source Map Uploads (CI)

Source maps allow Sentry to show original TypeScript source in stack traces. These apply to the **web project** only. The ingest pipeline runs compiled JS inside Docker and does not upload source maps.

Add these secrets to the GitHub repository (Settings → Secrets and variables → Actions):

| Secret                   | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN for the web Sentry project (same value as the env var)         |
| `SENTRY_AUTH_TOKEN`      | Internal integration token from the web Sentry project settings    |
| `SENTRY_ORG`             | Your Sentry organization slug                                      |
| `SENTRY_PROJECT`         | Slug of the **web** Sentry project                                 |

Source maps are only uploaded during the `build-web` CI job. Local builds are unaffected.

## Sentry Dashboard

https://sentry.io/oboapp
