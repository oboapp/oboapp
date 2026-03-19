# LLM Prompt Evaluation

AI prompts are evaluated with [promptfoo](https://promptfoo.dev) — a framework that runs prompts against fixture inputs and validates outputs using custom assertions backed by the same Zod schemas used in production.

## When to Run

Run evals **before merging any changes** to:

- Prompt files (`ingest/prompts/*.md`)
- AI service schemas (`ingest/lib/*.schema.ts`)
- AI service logic (`ingest/lib/ai-service.ts`)

## Commands

```bash
cd ingest

pnpm promptfoo             # All 4 prompt evals
pnpm promptfoo:filter      # Filter & Split only
pnpm promptfoo:categorize  # Categorize only
pnpm promptfoo:locations   # Extract Locations only
pnpm promptfoo:verify      # Verify Event Match only
pnpm promptfoo:redteam     # Adversarial / red team inputs
pnpm promptfoo:view        # Open results dashboard in browser
```

Requires `GOOGLE_AI_API_KEY` in `ingest/.env.local`.

## Evaluated Prompts

| Prompt | Eval Config | What It Tests |
|--------|-------------|---------------|
| Filter & Split | `evals/filter-split.yaml` | Relevance detection, message splitting, link stripping, unreadable detection |
| Categorize | `evals/categorize.yaml` | Category classification |
| Extract Locations | `evals/extract-locations.yaml` | Pins, streets, bus stops, cadastral properties |
| Verify Event Match | `evals/verify-event-match.yaml` | Same-event vs. different-event judgements |

## Assertions

Each eval uses two types of assertions:

1. **Schema validation** — Zod schemas from production code verify that the output JSON is structurally correct (e.g. `validateFilterSplitSchema`, `validateExtractLocationsSchema`)
2. **Behavioral assertions** — Custom functions check expected semantics (e.g. `assertIrrelevant`, `assertMessageCount`, `assertNoLinks`)

All assertion functions are in `ingest/evals/assertions.ts`.

## Red Team Testing

The red team eval (`evals/redteam.yaml`) tests prompt robustness against adversarial inputs:

- Prompt injection attempts
- Jailbreak inputs
- Off-topic steering

Prompts pass when they consistently reject adversarial inputs without leaking instructions or producing unstructured output.

## Fixtures

Test inputs are Markdown files in `ingest/__mocks__/fixtures/sources/`. Each file represents a realistic source document fed to the LLM.

Add new fixture files to cover new edge cases or to reproduce regression scenarios.

## Related

- [External API Mocks](../features/external-api-mocks.md)
- [Message Filtering](../features/message-filtering.md)
- [QA Overview](overview.md)
