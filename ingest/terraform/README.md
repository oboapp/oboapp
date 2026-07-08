# Terraform Infrastructure as Code

This directory contains Terraform configuration for deploying the ingestion pipeline to Google Cloud.

## Prerequisites

1. **Install Terraform**: https://www.terraform.io/downloads

   ```bash
   brew install terraform  # macOS
   ```

2. **Authenticate with Google Cloud**:

   ```bash
   gcloud auth application-default login
   ```

3. **Set your project**:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

## Quick Start

### 1. Configure Variables

Create `terraform.tfvars` from the example:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
project_id = "your-actual-project-id"
region     = "europe-west1"
```

### 2. Initialize Terraform

```bash
terraform init \
  -backend-config="bucket=<your-project>-terraform-state" \
  -backend-config="prefix=oborishte-ingest"
```

Replace `<your-project>-terraform-state` with your GCS bucket name. The bucket must already exist (create it once via `gcloud storage buckets create gs://<your-project>-terraform-state`).

Keep the backend prefix identical everywhere you run Terraform. Using a different prefix creates a separate state file and can duplicate notification channels and alert policies in Google Cloud Monitoring.

### 3. Preview Changes

```bash
terraform plan
```

### 4. Apply Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. This will create:

- Service account with appropriate permissions
- Cloud Run Jobs:
  - Individual crawler jobs (for manual triggering)
  - Individual ingest and notify jobs (for manual triggering)
  - Pipeline jobs: `pipeline-emergent` and `pipeline-all`
- Cloud Scheduler jobs:
  - `pipeline-emergent-schedule` - Every 30 minutes (for emergency crawlers)
  - `pipeline-all-schedule` - 3 times daily (for all crawlers)
- Enable required Google Cloud APIs

### 5. Build and Deploy Container Image

After Terraform creates the infrastructure, get the Artifact Registry URL:

```bash
cd ..  # back to ingest directory

# Get the image URL from terraform
terraform output container_image_url

# Configure Docker for Artifact Registry (replace REGION with your region)
gcloud auth configure-docker [REGION]-docker.pkg.dev

# Build and push image using the URL from terraform output
gcloud builds submit --tag [CONTAINER_IMAGE_URL]

# Or build locally and push
docker build -t [CONTAINER_IMAGE_URL] .
docker push [CONTAINER_IMAGE_URL]
```

**Example:**

```bash
# If terraform output shows: europe-west1-docker.pkg.dev/my-project/oborishte-ingest/oborishte-ingest:latest
gcloud auth configure-docker europe-west1-docker.pkg.dev
gcloud builds submit --tag europe-west1-docker.pkg.dev/my-project/oborishte-ingest/oborishte-ingest:latest
```

**Automatic Cleanup:** The repository keeps the `latest` tag indefinitely and removes untagged images after 1 day.

### 6. Verify Deployment

```bash
# Test a job
gcloud run jobs execute pipeline-emergent --region=europe-west1 --wait

# Or test individual crawler
gcloud run jobs execute crawl-rayon-oborishte --region=europe-west1 --wait

# View all jobs
gcloud run jobs list --region=europe-west1

# View schedules
gcloud scheduler jobs list --location=europe-west1
```

## Updating Infrastructure

When you make changes to Terraform files:

```bash
terraform plan   # preview changes
terraform apply  # apply changes
```

## Updating Application Code

When you update the application code:

1. **Build and push new image**:

   ```bash
   # Build and push with Cloud Build (recommended)
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/oborishte-ingest:v1.0.1

   # Or build locally
   docker build -t gcr.io/YOUR_PROJECT_ID/oborishte-ingest:v1.0.1 .
   docker push gcr.io/YOUR_PROJECT_ID/oborishte-ingest:v1.0.1
   ```

2. **Update Terraform variable** (if using a specific tag):

   ```hcl
   # In terraform.tfvars
   image_tag = "v1.0.1"
   ```

3. **Apply changes**:
   ```bash
   terraform apply
   ```

Alternatively, update jobs directly without Terraform:

```bash
gcloud run jobs update crawl-rayon-oborishte \
  --image=gcr.io/YOUR_PROJECT_ID/oborishte-ingest:v1.0.1 \
  --region=europe-west1
```

## Configuration Options

### Variables

All variables are defined in `variables.tf`. Override them in `terraform.tfvars`:

| Variable                    | Description                            | Default               |
| --------------------------- | -------------------------------------- | --------------------- |
| `project_id`                | GCP Project ID                         | _required_            |
| `firebase_project_id`       | Firebase Project ID                    | _required_            |
| `alert_email`               | Email for pipeline failure alerts      | _required_            |
| `app_url`                   | Public URL of the web app              | _required_            |
| `ci_service_account_email`  | CI/CD service account email            | _required_            |
| `region`                    | GCP region                             | `europe-west1`        |
| `locality`                  | Locality identifier (e.g. `bg.sofia`)  | `bg.sofia`            |
| `image_name`                | Docker image name                      | `oborishte-ingest`    |
| `image_tag`                 | Docker image tag                       | `latest`              |
| `artifact_registry_repo_id` | Artifact Registry repository ID        | `oborishte-ingest`    |
| `schedule_timezone`         | Timezone for schedules                 | `Europe/Sofia`        |
| `localities`                | Locality IDs to deploy crawlers for    | `["bg.sofia"]`        |
| `crawlers`                  | Manual override for the crawler map    | `{}` (auto-assembled) |
| `gcs_generic_bucket`        | GCS bucket for file storage (optional) | `""`                  |
| `sentry_dsn_secret_id`      | Secret Manager ID for Sentry DSN       | `""`                  |

### Modifying Schedules

Edit schedules in `variables.tf`:

```hcl
variable "schedules" {
  type = object({
    pipeline_emergent = string  # Emergent crawlers + ingest + notify
    pipeline_all      = string  # All crawlers + ingest + notify
  })
  default = {
    pipeline_emergent = "*/30 7-22 * * *"    # Every 30 minutes, 7:00 AM–10:30 PM
    pipeline_all      = "0 10,14,16 * * *"   # 3x daily at 10:00, 14:00, 16:00
  }
}
```

Cron format: `minute hour day month weekday`

Examples:

- `0 6 * * *` - Daily at 6:00 AM
- `0 6 * * 1` - Weekly on Mondays at 6:00 AM
- `0 */6 * * *` - Every 6 hours
- `*/30 * * * *` - Every 30 minutes
- `30 8 * * 1-5` - Weekdays at 8:30 AM

**Note:** Individual crawler, ingest, and notify jobs remain available for manual triggering but are not scheduled. Only the two pipeline jobs run on schedule.

### Cloud Workflows Orchestration

The pipeline uses Google Cloud Workflows for orchestration:

- **Workflow definitions**: `workflows/all.yaml.tftpl` and `workflows/emergent.yaml.tftpl` (Terraform templates)
- **Triggered by**: Cloud Scheduler (same schedules as before)
- **Execution**: Crawlers run in parallel via `parallel: for:` loop, followed by sequential ingest and notify

**Workflow changes**: Workflow YAML is generated from Terraform templates using `templatefile()`. Crawler lists are derived automatically from `local.crawlers` (assembled from per-locality files in `ingest/terraform/`):

```bash
terraform plan   # Workflows will be updated
terraform apply
```

**Adding new crawlers**: Add an entry to the relevant locality file (e.g. `crawlers.bg.sofia.tf`):

1. Add an entry to `crawlers.bg.<locality>.tf` — the workflow templates pick it up automatically via `local.crawlers`.
2. For emergent crawlers (30-min intervals): set `emergent = true` in the Terraform crawler entry — this controls Cloud Scheduler/Workflows scheduling. Also set `emergent: true` on the matching source definition in `shared/src/sources/{source-id}.ts` — this keeps `EMERGENT_CRAWLERS` (used by `pipeline --emergent`) in sync. The Terraform `source` value must match the source definition `id` (e.g., `toplo-bg`).
3. The full list of available crawlers is discovered automatically via `local.crawlers` in Terraform.

**Manual workflow testing**:

```bash
# Execute workflow directly
gcloud workflows execute pipeline-emergent --location=europe-west1

# View execution details
gcloud workflows executions describe [EXECUTION_ID] \
  --workflow=pipeline-emergent \
  --location=europe-west1

# List recent workflow executions
gcloud workflows executions list \
  --workflow=pipeline-emergent \
  --location=europe-west1 \
  --limit=10
```

**Legacy pipeline jobs**: The monolithic `pipeline-emergent` and `pipeline-all` Cloud Run jobs remain available for local testing and emergency manual execution, but are no longer scheduled by Cloud Scheduler.

```bash
# Manual execution of legacy pipeline job
gcloud run jobs execute pipeline-emergent --region=europe-west1 --wait
```

**Local development:**

```bash
cd ingest
pnpm pipeline:emergent
pnpm pipeline:all
```

### Modifying Resources

Change memory/CPU in `main.tf`:

```hcl
resources {
  limits = {
    cpu    = "2"      # Change CPU
    memory = "2Gi"    # Change memory
  }
}
```

## State Management

Remote state is configured by default via a GCS backend in `main.tf`. The bucket and prefix cannot use Terraform variables — override them at init time:

```bash
terraform init \
  -backend-config="bucket=your-terraform-state-bucket" \
  -backend-config="prefix=your-prefix"
```

Create the bucket first if it doesn't exist:

```bash
gsutil mb -l europe-west1 gs://your-terraform-state-bucket
gsutil versioning set on gs://your-terraform-state-bucket
```

Then re-initialize:

```bash
terraform init -migrate-state
```

## Common Commands

```bash
# Initialize/upgrade providers
terraform init -upgrade

# Format code
terraform fmt

# Validate configuration
terraform validate

# Show current state
terraform show

# List resources
terraform state list

# Get specific output
terraform output service_account_email

# Destroy all resources (careful!)
terraform destroy
```

## Troubleshooting

### Permission Denied Errors

Ensure you have necessary permissions:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="user:your-email@example.com" \
  --role="roles/editor"
```

### API Not Enabled

If you get "API not enabled" errors, Terraform should enable them automatically. If not:

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
```

### State Conflicts

If working with a team and state is locked:

```bash
terraform force-unlock LOCK_ID
```

### Jobs Not Running

Check scheduler status:

```bash
gcloud scheduler jobs describe crawl-rayon-oborishte-schedule \
  --location=europe-west1
```

Manually trigger:

```bash
gcloud scheduler jobs run crawl-rayon-oborishte-schedule \
  --location=europe-west1
```

## Cost Optimization

The infrastructure defined here should cost **~$0.20/month**:

- Cloud Run Jobs: FREE (within free tier)
- Cloud Scheduler: $0.10/month × 2 pipeline schedules = $0.20/month

To reduce costs further:

1. Reduce pipeline frequency (e.g., emergent every hour instead of 30 minutes)
2. Reduce full pipeline to 2x daily instead of 3x
3. Use smaller memory allocations

## Security Best Practices

1. **Never commit** `terraform.tfvars` or `*.tfstate` files
2. Use **remote state** with locking for team collaboration
3. Store **secrets** in Google Secret Manager, not in Terraform:

   ```hcl
   env {
     name = "API_KEY"
     value_source {
       secret_key_ref {
         secret  = "api-key-secret"
         version = "latest"
       }
     }
   }
   ```

4. Use **service account** with minimal permissions
5. Enable **VPC Service Controls** for production

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: Deploy Infrastructure
on:
  push:
    branches: [main]
    paths: ["ingest/terraform/**"]

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: hashicorp/setup-terraform@v2
      - name: Terraform Init
        run: terraform init
        working-directory: ingest/terraform
      - name: Terraform Apply
        run: terraform apply -auto-approve
        working-directory: ingest/terraform
        env:
          GOOGLE_CREDENTIALS: ${{ secrets.GCP_CREDENTIALS }}
```
