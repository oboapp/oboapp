---
name: CI Failure Fix
description: Creates a GitHub issue and assigns Copilot to fix it whenever CI fails on main.

on:
  workflow_run:
    workflows: ["CI/CD Pipeline"]
    types: [completed]
    branches: [main]
  skip-bots: [copilot-swe-agent, github-actions]

if: >
  github.event.workflow_run.conclusion != 'success' &&
  github.event.workflow_run.event == 'push'

permissions:
  contents: read
  actions: read
  issues: read
  pull-requests: read

checkout: false

tools:
  github:
    toolsets: [default, actions]

safe-outputs:
  create_issue:
    labels: [ci-failure, copilot]
    assignees: [copilot]
    max: 1
    close-older-issues: true
---

# CI Failure Fix Agent

A CI/CD Pipeline run on `main` has failed. Your task is to investigate the failure and create a GitHub issue so Copilot can fix it.

## Context

- **Workflow run**: __GH_AW_GITHUB_EVENT_WORKFLOW_RUN_HTML_URL__
- **Run ID**: __GH_AW_GITHUB_EVENT_WORKFLOW_RUN_ID__
- **Commit**: `__GH_AW_GITHUB_EVENT_WORKFLOW_RUN_HEAD_SHA__`
- **Conclusion**: `__GH_AW_GITHUB_EVENT_WORKFLOW_RUN_CONCLUSION__`

## Instructions

1. Use the GitHub `actions` tools to fetch the jobs and logs for the failed workflow run (run ID: `__GH_AW_GITHUB_EVENT_WORKFLOW_RUN_ID__`).
2. Identify which jobs failed and what errors occurred. Look at the log output for each failed step.
3. Summarize the root cause concisely.
4. Create **one** GitHub issue (via `create_issue` safe-output) with:
   - **Title**: `[CI Fix] <short description of the failure> on main (<first 7 chars of commit SHA>)`
   - **Body** containing:
     - A brief summary of what failed and why.
     - The relevant log snippets (trimmed to the most useful lines, wrapped in a code block).
     - A link to the workflow run.
     - A clear task description for Copilot:
       1. Read the failure details above and identify the root cause.
       2. Implement the minimal fix (follow coding conventions in `AGENTS.md`).
       3. Ensure `pnpm lint:all` and `pnpm test:all` pass from the repository root after the fix.
       4. Ensure TypeScript type-checking passes in all relevant workspaces (`pnpm --dir <workspace> exec tsc --noEmit`).
       5. Open a pull request targeting `main` with the fix.
