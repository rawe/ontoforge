# One PostgreSQL namespace per ontology

Current behavior: [Ontology isolation in PostgreSQL](../storage-adapters/postgresql.md#how-ontologies-are-isolated)

## Context

Many isolated ontologies share one PostgreSQL database behind the persistence port.
Isolation must never depend on a filter a query could forget. The physical options are a
discriminator column, a namespace per ontology, or a database per ontology.

## Decision

Keep every ontology in its own PostgreSQL namespace inside the shared ontology
database. Reserve the public namespace for server-wide data.

## Consequences

Isolation is structural rather than dependent on a discriminator predicate in every
query. Ontologies share database provisioning instead of requiring separate databases,
connection pools and cross-database registry operations. Changing this mapping would
affect physical storage, references, uniqueness and index management.

## Rejected

- **A discriminator column** (`ontology_id` on every table, every query filtered). That is
  isolation by discipline instead of structure: one forgotten predicate leaks another
  ontology's data. Server-wide uniqueness constraints, key-based cross-table references
  and server-wide vector indexes would each need reworking.
- **A database per ontology.** Creating an ontology would mean provisioning a database,
  connection pools per ontology and cross-database registry operations. It is far
  heavier and isolates no better than namespaces.
