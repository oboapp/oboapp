# Sonar analysis in CI

Main-branch pushes always run Sonar. Same-repository pull requests run it when
changed files affect analysis inputs. The decision uses the full diff from the
merge base to the PR head, including deleted files and both sides of renames.
The PR author does not affect this decision.

## Relevant inputs

| Changed paths | Behavior |
| --- | --- |
| Content below `sonar.sources` and `sonar.tests` in `sonar-project.properties` | Run. These currently cover `api/src`, `db/src`, `ingest`, `shared/src` and `web`. Tests, mocks and fixture assets count because they can affect coverage. Generated `dist`, `coverage`, `node_modules` and `.next` directories are ignored. |
| Package-level `tsconfig*.json` and `vitest.*` files | Run, including configurations outside the source roots. |
| Tests, test directories, mocks and fixtures in workspace packages | Run even outside Sonar source roots because they can change coverage. |
| `sonar-project.properties` and `.github/scripts/sonar-*` | Run when analysis settings or the input filter change. |
| The `sonarcloud` job or top-level settings in `.github/workflows/ci.yml` | Run when scanner setup, coverage generation, permissions, environment or other analysis inputs change. Edits confined to other jobs skip. |
| Root and workspace `package.json` files | Dependency version fields and `pnpm.overrides` can skip. Changes to scripts, exports, module settings or other fields run. Added, deleted or invalid manifests run. Nested fixture manifests count as test inputs. |
| `pnpm-lock.yaml` | Skip while Sonar dependency analysis is inactive; run when it is enabled or its state is unknown. |
| `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `patches/` | Run because resolution settings or patched code can affect analysis and coverage. |
| Other workflows, repository documentation and files outside these inputs | Skip. |

The filter treats tracked source-root content conservatively, so test fixture
changes still run even when Sonar excludes them from source-code checks.
It fails on unreadable Git history or analysis configuration.

## Dependency analysis

Sonar Software Composition Analysis (SCA) is inactive for this project, verified
on 15 November 2026. The organization uses the Free plan, and the
[successful main scan](https://github.com/oboapp/oboapp/actions/runs/43589513314/job/132432000719)
records `Dependency analysis skipped`.
[SCA requires an Advanced Security subscription](https://docs.sonarsource.com/sonarqube-cloud/advanced-security/analyzing-projects-for-dependencies-sca).
The inherited `sonar.sca.enabled=true` setting alone does not confirm entitlement.

Before enabling Advanced Security, set the GitHub Actions repository variable
`SONAR_SCA_ENABLED` to `true`. This preserves scans, coverage and quality-gate
checks for dependency-only PRs. The verified default is `false`; any other
nonempty value is treated as unknown and keeps dependency scans enabled.

Skipping Sonar leaves the existing application tests, builds, circular dependency
checks and Dependabot vulnerability alerts in place. Dependency updates still
need their applicable checks.

## Results and required checks

The Actions job named `SonarCloud` remains present for eligible PRs. When no
relevant inputs change, it succeeds and records the reason in its job summary.
It skips dependency installation, dedicated Sonar coverage and the scanner.
Scans that run wait up to 600 seconds for the actual quality gate; a failed gate
or timeout fails the job.

The upstream main ruleset had no required status checks when this was verified.
If adding required checks, require the GitHub Actions `SonarCloud` job. Sonar's
separate `SonarCloud Code Analysis` check is created only when analysis runs,
so requiring it would leave intentionally skipped PRs waiting. Remove that
external check from required checks in forks that currently require it.

## Credentials and scope

Relevant scans require `SONAR_TOKEN` as an Actions repository secret. Relevant
Dependabot PRs also need a Dependabot secret with that name, since they receive
Dependabot secrets. The workflow reports a missing credential before generating
coverage. Dependency-only and unrelated workflow PRs that skip need no token.

This policy applies to the existing same-repository PR job. Fork execution safety
and the separate fork workflow are tracked in
[issue 691](https://github.com/oboapp/oboapp/issues/691).

Run the input-filter regression tests with:

```sh
node --test .github/scripts/sonar-inputs.test.mjs
```
