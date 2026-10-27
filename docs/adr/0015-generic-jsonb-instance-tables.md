# Instance data in two generic jsonb tables

Current behavior: [PostgreSQL instance storage](../storage-adapters.md#how-instance-data-is-stored)

## Context

The PostgreSQL adapter needs a physical mapping for entities and relations whose shape is
defined by a schema that changes at runtime. The choice decides whether a schema change
stays pure data or becomes DDL run against a live database.

## Rejected

- **A table per entity type, generated from the schema.** It gives native columns, types
  and the best filter and sort performance. But every schema change becomes online DDL
  with its locking, failure modes and migration on type change, and transfer and wipe get
  harder. No measured workload needs it; targeted expression indexes close most of the
  performance gap where measurements justify them.
