# SonarCloud Analysis for Fork Pull Requests

Fork pull requests use two workflows so their build and test commands run without
repository secrets. SonarCloud analysis runs afterward with trusted configuration.
This flow repairs the boundary described in [issue #691](https://github.com/oboapp/oboapp/issues/691).

Fork PRs always generate coverage. Trusted fork scans keep dependency analysis
disabled. The input-based skips and `SONAR_SCA_ENABLED` setting described in
[Sonar analysis in CI](sonar-analysis.md) apply to the same-repository PR job.

## Workflow Boundary

- **SonarCloud Fork PR Coverage** runs on `pull_request` with read-only repository
  access. It installs dependencies, builds shared packages and generates coverage.
- **SonarCloud Fork PR Analysis** runs on `workflow_run` after coverage succeeds.
  Its workflow and helper code come from the default branch. It verifies the
  originating repository, workflow, run, PR and immutable head SHA against GitHub.
- Coverage artifacts remain untrusted data. Analysis accepts only the expected
  files from the verified run and validates paths before preparing scanner input.
- The scanner reads the PR source as data. Scanner settings and TypeScript options
  come from trusted default-branch code. Only coverage runs fork build commands.
- Analysis records the PR head SHA and the SonarCloud analysis ID. It checks the
  quality gate for that analysis before reporting a successful result.

The repository needs its existing `SONAR_TOKEN` secret for the analysis stage.
The coverage stage requires no repository secrets. Keep both stages on hosted
runners and preserve the validation checks when updating actions or workflows.
See [Sonar's split workflow guide](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud#analyzing-fork-pull-requests)
and [GitHub's trusted workflow guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
for the analysis flow and the risks associated with fork code and artifacts.

## Deploy and Validate

1. Merge the repaired workflows and their trusted helpers into the default branch.
   GitHub requires the `workflow_run` consumer to exist there before it can run.
2. Start a fresh fork PR coverage run after deployment, using #690 or a successor.
   Trigger a new PR event, such as a branch update, so the repaired coverage
   workflow is selected. Approve fork workflow execution if GitHub requires it.
3. Confirm coverage completes without secrets and uploads its expected artifact.
4. Open the resulting **SonarCloud Fork PR Analysis** run. Confirm its summary
   identifies the intended PR and the exact current PR head SHA.
5. Confirm the scanner submits an analysis and the summary records its analysis
   ID and actual quality gate result. A successful upload alone is insufficient.
6. Compare the reported revision with the PR head and SonarCloud PR analysis.
   Record the evidence in #691 before marking live validation complete.

Record these values together so later reviewers can verify the same revision:

| Evidence | Required value |
| --- | --- |
| Representative PR | PR URL and immutable head SHA |
| Coverage | Workflow run URL and successful result |
| Analysis | Workflow run URL and SonarCloud analysis ID |
| Quality gate | Actual status, checked for that analysis |
| Revision | SonarCloud revision matching the recorded PR head SHA |

Closed or changed PRs, missing artifacts and inconsistent run metadata must stop
analysis. Start fresh coverage for the current PR revision after correcting the
cause. Investigate a failed quality gate using its reported conditions.

## Initial Evidence

On 15 November 2026, [PR #690](https://github.com/oboapp/oboapp/pull/690) had head
`c2a731c2343a3d11652d9660acbdbee990447d89`. Its [six application CI jobs passed](https://github.com/oboapp/oboapp/actions/runs/43596586027).
The [previous fork analysis failed at checkout](https://github.com/oboapp/oboapp/actions/runs/43596585682/job/132452286614).
An authenticated SonarCloud query returned `NOT_COMPUTED` with no conditions,
and the project had no PR analysis entry for #690. Live validation of the repaired
flow remains pending until the deployment and verification steps above complete.

## Action Update Review

- [#592](https://github.com/oboapp/oboapp/pull/592) updates `setup-node` to v7.
  This repair uses a pinned v7 release in the unprivileged coverage stage.
  Package installation and package caches belong in that stage.
- [#593](https://github.com/oboapp/oboapp/pull/593) updates `checkout` to v7.
  This repair uses a pinned v7 release for fork checkout in `pull_request` and
  trusted default-branch checkout in analysis. Keep `allow-unsafe-pr-checkout`
  disabled. Review the PR's separate generated workflow lock edits through their
  own maintenance process.

[Checkout's guidance](https://github.com/actions/checkout/blob/v7/README.md) and
[setup-node's guidance](https://github.com/actions/setup-node/blob/v7/README.md)
describe the runner requirements and safeguards relevant to these updates.
