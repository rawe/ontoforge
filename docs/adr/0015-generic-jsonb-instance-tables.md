# 0015. Generic jsonb instance tables

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

A PostgreSQL persistence adapter is being built, and PostgreSQL becomes the default
deployment. The adapter needs a physical mapping for instance data — entities and
relations whose shape is defined by a schema that changes at runtime — and the choice
determines whether a schema change stays pure data or becomes DDL the adapter must
execute against a live database.

## Alternatives considered

- **Option A (recommended): two generic tables**, schema-driven, matching the July
  proposal:

  ```sql
  entity(id uuid PK, type_key text NOT NULL, props jsonb NOT NULL DEFAULT '{}',
         embedding vector(D) NULL, created_at timestamptz, updated_at timestamptz)
  relation(id uuid PK, type_key text NOT NULL,
           from_id uuid NOT NULL REFERENCES entity(id),
           to_id uuid NOT NULL REFERENCES entity(id),
           props jsonb NOT NULL DEFAULT '{}', created_at timestamptz, updated_at timestamptz)
  ```

  B-tree on `type_key`, `(type_key, id)`, `from_id`, `to_id`; GIN on `props` only if
  benchmarks demand it, preferring targeted expression indexes per frequently filtered
  property.
  - Pros: schema changes (new entity type, new property) are pure data — no DDL at
    runtime, exactly like Neo4j today; the port's dynamic-schema semantics map 1:1;
    FK constraints give referential integrity Neo4j can't; relation-by-id lookup gets
    indexed (fixes a known Neo4j CE constraint). Cons: jsonb property typing needs the
    `PropertyDef`-driven coercion discipline (already exists above the port); and
    properties live in one jsonb column instead of real per-type columns, so the
    performance a dedicated table would offer — native column types and planner
    statistics, plain per-column indexes, cast-free comparisons and sorts — is
    unavailable; property filters/sorts go through jsonb expressions (e.g.
    `(props->>'age')::numeric`), with targeted expression indexes closing most of
    the gap where measurements justify them.
- **Option B: table-per-entity-type** (DDL generated from the schema).
  - Pros: native columns, native types, best filter/sort performance. Cons: every
    schema mutation becomes online DDL executed by the adapter (locking, failure
    modes, migration-on-type-change); export/import and wipe get harder; massive
    complexity for workloads the plan's benchmarks haven't shown to need it. Rejected
    under KISS unless benchmarks force a revisit.
- **Schema-side objects** (ontologies, types, property defs, scope inclusions, agents,
  saved queries) are plain relational tables in both options — they are small,
  fixed-shape, and relational by nature.
- **Decided (user, 2026-08-15): Option A** — two generic jsonb tables; `uuid` PKs
  (recommended sub-answer, taken as accepted).

## Outcome

Option A — two generic jsonb tables (`entity`, `relation`) with `uuid` primary keys —
is the PostgreSQL adapter's instance mapping. The binding rule lives in
[../decisions.md](../decisions.md#storage); the physical mapping is described in
[../storage-adapters.md](../storage-adapters.md).
