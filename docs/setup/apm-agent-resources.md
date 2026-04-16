# APM Agent Resources

[APM (Agent Package Manager)](https://microsoft.github.io/apm/) deploys agent primitives — instructions, prompts, agents, and skills — from the canonical `agent-context/` source tree into the target directories that AI tools read natively (`.github/` for Copilot, `.claude/` for Claude Code).

## What APM Does Here

- **Source of truth:** `agent-context/.apm/` contains all agent primitive files.
- **Deployment:** `apm install` copies primitives to `.github/` (Copilot) and `.claude/` (Claude Code). No compilation step — file content is unchanged, though naming conventions and target folders differ by primitive type.
- **Target scoping:** Only `copilot` and `claude` targets are configured in this repo.
- **CI enforcement:** The `Dependency Check` job runs `apm install` and fails if deployed files diverge from what is committed.

## Editing Agent Resources

Edit files in `agent-context/.apm/` first, then run `pnpm apm:install` to deploy. The `.github/` and `.claude/` primitive files are generated outputs — manual edits there will be overwritten on the next install.

Treat `agent-context/.apm/` as the canonical source and the target directories as generated artifacts. APM handles tool-specific naming and placement rules during deployment.

## Local Setup

### Install APM

**Windows (PowerShell):**
```powershell
irm https://aka.ms/apm-windows | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://aka.ms/apm-linux | bash
```

### Deploy After Editing

After editing any file in `agent-context/.apm/`, deploy and commit:

```bash
pnpm apm:install   # deploys to .github/ and .claude/
```

Commit `agent-context/` changes together with the updated target directories.

## CI Verification

The `Dependency Check` CI job runs `apm install --force` and checks whether `.github/` or `.claude/` primitive files differ from what is committed. If it fails, run `pnpm apm:install` locally and commit the result.

