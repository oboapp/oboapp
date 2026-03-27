variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "Google Cloud region for resources"
  type        = string
  default     = "europe-west1"
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
  })
  default = {
    pipeline_emergent               = "*/30 7-22 * * *"    # Every 30 minutes, 7:00AM–10:30PM (hours 7-22)
    pipeline_all                    = "0 10,14,16 * * *"   # 3x daily: 10:00, 14:00, 16:00
    gtfs_sync                       = "0 3 * * *"          # Daily at 3:00 AM
    educational_facilities_sync     = "0 4 1 * *"          # Monthly on the 1st at 4:00 AM
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
