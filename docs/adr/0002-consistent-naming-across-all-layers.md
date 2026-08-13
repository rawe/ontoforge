# 0002. Consistent naming across all layers

- **Status:** Accepted

## Context

The same two concerns appear at several layers — backend modules, API routes, store
layers — and each layer could plausibly name them differently. Synonyms across layers make
it harder to follow one concept from a route down to its storage.

## Decision

Use "modeling" and "runtime" consistently for backend modules, API routes, and store
layers, with no synonyms. The backend application is named `ontoforge-server`.

## Consequences

The rule governs code and the API surface only. The frontend is free to use its own
product names for its surfaces, and does: it names its schema-design surface *Studio* and
its canvas *Explorer* (see `docs/runtime-ui-architecture.md`).
