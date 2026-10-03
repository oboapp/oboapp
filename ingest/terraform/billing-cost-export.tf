locals {
  billing_export_jobs = var.billing_export == null || var.gcs_generic_bucket == "" ? {} : { enabled = var.billing_export }
}

resource "google_project_service" "billing_bigquery" {
  for_each           = local.billing_export_jobs
  project            = each.value.project
  service            = "bigquery.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_iam_member" "billing_job_user" {
  for_each = local.billing_export_jobs
  project  = each.value.project
  role     = "roles/bigquery.jobUser"
  member   = "serviceAccount:${google_service_account.ingest_runner.email}"

  depends_on = [google_project_service.billing_bigquery]
}

resource "google_bigquery_dataset_iam_member" "billing_data_viewer" {
  for_each   = local.billing_export_jobs
  project    = each.value.project
  dataset_id = each.value.dataset
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.ingest_runner.email}"

  depends_on = [google_project_service.billing_bigquery]
}

resource "google_cloud_run_v2_job" "billing_cost_export" {
  for_each = local.billing_export_jobs
  name     = "billing-cost-export"
  location = var.region

  template {
    template {
      service_account = google_service_account.ingest_runner.email
      timeout         = "600s"
      max_retries     = 1

      containers {
        image = local.full_image_url
        args  = ["pnpm", "run", "prebuilt:billing-cost-export"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = {
            NODE_ENV                  = "production"
            GCS_GENERIC_BUCKET        = var.gcs_generic_bucket
            BILLING_BIGQUERY_PROJECT  = each.value.project
            BILLING_BIGQUERY_DATASET  = each.value.dataset
            BILLING_BIGQUERY_TABLE    = each.value.table
            BILLING_BIGQUERY_LOCATION = each.value.location
          }
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [launch_stage]
  }

  depends_on = [
    google_project_service.run,
    google_project_iam_member.billing_job_user,
    google_bigquery_dataset_iam_member.billing_data_viewer,
    google_storage_bucket_iam_member.generic_bucket_object_admin,
  ]
}

resource "google_cloud_scheduler_job" "billing_cost_export_schedule" {
  for_each         = local.billing_export_jobs
  name             = "billing-cost-export-schedule"
  description      = "Export monthly GCP billing costs to the public report snapshot"
  schedule         = var.schedules.billing_cost_export
  time_zone        = var.schedule_timezone
  attempt_deadline = "620s"
  region           = var.region

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.billing_cost_export[each.key].name}:run"

    oauth_token {
      service_account_email = google_service_account.ingest_runner.email
    }
  }

  depends_on = [google_project_service.cloudscheduler]
}

resource "google_monitoring_alert_policy" "billing_cost_export_failures" {
  for_each     = local.billing_export_jobs
  display_name = "Job Failure: Billing Cost Export"
  combiner     = "OR"

  conditions {
    display_name = "billing-cost-export error"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_job"
        resource.labels.job_name="billing-cost-export"
        severity>=ERROR
      EOT
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
  documentation {
    content   = "The **billing-cost-export** job logged an error.\n\nLogs: https://console.cloud.google.com/run/jobs/details/${var.region}/billing-cost-export/logs?project=${var.project_id}"
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.monitoring]
}
