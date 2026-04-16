---
applyTo: "docs/**"
description: Documentation guidelines — write concise, behavior-focused docs for QA and admin audiences, not developers.
---

# Documentation Guidelines

**Target Audience**: QA personnel, system administrators, technical stakeholders — NOT developers (they read code).

## Keep Docs Concise

- Focus on behavior and operational knowledge
- Omit implementation details (algorithms, code patterns, TypeScript interfaces)
- Document "what happens" and "why", not "how it works"

## Describe Concepts, Not Specifics

- **NEVER enumerate items that change over time** (e.g., listing all crawler names, all source IDs, all migration scripts). These go stale when items are added, removed, or renamed.
- **NEVER reference implementation-specific source code file paths in conceptual docs.** Code is self-documenting. Operational commands/paths that users must run are acceptable.
- **NEVER embed large or implementation-specific code snippets** in conceptual docs. They duplicate logic and become outdated. Minimal operational command examples are acceptable.
- Describe categories of things instead of listing every instance (e.g., "emergent crawlers" instead of listing each one).
- A single example to illustrate a concept is fine; an exhaustive list is not.

## Avoid Duplication

- **NEVER duplicate big chunks of documentation** across multiple files.
- **ALWAYS link to related content** instead of repeating text.
- **ALWAYS aim for short, readable documentation** (prefer 50–100 lines over 200+).
- Maintain single source of truth for each topic.

## When to Document

- New features affecting QA testing or system operations
- Configuration changes (environment variables, constants)
- Edge cases and error conditions
- External API integrations
- Pipeline architecture changes
