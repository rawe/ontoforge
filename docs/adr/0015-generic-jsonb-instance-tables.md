# Instance data in two generic jsonb tables

Current behavior: [PostgreSQL instance storage](../storage-adapters/postgresql.md#how-instance-data-is-stored)

## Context

The PostgreSQL adapter needs a physical mapping for entities and relations whose shape is
defined by a schema that changes at runtime. The choice decides whether a schema change
stays pure data or becomes DDL run against a live database.

## Decision

The PostgreSQL adapter stores instances in two generic tables, one for entities and
one for relations, with their schema-defined properties in JSONB rather than generating
a table and native columns for each type.

## Consequences

An ontology schema change stays data rather than online instance-table DDL, avoiding
per-type locking and type-migration work. The mapping gives up the native columns and
best filter/sort performance of per-type tables; targeted expression indexes can close
measured gaps without changing the generic model.

## Rejected

- **A table per entity type, generated from the schema.** It gives native columns, types
  and the best filter and sort performance. But every schema change becomes online DDL
  with its locking, failure modes and migration on type change, and transfer and wipe get
  harder. No measured workload needs it; targeted expression indexes close most of the
  performance gap where measurements justify them.
