mock_provider "google" {}

variables {
  project_id               = "test-ingest-project"
  firebase_project_id      = "test-ingest-project"
  alert_email              = "alerts@example.com"
  ci_service_account_email = "ci@test-ingest-project.iam.gserviceaccount.com"
  app_url                  = "https://example.com"
}

run "empty_source_lists_produce_valid_workflows" {
  command = plan

  assert {
    condition = alltrue([
      for workflow in ["emergent", "all"] :
      yamldecode(templatefile("${path.module}/workflows/${workflow}.yaml.tftpl", {
        crawler_job_names = []
      })).main.steps[0].init.assign[2].crawlers == []
    ])
    error_message = "Both workflow templates must render a valid empty crawler list when no sources are selected."
  }

  assert {
    condition = alltrue([
      for workflow in ["emergent", "all"] :
      length(yamldecode(templatefile("${path.module}/workflows/${workflow}.yaml.tftpl", {
        crawler_job_names = []
      })).main.steps) == 5
    ])
    error_message = "An empty crawler list must preserve the following crawl, ingest, notify and completion steps."
  }
}

run "single_source_lists_preserve_the_job" {
  command = plan

  assert {
    condition = alltrue([
      for workflow in ["emergent", "all"] :
      yamldecode(templatefile("${path.module}/workflows/${workflow}.yaml.tftpl", {
        crawler_job_names = ["single-job"]
      })).main.steps[0].init.assign[2].crawlers == ["single-job"]
    ])
    error_message = "Both workflow templates must preserve a single selected crawler job."
  }
}

run "multiple_source_lists_preserve_job_order" {
  command = plan

  assert {
    condition = alltrue([
      for workflow in ["emergent", "all"] :
      yamldecode(templatefile("${path.module}/workflows/${workflow}.yaml.tftpl", {
        crawler_job_names = ["second-job", "first-job"]
      })).main.steps[0].init.assign[2].crawlers == ["second-job", "first-job"]
    ])
    error_message = "Both workflow templates must preserve all selected crawler jobs in their supplied order."
  }
}
