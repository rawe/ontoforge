# 0017. Postgres isolation: one namespace per ontology; Neo4j capped at one

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Many totally isolated ontologies must share one PostgreSQL database behind the
persistence port, without the isolation ever depending on a filter a query could
forget. The PostgreSQL adapter was namespace-relocatable as written — unqualified DDL,
catalog reads against the current namespace — which made the physical options concrete:
a discriminator column, a namespace per ontology, or a database per ontology.

## Alternatives considered

- **A discriminator column** (`ontology_id` on every table, every query filtered) —
  rejected: isolation by discipline instead of by structure — one forgotten predicate
  leaks another ontology's data — and the deepest inventory problems (server-wide type-key
  uniqueness constraints, key-based cross-table references, server-wide vector indexes)
  would each need reworking rather than dissolving.
- **One database per ontology** — rejected: creating an ontology would mean provisioning
  a database, connection pools per ontology, and cross-database operations for the
  registry; far heavier operationally for no isolation gain over namespaces.
- **For Neo4j, the discriminator rework** (per-ontology label prefixes or properties
  through every Cypher template, the OQL compiler, and the per-label vector indexes) —
  rejected: Community Edition has no namespace equivalent, so Neo4j would pay exactly
  the cost profile rejected for PostgreSQL. Capping the adapter's registry at one
  ontology keeps it honest under the new port at its supported scale; lifting the cap
  is a priced, self-contained follow-up.

## Outcome

The persistence-isolation, PostgreSQL-layout and Neo4j-cap rules in
[../decisions.md](../decisions.md#storage): bound stores plus a separate registry port
above a technology-neutral contract, `ont_<key>` namespaces with `public` as the
server-wide home on PostgreSQL, and the one-ontology cap with the split conformance
tiers for Neo4j.
