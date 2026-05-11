variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "Google Cloud region for resources"
  type        = string
  default     = "europe-west1"
}

variable "localities" {
  description = "List of locality IDs whose crawlers should be deployed (e.g. [\"bg.sofia\"]). Each ID must have a corresponding crawlers.\u003clocality-id\u003e.tf file (e.g. \"bg.sofia\" \u2192 crawlers.bg.sofia.tf) wired into crawlers.tf. Crawlers for all listed localities are merged into a single Cloud Run job set. Note: all crawler jobs currently share the same var.locality execution context; per-job locality scoping is planned."
  type        = list(string)
  default     = ["bg.sofia"]
}

variable "crawlers" {
  description = "Full manual override for the crawler map. When non-empty, bypasses the per-locality assembly entirely. Useful for one-off deployments or testing a single crawler without editing locality files."
  type = map(object({
    source      = string
    memory      = optional(string, "1Gi")
    timeout     = optional(string, "1800s")
    description = optional(string, "")
    emergent    = optional(bool, false)
  }))
  default = {}
}

variable "image_registry" {
  description = "Container image registry"
  type        = string
  default     = "gcr.io"
}

variable "image_name" {
  description = "Container image name"
  type        = string
  default     = "oborishte-ingest"
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "schedule_timezone" {
  description = "Timezone for scheduler jobs"
  type        = string
  default     = "Europe/Sofia"
}

variable "schedules" {
  description = "Cron schedules for each job (in cron format: minute hour day month weekday)"
  type = object({
    pipeline_emergent               = string
    pipeline_all                    = string
    gtfs_sync                       = string
    educational_facilities_sync     = optional(string, "0 4 1 * *")
    air_quality_fetch               = optional(string, "*/15 * * * *")
    geocode_cache_report            = optional(string, "0 5 * * 1")
    heatmap_report                  = optional(string, "0 4 * * 1")
    heartbeat_check                 = optional(string, "30 17 * * *")
  })
  default = {
    pipeline_emergent               = "*/30 7-22 * * *"    # Every 30 minutes, 7:00AM–10:30PM (hours 7-22)
    pipeline_all                    = "0 10,14,16 * * *"   # 3x daily: 10:00, 14:00, 16:00
    gtfs_sync                       = "0 3 * * *"          # Daily at 3:00 AM
    educational_facilities_sync     = "0 4 1 * *"          # Monthly on the 1st at 4:00 AM
    air_quality_fetch               = "*/15 * * * *"       # Every 15 minutes, 24/7
    geocode_cache_report            = "0 5 * * 1"          # Weekly on Monday at 5:00 AM
    heatmap_report                  = "0 4 * * 1"          # Weekly on Monday at 4:00 AM
    heartbeat_check                 = "30 17 * * *"        # Daily at 17:30, after the last pipeline-all run (16:00)
  }
}

variable "firebase_project_id" {
  description = "Firebase project ID (can be public)"
  type        = string
}

variable "alert_email" {
  description = "Email address for pipeline failure alerts"
  type        = string
}

variable "locality" {
  description = "Locality identifier for messages (e.g., bg.sofia)"
  type        = string
  default     = "bg.sofia"
}

variable "ci_service_account_email" {
  description = "Email of the CI/CD service account that runs Terraform (needs workflows.admin to update workflow definitions)"
  type        = string
}

variable "sentry_dsn_secret_id" {
  description = "Secret Manager secret ID for the Sentry DSN. Leave empty to disable Sentry error monitoring."
  type        = string
  default     = ""
}

variable "gcs_generic_bucket" {
  description = "GCS bucket name for general-purpose file storage (air quality readings, geocode cache reports, etc.)"
  type        = string
  default     = ""

  validation {
    condition     = var.gcs_generic_bucket == "" || length(var.gcs_generic_bucket) > 3
    error_message = "gcs_generic_bucket must be empty (disabled) or a valid GCS bucket name (>3 chars)."
  }
}
variable "app_url" {
  description = "Public URL of the web app, used in notification links (e.g. https://oboapp.online)"
  type        = string
}

variable "artifact_registry_repo_id" {
  description = "Artifact Registry repository ID for the ingest Docker image"
  type        = string
  default     = "oborishte-ingest"
}