# Migration Scripts

Re-runnable (idempotent) migration scripts. Run from the `db/` directory:

```bash
cd db
npx tsx migrate/<script-name>.ts
```

Each script must contain detailed description on purpose and usage.

The date in the filename only serves as a way to sort them. Each one of them should be runnable without negative side effects at any point in time.

## Locality-Sensitive Migrations

Migrations that backfill or derive locality values must receive locality input explicitly from the operator.

- Use script flags such as `--locality=<id>` or `--fallback-locality=<id>`.
- Environment variable alternatives are available for automation (`MIGRATION_LOCALITY`, `MIGRATION_FALLBACK_LOCALITY`).
- Prefer `--dry-run` first to verify the preflight output (target locality and write mode) before running a write execution.
