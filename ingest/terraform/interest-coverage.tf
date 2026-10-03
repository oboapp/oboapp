data "google_secret_manager_secret" "interest_coverage_jitter" {
  count     = var.gcs_generic_bucket != "" ? 1 : 0
  secret_id = var.interest_coverage_jitter_secret_id
  project   = var.project_id

  depends_on = [google_project_service.secretmanager]
}

resource "google_cloud_run_v2_job" "interest_coverage_report" {
  count    = var.gcs_generic_bucket != "" ? 1 : 0
  name     = "interest-coverage-report"
  location = var.region

  template {
    template {
      service_account = google_service_account.ingest_runner.email
      timeout         = "600s"

      containers {
        image = local.full_image_url
        args  = ["pnpm", "run", "prebuilt:interest-coverage-report"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        env {
          name = "FIREBASE_SERVICE_ACCOUNT_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.firebase_sa_key.secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.firebase_project_id
        }

        env {
          name  = "LOCALITY"
          value = var.locality
        }

        env {
          name = "INTEREST_COVERAGE_JITTER_SECRET"
          value_source {
            secret_key_ref {
              secret = data.google_secret_manager_secret.interest_coverage_jitter[0].secret_id
              # Pin the version: routine secret changes must not move circles
              # between snapshots and make independent offsets averageable.
              version = var.interest_coverage_jitter_secret_version
            }
          }
        }

        env {
          name  = "GCS_GENERIC_BUCKET"
          value = var.gcs_generic_bucket
        }

        dynamic "env" {
          for_each = local.sentry_env_secret_ids
          content {
            name = "SENTRY_DSN"
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }
      }

      max_retries = 1
    }
  }

  lifecycle {
    ignore_changes = [
      launch_stage,
    ]
  }

  depends_on = [
    google_project_service.run
  ]
}

resource "google_cloud_scheduler_job" "interest_coverage_report_schedule" {
  count            = var.gcs_generic_bucket != "" ? 1 : 0
  name             = "interest-coverage-report-schedule"
  description      = "Generate aggregate interest heatmap weekly"
  schedule         = var.schedules.interest_coverage_report
  time_zone        = var.schedule_timezone
  attempt_deadline = "620s"
  region           = var.region

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/interest-coverage-report:run"

    oauth_token {
      service_account_email = google_service_account.ingest_runner.email
    }
  }

  depends_on = [
    google_project_service.cloudscheduler,
    google_cloud_run_v2_job.interest_coverage_report,
  ]
}

resource "google_monitoring_alert_policy" "interest_coverage_report_failures" {
  count        = var.gcs_generic_bucket != "" ? 1 : 0
  display_name = "Job Failure: Interest Coverage Report"
  combiner     = "OR"

  conditions {
    display_name = "interest-coverage-report error"

    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_job"
        resource.labels.job_name="interest-coverage-report"
        severity>=ERROR
      EOT
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  notification_channels = [
    google_monitoring_notification_channel.email.name
  ]

  documentation {
    content   = "The **interest-coverage-report** job logged an error.\n\nLogs: https://console.cloud.google.com/run/jobs/details/${var.region}/interest-coverage-report/logs?project=${var.project_id}"
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.monitoring]
}


