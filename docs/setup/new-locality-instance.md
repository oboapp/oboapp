# Deploying oboapp for a New City

oboapp is designed to be deployed for any city. The upstream repository (`oboapp/oboapp`) contains the infrastructure definitions and crawler implementations. Each production deployment is a **fork** that contributes its own instance configuration on top.

## Upstream vs. Instance Files

| Scope | What lives there |
|---|---|
| Upstream | Terraform modules, crawler implementations, per-locality crawler definitions, individual source definitions (`shared/src/sources/{id}.ts`) |
| Instance-only | Deployment workflows, secrets, CI environment variables, `terraform.tfvars`, instance source assembly (`shared/src/sources.ts`) |

Never override upstream Terraform logic in instance files — configure via variables instead.

## Configuring Sources

Each source has its own definition file at `shared/src/sources/{id}.ts`. These live in the upstream repo and merge cleanly across rebases — adding a new upstream source creates a new file, no conflicts.

`shared/src/sources.ts` is the **instance assembly**: it imports the individual definition files and assembles the `SOURCES` array used by both the web app and ingest pipeline. Fork operators replace this file to configure which sources their instance exposes.

When rebasing from upstream, `shared/src/sources/{id}.ts` files merge cleanly. `shared/src/sources.ts` is the intentional conflict zone — review it consciously to decide which upstream sources to include in your instance.

`EMERGENT_CRAWLERS` (the list of crawlers that run on the 30-minute schedule) is derived automatically from the `emergent` flag on each source definition — no separate list to maintain.

## Configuring Geocoding Providers

Geocoding provider selection (which service geocodes each supported location type) is configured in `shared/src/geocoding-sources.ts`. This is the single instance assembly file for geocoding, similar to how `shared/src/sources.ts` is the assembly for news sources.

Fork operators replace `shared/src/geocoding-sources.ts` with their city's configuration. The file exports:

- **`GEOCODING_RESOLVERS`** — which provider handles each supported location type; includes provider-specific URLs where needed
- **`GEOCODING_SOURCES`** — metadata (provider names and URLs) displayed on the web app's sources page

The ingest pipeline validates the configuration at startup (fail-fast if invalid).

**On rebase from upstream:** `shared/src/geocoding-sources.ts` is the intentional conflict zone — the fork operator reviews it consciously to decide their city's provider configuration, similar to how `shared/src/sources.ts` is a conflict zone for source selection.

## Configuring Which Localities to Deploy

Each city's crawlers are defined in a dedicated Terraform file named after its locality ID. The naming pattern is `crawlers.<locality-id>.tf` — for example, locality `bg.sofia` maps to `crawlers.bg.sofia.tf`. The `localities` Terraform variable controls which of these are active for a given deployment.

**In your forked `deploy.yml`**, create a GitHub Actions repository variable named `LOCALITIES` with a JSON string value:

```
["bg.sofia"]
```

This is passed to Terraform as `-var='localities=["bg.sofia"]'`. Multiple cities can be combined:

```
["bg.sofia", "bg.burgas", "bg.plovdiv"]
```

The default is `["bg.sofia"]` if `LOCALITIES` is not set.

> **Note:** Multi-locality assembly creates one Cloud Run job per crawler across all listed cities. Until per-crawler locality scoping is implemented, all crawler jobs share the same `var.locality` execution context — for now, pass a single-element list to avoid data mis-tagging.

**In the web app**, set `vars.LOCALITY` to the single locality the web app serves (the web app displays one city at a time):

```
vars.LOCALITY = "bg.sofia"
```

## Adding a New City (Upstream Contribution)

To add crawler support for a new city, contribute to the upstream repository:

1. Add the new locality's crawler support in the upstream ingestion code and shared source configuration.
2. Update the upstream Terraform locality configuration using the existing `crawlers.<locality-id>.tf` naming pattern and the standard supported-localities wiring.
3. Follow the [Crawler Development guidelines](../../AGENTS.md#crawler-development) for the full checklist and current file-level requirements.

Once merged upstream, any deployment can activate the new city by adding its locality ID to the deployment locality configuration described above.

## Instance Setup

Copy `ingest/terraform/terraform.tfvars.example` to `terraform.tfvars` and fill in your GCP project details. See [Production Setup](production-setup.md) for the full GCP and Firebase configuration walkthrough.
