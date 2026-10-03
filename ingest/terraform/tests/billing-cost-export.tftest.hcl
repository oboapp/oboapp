mock_provider "google" {}

# Run with Terraform >=1.7: terraform test -test-directory=tests

variables {
  project_id               = "test-ingest-project"
  firebase_project_id      = "test-ingest-project"
  alert_email              = "alerts@example.com"
  ci_service_account_email = "ci@test-ingest-project.iam.gserviceaccount.com"
  app_url                  = "https://example.com"
  gcs_generic_bucket       = "test-report-bucket"
  billing_export           = null
}

run "billing_disabled_without_configuration" {
  command = plan

  assert {
    condition     = length(google_cloud_run_v2_job.billing_cost_export) == 0 && length(google_cloud_scheduler_job.billing_cost_export_schedule) == 0
    error_message = "Instances without billing configuration must not create a billing job or schedule."
  }
}

run "monthly_export_preserves_billing_snapshot" {
  command = plan

  variables {
    billing_export = {
      project  = "test-billing-project"
      dataset  = "billing_export"
      table    = "gcp_billing_export_v1_TEST"
      location = "EU"
    }
  }

  assert {
    condition     = google_cloud_scheduler_job.billing_cost_export_schedule["enabled"].schedule == "0 5 3 * *" && google_cloud_scheduler_job.billing_cost_export_schedule["enabled"].time_zone == "Europe/Sofia"
    error_message = "Billing must run monthly on the third at 05:00 in Sofia time by default."
  }

  assert {
    condition = alltrue([
      for rule in google_storage_bucket.generic[0].lifecycle_rule :
      one(rule.action).type != "Delete" || (
        length(one(rule.condition).matches_prefix) > 0 &&
        alltrue([for prefix in one(rule.condition).matches_prefix : !startswith("billing/cost-report.json", prefix)])
      )
    ])
    error_message = "No bucket deletion rule may match the monthly billing snapshot."
  }

  assert {
    condition     = one(google_storage_bucket.generic[0].lifecycle_rule[0].condition).age == 10 && contains(one(google_storage_bucket.generic[0].lifecycle_rule[0].condition).matches_prefix, "interests/") && contains(one(google_storage_bucket.generic[0].lifecycle_rule[0].condition).matches_prefix, "notifications/")
    error_message = "Weekly public snapshots must keep their existing ten-day expiry."
  }

  assert {
    condition     = google_project_iam_member.billing_job_user["enabled"].project == "test-billing-project" && google_bigquery_dataset_iam_member.billing_data_viewer["enabled"].dataset_id == "billing_export"
    error_message = "Billing permissions must target the configured export project and dataset."
  }
}

run "billing_disabled_without_bucket" {
  command = plan

  variables {
    gcs_generic_bucket = ""
    billing_export = {
      project = "test-billing-project"
      dataset = "billing_export"
      table   = "gcp_billing_export_v1_TEST"
    }
  }

  assert {
    condition     = length(google_cloud_run_v2_job.billing_cost_export) == 0 && length(google_project_iam_member.billing_job_user) == 0
    error_message = "Billing jobs and permissions must remain disabled without an upload bucket."
  }
}

run "partial_configuration_rejected" {
  command = plan

  variables {
    billing_export = {
      project = "test-billing-project"
      dataset = ""
      table   = ""
    }
  }

  expect_failures = [var.billing_export]
}
