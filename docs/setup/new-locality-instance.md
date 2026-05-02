# Deploying oboapp for a New City

oboapp is designed to be deployed for any city. The upstream repository (`oboapp/oboapp`) contains the infrastructure definitions and crawler implementations. Each production deployment is a **fork** that contributes its own instance configuration on top.

## Upstream vs. Instance Files

| Scope | What lives there |
|---|---|
| Upstream | Terraform modules, crawler implementations, per-locality crawler definitions |
| Instance-only | Deployment workflows, secrets, CI environment variables, `terraform.tfvars` |

Never override upstream Terraform logic in instance files — configure via variables instead.

## Configuring Which Localities to Deploy

Each city's crawlers are defined in a dedicated file in `ingest/terraform/`, named `crawlers.bg.<locality>.tf`. The `localities` Terraform variable controls which of these are active for a given deployment.

**In your forked `deploy.yml`**, create a GitHub Actions repository variable named `LOCALITIES` with a JSON string value:

```
["bg.sofia"]
```

This is passed to Terraform as `-var='localities=["bg.sofia"]'`. Multiple cities can be combined:

```
["bg.sofia", "bg.burgas", "bg.plovdiv"]
```

The default is `["bg.sofia"]` if `LOCALITIES` is not set.

> **Note:** Multi-locality assembly creates one Cloud Run job per crawler across all listed cities. Per-crawler locality scoping (each crawler receiving its own city context at runtime) is planned.

**In the web app**, set `vars.LOCALITY` to the single locality the web app serves (the web app displays one city at a time):

```
vars.LOCALITY = "bg.sofia"
```

## Adding a New City (Upstream Contribution)

To add crawler support for a new city, contribute to the upstream repository:

1. Implement the crawlers under `ingest/crawlers/` and register them in `shared/src/sources.ts` with the correct `localities` value (e.g. `["bg.burgas"]`).
2. Create `ingest/terraform/crawlers.bg.<locality>.tf` defining the crawler map for that locality.
3. Add a `contains(var.localities, "bg.<locality>")` line in `ingest/terraform/crawlers.tf` to wire it into the assembly.
4. Follow the [Crawler Development guidelines](../../AGENTS.md#crawler-development) for the full checklist.

Once merged upstream, any deployment can activate the new city by adding its locality ID to `vars.LOCALITIES`.

## Instance Setup

Copy `ingest/terraform/terraform.tfvars.example` to `terraform.tfvars` and fill in your GCP project details. See [Production Setup](production-setup.md) for the full GCP and Firebase configuration walkthrough.
