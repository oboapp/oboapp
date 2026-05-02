# Deploying oboapp for a New City

oboapp is designed to be deployed for any city. The upstream repository (`oboapp/oboapp`) contains the infrastructure definitions and crawler implementations. Each production deployment is a **fork** that contributes its own instance configuration on top.

## Upstream vs. Instance Files

| Scope | What lives there |
|---|---|
| Upstream | Terraform modules, crawler implementations, per-locality crawler definitions |
| Instance-only | Deployment workflows, secrets, CI environment variables, `terraform.tfvars` |

Never override upstream Terraform logic in instance files — configure via variables instead.

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
