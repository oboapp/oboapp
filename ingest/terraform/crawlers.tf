# Assembles the final crawler map from per-locality crawler definitions.
#
# To add a new locality:
#   1. Create crawlers.bg.<locality>.tf defining local.crawlers_bg_<locality>
#   2. Add the locality ID to local._supported_localities below
#   3. Add a contains(var.localities, ...) branch in the merge below
#   4. Pass the new ID in var.localities at apply time (or in terraform.tfvars)
#
# To override all crawlers for a specific deployment without touching this file,
# set var.crawlers to a non-empty map in terraform.tfvars or via -var.

locals {
  # Single source of truth for supported locality IDs.
  # Steps 2–3 above are the only changes needed here when adding a new city.
  _supported_localities = toset(["bg.sofia"])

  _assembled_crawlers = merge(
    contains(var.localities, "bg.sofia") ? local.crawlers_bg_sofia : {},
    # Add new localities here, e.g.:
    # contains(var.localities, "bg.burgas") ? local.crawlers_bg_burgas : {},
    # contains(var.localities, "bg.plovdiv") ? local.crawlers_bg_plovdiv : {},
    #
    # IMPORTANT: merge() silently overwrites duplicate keys. Crawler job keys must
    # be globally unique across all locality maps. Use a locality-prefixed naming
    # convention if the same logical service might appear in multiple cities.
  )

  # var.crawlers, if non-empty, acts as a full manual override (escape hatch).
  crawlers = length(var.crawlers) > 0 ? var.crawlers : local._assembled_crawlers
}

# Warn early when var.localities requests a city with no crawler file wired in.
# Skip this check when var.crawlers is non-empty (full manual override active).
check "localities_supported" {
  assert {
    condition     = length(var.crawlers) > 0 || length(setsubtract(toset(var.localities), local._supported_localities)) == 0
    error_message = "var.localities contains unsupported ID(s): ${jsonencode(tolist(setsubtract(toset(var.localities), local._supported_localities)))}. To add a locality: create crawlers.bg.<city>.tf, then add the ID to local._supported_localities and a contains() branch in crawlers.tf."
  }
}
