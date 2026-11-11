mock_provider "google" {}

variables {
  project_id               = "test-ingest-project"
  firebase_project_id      = "test-ingest-project"
  alert_email              = "alerts@example.com"
  ci_service_account_email = "ci@test-ingest-project.iam.gserviceaccount.com"
  app_url                  = "https://example.com"
}

run "upstream_defaults_deploy_only_the_three_demo_sources" {
  command = plan

  assert {
    condition = {
      for name, job in local.crawlers : name => job.source
      } == {
      sofia            = "sofia-bg"
      sofiyska-voda    = "sofiyska-voda"
      sensor-community = "sensor-community"
    }
    error_message = "The upstream demo must deploy only its three catalog sources and keep example jobs inactive."
  }

  assert {
    condition = alltrue([
      for name, job in google_cloud_run_v2_job.crawlers :
      job.name == "crawl-${name}" &&
      one(one(job.template).template).timeout == (name == "sensor-community" ? "600s" : "1800s") &&
      one(one(job.template).template).containers[0].args == tolist([
        "pnpm", "run", "prebuilt:crawl", "--source", local.crawlers[name].source
      ]) &&
      one(one(job.template).template).containers[0].resources[0].limits.memory == (name == "sofia" ? "1Gi" : "512Mi")
    ])
    error_message = "The demo must retain existing Cloud Run names, source arguments, timeouts and memory limits."
  }

  assert {
    condition = toset(
      yamldecode(google_workflows_workflow.pipeline_emergent.source_contents).main.steps[0].init.assign[2].crawlers
    ) == toset(["sofiyska-voda", "sensor-community"])
    error_message = "The demo emergent workflow must contain water and sensor.community."
  }

  assert {
    condition = toset(
      yamldecode(google_workflows_workflow.pipeline_all.source_contents).main.steps[0].init.assign[2].crawlers
    ) == toset(["sofia", "sofiyska-voda", "sensor-community"])
    error_message = "The regular workflow must contain exactly the three demo jobs."
  }
}

run "full_sofia_example_preserves_deployed_identities_and_resources" {
  command = plan

  variables {
    crawlers = jsondecode(file("examples/source-jobs.bg.sofia.json"))
  }

  assert {
    condition = {
      for name, job in local.crawlers : name => job.source
      } == {
      rayon-oborishte        = "rayon-oborishte-bg"
      sofia                  = "sofia-bg"
      sofiyska-voda          = "sofiyska-voda"
      toplo                  = "toplo-bg"
      erm-zapad              = "erm-zapad"
      mladost                = "mladost-bg"
      studentski             = "studentski-bg"
      sredec                 = "sredec-sofia-org"
      serdika                = "serdika-egov-bg"
      slatina                = "so-slatina-org"
      lozenets               = "lozenets-sofia-bg"
      raioniskar             = "raioniskar-bg"
      rayon-pancharevo       = "rayon-pancharevo-bg"
      rayon-ilinden          = "rayon-ilinden-bg"
      triaditsa              = "triaditsa-org"
      krasna-polyana         = "krasna-polyana-org"
      vrabnitsa              = "vrabnitsa-org"
      nadezhda               = "nadezhda-org"
      inspectorat-so         = "inspectorat-so-org"
      nimh-severe-weather    = "nimh-severe-weather"
      sensor-community       = "sensor-community"
      sofia-capital-of-sport = "sofia-capital-of-sport"
      sdvr-mvr               = "sdvr-mvr-bg"
    }
    error_message = "Loading source job JSON must retain every deployed job key and historical source ID."
  }

  assert {
    condition = alltrue([
      for name, job in google_cloud_run_v2_job.crawlers :
      job.name == "crawl-${name}" &&
      one(one(job.template).template).timeout == (name == "sensor-community" ? "600s" : "1800s") &&
      one(one(job.template).template).containers[0].args == tolist([
        "pnpm", "run", "prebuilt:crawl", "--source", local.crawlers[name].source
      ]) &&
      one(one(job.template).template).containers[0].resources[0].limits.memory == (
        contains(["sofiyska-voda", "toplo", "erm-zapad", "nimh-severe-weather", "sensor-community"], name) ? "512Mi" : "1Gi"
      )
    ])
    error_message = "Source job JSON must keep existing Cloud Run names, source arguments, timeouts and memory limits."
  }

  assert {
    condition = toset(
      yamldecode(google_workflows_workflow.pipeline_emergent.source_contents).main.steps[0].init.assign[2].crawlers
    ) == toset(["sofiyska-voda", "toplo", "erm-zapad", "sensor-community"])
    error_message = "Only explicitly emergent sources belong in the 30-minute workflow; omitted flags must remain false."
  }

  assert {
    condition = toset(
      yamldecode(google_workflows_workflow.pipeline_all.source_contents).main.steps[0].init.assign[2].crawlers
    ) == toset(keys(local.crawlers))
    error_message = "The regular workflow must retain the complete selected source job set."
  }
}

run "manual_override_keeps_its_own_jobs_and_defaults" {
  command = plan

  variables {
    localities = ["bg.test"]
    crawlers = {
      custom = {
        source = "custom-source"
      }
    }
  }

  assert {
    condition = keys(google_cloud_run_v2_job.crawlers) == ["custom"] && (
      google_cloud_run_v2_job.crawlers["custom"].name == "crawl-custom"
    )
    error_message = "A manual crawler override must fully replace locality job data, including for an unregistered locality."
  }

  assert {
    condition = (
      one(one(google_cloud_run_v2_job.crawlers["custom"].template).template).timeout == "1800s" &&
      one(one(google_cloud_run_v2_job.crawlers["custom"].template).template).containers[0].resources[0].limits.memory == "1Gi" &&
      !local.crawlers["custom"].emergent
    )
    error_message = "Manual overrides must retain the default timeout, memory and regular schedule when fields are omitted."
  }
}

run "missing_locality_data_is_reported" {
  command = plan

  variables {
    localities = ["bg.missing"]
  }

  expect_failures = [check.localities_supported]
}
