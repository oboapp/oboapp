# Discovers source-jobs.<locality-id>.json files and assembles the selected jobs.
# Files under examples/ are templates and are not deployed automatically.
# Add a locality by creating its JSON file and selecting it in var.localities.
# Job keys must be globally unique across selected localities.
# A non-empty var.crawlers fully overrides the JSON assembly.

locals {
  _source_jobs_by_locality = {
    for filename in fileset(path.module, "source-jobs.*.json") :
    trimsuffix(trimprefix(filename, "source-jobs."), ".json") => jsondecode(file("${path.module}/${filename}"))
  }
  _supported_localities = toset(keys(local._source_jobs_by_locality))
  _selected_source_jobs = [
    for locality in var.localities : try(local._source_jobs_by_locality[locality], {})
  ]
  _assembled_crawlers = merge(
    {},
    local._selected_source_jobs...
  )

  # var.crawlers, if non-empty, acts as a full manual override (escape hatch).
  crawlers = length(var.crawlers) > 0 ? var.crawlers : local._assembled_crawlers
}

# Warn early when var.localities requests a city without a source job data file.
# Skip this check when var.crawlers is non-empty (full manual override active).
check "localities_supported" {
  assert {
    condition     = length(var.crawlers) > 0 || length(setsubtract(toset(var.localities), local._supported_localities)) == 0
    error_message = "var.localities contains unsupported ID(s): ${jsonencode(tolist(setsubtract(toset(var.localities), local._supported_localities)))}. Add a source-jobs.<locality-id>.json file for each requested locality."
  }
}

check "source_job_names_unique" {
  assert {
    condition = length(var.crawlers) > 0 || length(flatten([
      for jobs in local._selected_source_jobs : keys(jobs)
    ])) == length(local._assembled_crawlers)
    error_message = "Source job keys must be unique across the selected locality files. Use locality-prefixed keys for jobs shared by multiple localities."
  }
}
