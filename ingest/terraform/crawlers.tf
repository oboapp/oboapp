# Assembles the final crawler map from per-locality crawler definitions.
#
# To add a new locality:
#   1. Create crawlers.bg.<locality>.tf defining local.crawlers_bg_<locality>
#   2. Add a contains(...) line in the _assembled merge below
#   3. Add the locality to var.localities (or pass it at apply time)
#
# To override all crawlers for a specific deployment without touching this file,
# set var.crawlers to a non-empty map in terraform.tfvars or via -var.

locals {
  _assembled_crawlers = merge(
    contains(var.localities, "bg.sofia") ? local.crawlers_bg_sofia : {},
    # Add new localities here, e.g.:
    # contains(var.localities, "bg.burgas") ? local.crawlers_bg_burgas : {},
    # contains(var.localities, "bg.plovdiv") ? local.crawlers_bg_plovdiv : {},
  )

  # var.crawlers, if non-empty, acts as a full manual override (escape hatch).
  crawlers = length(var.crawlers) > 0 ? var.crawlers : local._assembled_crawlers
}
