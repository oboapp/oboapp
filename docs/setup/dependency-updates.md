# Dependency updates

[`.github/dependabot.yml`](../../.github/dependabot.yml) configures weekly
version updates on Mondays at 09:00 in `Europe/Sofia`, targeting the repository's
default branch.

## Coverage and grouping

- One `npm` entry at `/` uses pnpm, the root `package.json`,
  `pnpm-workspace.yaml`, and `pnpm-lock.yaml`. Dependabot discovers the `api`,
  `web`, `ingest`, `shared`, and `db` manifests through the workspace definition.
  Do not add separate entries for those packages while they share a lockfile:
  they would compete to update the same file. Add future workspace packages to
  `pnpm-workspace.yaml`.
- Runtime minor/patch updates and development-tool minor/patch updates form
  separate groups. Major upgrades remain individual PRs for explicit review.
  The npm job allows at most five open version-update PRs.
- The `github-actions` entry at `/` covers `.github/workflows` and root action
  manifests. Minor/patch action upgrades form one group; major upgrades remain
  individual PRs. The Actions job allows at most three open version-update PRs.
- There are no dependency ignore rules or path exclusions. Local `workspace:*`
  dependencies remain local links; this config does not publish or version them.
  Terraform providers and APM resources are outside these two ecosystems.

The npm ecosystem supports pnpm workspaces, including discovery of their
manifests; see the [Dependabot file fetcher](https://github.com/dependabot/dependabot-core/blob/main/npm_and_yarn/lib/dependabot/npm_and_yarn/file_fetcher.rb).
Schedule, grouping, and ecosystem options are described in the
[GitHub configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

## Security settings

Version-update configuration is separate from Dependabot alerts and security
updates. A read-only check of `oboapp/oboapp` on October 4, 2026 found:

- The vulnerability-alerts endpoint reported that alerts were disabled.
- The automated-security-fixes endpoint returned `enabled: false` and
  `paused: false`; repository metadata also reported security updates disabled.
- Listing alerts was unavailable because alerts were disabled. This does not
  establish that the dependencies have no vulnerabilities.

This change does not modify those repository settings. Maintainers can manage
them in **Settings → Code security**. Forks should check their own settings.
Version-update PR limits and minor/patch grouping do not define a security-update
policy.

## Validate after merging

GitHub runs hosted version updates from the default branch, so a local YAML check
cannot confirm a successful Dependabot run. After merging:

1. Open **Insights → Dependency graph → Dependabot** and inspect both update
   jobs. Use **Check for updates** if an immediate run is needed.
2. Confirm that the npm job discovers all five workspace manifests and finishes
   successfully, and that the Actions job also succeeds. Inspect the job logs
   even if no updates are available.
3. Inspect a generated npm PR: its manifest changes and root `pnpm-lock.yaml`
   must agree, with local workspace links preserved. Run
   `pnpm install --frozen-lockfile` on that branch.
4. Confirm that generated PRs run the existing CI and satisfy the repository's
   review requirements. Dependabot PRs targeting `main` match the existing
   `pull_request` trigger. Before merging, run the shared build, ingest/web lint
   and type checks, and all package tests required by `AGENTS.md`.

Dependabot PRs have the usual restricted bot token and do not receive ordinary
Actions secrets. CI steps that need credentials must use appropriately scoped
Dependabot secrets configured by maintainers; review any such failure in the
generated PR before merging. This configuration adds no auto-merge rule or CI
bypass.
