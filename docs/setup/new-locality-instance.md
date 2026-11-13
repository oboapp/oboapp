# Deploying oboapp for a New City

oboapp is designed to be deployed for any city. The upstream repository (`oboapp/oboapp`) contains the infrastructure definitions and crawler implementations. Each production deployment is a **fork** that contributes its own instance configuration on top.

## Upstream vs. Instance Files

| Scope | What lives there |
|---|---|
| Upstream | Terraform modules, source integrations, source job examples, individual source definitions (`shared/src/sources/{id}.ts`) |
| Instance-only | Deployment workflows, secrets, CI environment variables, `terraform.tfvars`, source assembly (`shared/src/sources.ts`), selected source job JSON, source package retention policy |

Configure upstream Terraform logic through variables in instance files.

## Configuring Sources

**Migration in progress:** each selected source uses either a published package or a remaining legacy crawler. For a packaged source, install its exact published version in `ingest/` and connect its command entrypoint to Obo's runner. Select sources through `shared/src/sources.ts` and `ingest/terraform/source-jobs.<locality>.json`. Catalog definitions remain in `shared/src/sources/`. CI and the ingest image build validate the selected catalog, package metadata, entrypoints and job data. Installation, builds and deployment images still include unselected implementations during this transition. See [the transition guide](../features/source-packages.md) for the current source inventory and integration steps.

The upstream demo selects Sofia BG, Sofiyska Voda and sensor.community. It also keeps the migrated source packages installed so their adapters and integration tests remain buildable during the migration. `ingest/source-package-policy.json` lists these packages under `retainedUnselectedPackages`. The check still validates their isolated metadata, exact dependency versions and unique source IDs. An installed unselected package needs an explicit retention entry. Remove that entry when selecting the source or removing its package. With the policy absent or empty, all installed source packages must be selected.

Forks that retain all source integration code should keep its package dependencies installed. Building an image with only selected implementations remains part of #586. Run `pnpm --dir ingest exec tsx scripts/check-source-config.ts` to check your selection without provider or database access.

Each source has its own definition file at `shared/src/sources/{id}.ts`. These live in the upstream repo and merge cleanly across rebases — adding a new upstream source creates a new file, no conflicts.

`shared/src/sources.ts` is the **instance assembly**: it imports the individual definition files and assembles the `SOURCES` array used by both the web app and ingest pipeline. Fork operators replace this file to configure which sources their instance exposes.

The collection commands use a shared runtime registry derived from this array. `crawl --help` lists selected sources, and `crawl --source <source-id>` rejects an unselected ID even if its implementation directory exists. `pipeline --all` runs all selected sources, while `pipeline --emergent` runs only selected sources marked `emergent: true`.

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

Each city's jobs are defined in `ingest/terraform/source-jobs.<locality-id>.json`. For example, locality `bg.sofia` maps to `source-jobs.bg.sofia.json`. Terraform discovers these files automatically. The `localities` variable selects which maps are active for a deployment. Job keys must be unique across locality files.

The upstream `source-jobs.bg.sofia.json` contains only the three demo sources. The full Sofia job example is `ingest/terraform/examples/source-jobs.bg.sofia.json`; files under `examples/` are inactive templates.

For an existing Sofia deployment, keep your instance's source catalog and job selection when rebasing. To translate the previous Terraform source map, copy the full example into `ingest/terraform/source-jobs.bg.sofia.json`, then remove jobs outside your instance catalog. Preserve existing job keys, memory settings, timeouts and emergent flags. The example includes sensor.community, so remove its job if your instance does not select it. Delete the package retention policy, or empty its list, if your catalog selects all installed source packages. Run the source configuration check and review `terraform plan` before deployment.

**In your forked `deploy.yml`**, create a GitHub Actions repository variable named `LOCALITIES` with a JSON string value:

```
["bg.sofia"]
```

This is passed to Terraform as `-var='localities=["bg.sofia"]'`.

The default is `["bg.sofia"]` if `LOCALITIES` is not set.

> **Note:** Deployments are currently restricted to exactly one locality ID. Terraform fails fast when more than one locality is provided, preventing data mis-tagging until per-crawler locality scoping is implemented.

**In the web app**, set `vars.LOCALITY` to the single locality the web app serves (the web app displays one city at a time):

```
vars.LOCALITY = "bg.sofia"
```

## Adding a New City (Upstream Contribution)

To add crawler support for a new city, contribute to the upstream repository:

1. Add the new locality's crawler support in the upstream ingestion code and shared source configuration.
2. Add `ingest/terraform/source-jobs.<locality-id>.json` with the new locality's jobs. Keep source IDs and emergent flags aligned with the instance catalog, then run the source configuration check.
3. Follow the [Crawler Development guidelines](../../AGENTS.md#crawler-development) for the full checklist and current file-level requirements.

Once merged upstream, any deployment can activate the new city by adding its locality ID to the deployment locality configuration described above.

## Instance Setup

Copy `ingest/terraform/terraform.tfvars.example` to `terraform.tfvars` and fill in your GCP project details. See [Production Setup](production-setup.md) for the full GCP and Firebase configuration walkthrough.
