# One PostgreSQL namespace per ontology

Rule: [Storage](../decisions.md#storage)

## Context

Many isolated ontologies share one PostgreSQL database behind the persistence port.
Isolation must never depend on a filter a query could forget. The physical options are a
discriminator column, a namespace per ontology, or a database per ontology.

## Rejected

- **A discriminator column** (`ontology_id` on every table, every query filtered). That is
  isolation by discipline instead of structure: one forgotten predicate leaks another
  ontology's data. Server-wide uniqueness constraints, key-based cross-table references
  and server-wide vector indexes would each need reworking.
- **A database per ontology.** Creating an ontology would mean provisioning a database,
  connection pools per ontology and cross-database registry operations. It is far
  heavier and isolates no better than namespaces.
