# Cloud Workflows Orchestration

This document describes how Google Cloud Workflows orchestrate the ingestion pipeline, providing granular task execution and improved observability.

## Overview

The ingestion pipeline uses **Google Cloud Workflows** to orchestrate crawler execution, data processing (ingest), and notifications. This replaces the previous monolithic approach where a single Cloud Run job performed all tasks sequentially.

### Key Benefits

- **Granular logging**: Each crawler, ingest, and notify task runs as a separate Cloud Run job execution with isolated logs
- **Better alerting**: Failures can be traced to specific tasks (e.g., "crawler toplo failed" vs "pipeline failed")
- **Parallel execution**: All crawlers run simultaneously, reducing total pipeline time
- **Visibility**: Workflow execution graph shows task dependencies and status in Cloud Console
- **Resilience**: Pipeline continues to ingest/notify even if some crawlers fail

## Architecture

```
Cloud Scheduler
    ↓
Google Cloud Workflows
    ↓
    ├─→ [Parallel] Crawler Jobs (crawl-erm-zapad, crawl-toplo, etc.)
    ↓   └─→ Firestore (sources collection)
    ├─→ [Sequential] Ingest Job (ingest-messages)
    ↓   └─→ Firestore (messages collection)
    └─→ [Sequential] Notify Job (send-notifications)
        └─→ Firebase Cloud Messaging (push notifications)
```

### Two Workflow Types

1. **Emergent Workflow** (`pipeline-emergent`)
   - **Crawlers**: 3 emergent sources (erm-zapad, toplo-bg, sofiyska-voda)
   - **Schedule**: Every 30 minutes (7:00 AM - 10:30 PM, Europe/Sofia timezone)
   - **Use case**: Short-lived disruptions requiring frequent updates (power outages, heating issues, water disruptions)

2. **All Workflow** (`pipeline-all`)
  - **Crawlers**: All currently deployed crawlers
   - **Schedule**: 3 times daily at 10:00 AM, 2:00 PM, 4:00 PM (Europe/Sofia timezone)
   - **Use case**: Long-term construction/repair projects from district municipalities

## Workflow Execution Flow

### Step 1: Parallel Crawler Execution

All crawlers run simultaneously, each invoking its respective Cloud Run job:

- `crawl-erm-zapad` → ERM-Zapad power outages API
- `crawl-toplo` → Toplo BG heating infrastructure (Playwright scraper)
- `crawl-sofiyska-voda` → Sofiyska Voda water disruptions API
- `crawl-rayon-oborishte` → Rayon Oborishte WordPress site
- `crawl-sofia` → Sofia municipality WordPress site
- `crawl-mladost` → Mladost district WordPress site
- `crawl-studentski` → Studentski district WordPress site
- `crawl-sredec` → Sredec district WordPress site
- `crawl-slatina` → Slatina district WordPress site
- `crawl-lozenets` → Lozenets district WordPress site
- `crawl-raioniskar` → Raion Iskar municipality site
- `crawl-rayon-pancharevo` → Rayon Pancharevo WordPress site
- `crawl-rayon-ilinden` → Rayon Ilinden WordPress site
- `crawl-triaditsa` → Rayon Triaditsa WordPress site
- `crawl-krasna-polyana` → Rayon Krasna Polyana website
- `crawl-nimh-severe-weather` → NIMH severe weather warnings site

**Failure behavior**: Crawlers are wrapped in `try`/`except` blocks. If one fails, it logs an ERROR but doesn't stop other crawlers or the workflow.

### Step 2: Sequential Ingest

After all crawlers complete (success or failure), the `ingest-messages` job runs:

- Processes all unprocessed source documents in Firestore
- Performs AI categorization (for sources without precomputed GeoJSON)
- Geocodes addresses/streets using Google Maps, Overpass, and Cadastre APIs
- Creates messages with GeoJSON geometries
- Marks messages as `finalized`

**Failure behavior**: If ingest fails, workflow logs an ERROR and continues to notify step.

### Step 3: Sequential Notify

After ingest completes, the `send-notifications` job runs:

- Matches finalized messages to user notification preferences
- Sends push notifications via Firebase Cloud Messaging
- Updates last notification timestamp for users

**Failure behavior**: If notify fails, workflow logs an ERROR and completes.

## Monitoring Workflow Executions

### Cloud Console

1. Navigate to **Workflows** in Google Cloud Console
2. Select workflow: `pipeline-emergent` or `pipeline-all`
3. Click **Executions** tab to see recent runs
4. Click on any execution to see:
   - Execution graph (visual representation of steps)
   - Step-by-step logging with timestamps
   - Input/output of each step
   - Error messages for failed steps

### Individual Task Logs

Each Cloud Run job execution has separate logs:

1. Navigate to **Cloud Run** → **Jobs**
2. Select a job (e.g., `crawl-toplo`)
3. Click **Logs** tab
4. Filter by execution time to find logs from specific workflow run

### Checking Scheduler Status

Cloud Scheduler triggers workflows on schedule:

```bash
# List all scheduled jobs
gcloud scheduler jobs list --location=europe-west1

# View specific schedule
gcloud scheduler jobs describe pipeline-emergent-schedule \
  --location=europe-west1
```

## Manual Workflow Execution

### Trigger Workflow Manually

Useful for testing or emergency re-runs:

```bash
# Execute emergent workflow
gcloud workflows execute pipeline-emergent --location=europe-west1

# Execute all workflow
gcloud workflows execute pipeline-all --location=europe-west1
```

The command returns an execution ID immediately. Use it to check status:

```bash
# Check execution status
gcloud workflows executions describe EXECUTION_ID \
  --workflow=pipeline-emergent \
  --location=europe-west1
```

### List Recent Executions

```bash
# View last 10 executions
gcloud workflows executions list \
  --workflow=pipeline-emergent \
  --location=europe-west1 \
  --limit=10
```

## Failure Scenarios

### Scenario 1: Single Crawler Fails

**Example**: `crawl-toplo` fails due to website timeout

**Behavior**:

- Workflow logs ERROR for toplo crawler
- Other crawlers continue running
- Ingest processes all successful crawler results
- Notify runs normally
- **Result**: Partial success - most sources updated, toplo data stale

**Investigation**:

1. Check workflow execution graph - toplo step will show error
2. View `crawl-toplo` Cloud Run job logs for detailed error
3. Check if Toplo BG website is accessible

### Scenario 2: All Crawlers Fail

**Example**: Firestore outage prevents all crawlers from writing

**Behavior**:

- All crawler steps log ERRORs
- Ingest runs but finds no new source documents to process
- Notify runs but has no new messages to send
- **Result**: No new data, but system remains operational

**Investigation**:

1. Check Firestore status in Cloud Console
2. Review multiple crawler logs to identify common failure pattern
3. Check service account permissions

### Scenario 3: Ingest Fails

**Example**: Google AI API quota exceeded during categorization

**Behavior**:

- Crawlers complete successfully, new source documents in Firestore
- Ingest step logs ERROR
- Notify runs but has no new finalized messages
- **Result**: Data collected but not processed

**Investigation**:

1. Check `ingest-messages` job logs for quota errors
2. Review Google AI API quota in GCP Console
3. Re-run workflow manually after quota resets

### Scenario 4: Notify Fails

**Example**: Firebase Cloud Messaging certificate expired

**Behavior**:

- Crawlers and ingest complete successfully
- Notify step logs ERROR
- **Result**: New messages available in app but users not notified

**Investigation**:

1. Check `send-notifications` job logs for FCM errors
2. Verify Firebase project configuration
3. Re-run workflow to retry notifications

## Emergency Fallback: Legacy Pipeline Jobs

If Workflows are completely unavailable (rare GCP service outage), use the legacy monolithic pipeline jobs:

```bash
# Run emergent pipeline (all-in-one job)
gcloud run jobs execute pipeline-emergent --region=europe-west1 --wait

# Run full pipeline (all-in-one job)
gcloud run jobs execute pipeline-all --region=europe-west1 --wait
```

**Note**: These jobs are marked DEPRECATED and are NOT scheduled. They perform the same work as workflows but in a single container execution with combined logging.

## Alerting

Cloud Monitoring alert policies trigger when:

- Workflow execution fails (any step logs severity >= ERROR)
- Cloud Run job execution fails
- Notifications sent to configured email address

Alert notifications include:

- Workflow/job name
- Execution ID
- Link to Cloud Console for investigation

## Workflow Source Files

Workflow definitions are version-controlled in the repository:

- **Emergent**: `ingest/terraform/workflows/emergent.yaml`
- **All**: `ingest/terraform/workflows/all.yaml`

Changes to these files require Terraform deployment:

```bash
cd ingest/terraform
terraform plan
terraform apply
```

## Adding New Crawlers

When adding a new crawler to the system:

1. Implement crawler in `ingest/crawlers/{source-name}/`
2. Add Cloud Run job definition to `ingest/terraform/main.tf`
3. Update `ingest/terraform/workflows/all.yaml` - add crawler to parallel step
4. If emergent crawler: Also update `ingest/terraform/workflows/emergent.yaml` and the `EMERGENT_CRAWLERS` constant in `ingest/pipeline.ts`
5. Deploy via Terraform: `terraform apply`

See [AGENTS.md](../../AGENTS.md) for detailed crawler development guidelines.

## Related Documentation

- [Geocoding](../../ingest/geocoding/README.md) - How addresses/streets are geocoded during ingest
- [Message Filtering](./message-filtering.md) - AI categorization and data extraction
- [Terraform Setup](../../ingest/terraform/README.md) - Infrastructure deployment guide
