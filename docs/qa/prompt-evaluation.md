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

Requires `GOOGLE_AI_API_KEY` and `GOOGLE_AI_MODEL` in `ingest/.env.local`.

## Evaluated Prompts

Each stage of the AI pipeline has its own eval config in `ingest/evals/`. The evals cover all prompts involved in message processing — relevance detection, categorization, location extraction, and event-match verification.

## Assertions

Each eval uses two types of assertions:

1. **Schema validation** — verifies that the output JSON is structurally correct against the same Zod schemas used in production
2. **Behavioral assertions** — custom functions check expected semantics (e.g. a message is marked as irrelevant, a specific number of messages are produced, no links appear in the output)

Assertions are defined alongside the eval configs in `ingest/evals/`.

## Red Team Testing

A separate red team eval tests prompt robustness against adversarial inputs such as prompt injection, jailbreak attempts, and off-topic steering. Prompts pass when they consistently reject adversarial inputs without leaking instructions or producing unstructured output.

## Fixtures

Test inputs are Markdown files representing realistic source documents fed to the LLM. They live in `ingest/__mocks__/fixtures/`. Add new fixture files to cover new edge cases or to reproduce regression scenarios.

## Related

- [External API Mocks](../features/external-api-mocks.md)
- [Message Filtering](../features/message-filtering.md)
- [QA Overview](overview.md)
