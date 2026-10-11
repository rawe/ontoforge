# 0025. PostgreSQL as the only storage adapter

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Two adapters sat behind the persistence port: PostgreSQL and Neo4j. Every deployment ran
PostgreSQL. The Neo4j adapter needed features of its own — its own search storage in place
of search indices, reserved type keys against label collisions, a cap of one ontology —
and a conformance run of its own.

Many new features are coming, the change-set work first among them. Building each one
for two databases is not feasible: the cross-database caveats and problems would pull the
focus away from the features themselves, and the database abstraction is not the main
concern now. The goal is to get each feature right in one reference implementation,
PostgreSQL, first, and only later to see how it could be carried over to other databases,
if at all.

## Alternatives considered

- **Keep both adapters** — rejected: every feature would be designed, documented and
  tested twice, with the caveats of two databases in every design, for a backend no
  deployment uses. Neo4j already lagged behind, with one ontology and no search indices.
- **Keep the Neo4j adapter but stop maintaining it** — rejected: an untested adapter is
  a broken promise, and its branches still cost every change to the port.
- **Remove only the adapter, keep its optional port capabilities for a future adapter** —
  rejected as YAGNI: dead branches in the port, the API and the client for an adapter
  that does not exist.
- **Remove the port as well** — rejected: the port is a cheap seam that keeps storage
  details out of the services, and it keeps the door open for the later step of carrying
  features over to another database.

## Outcome

The PostgreSQL-only rule in [decisions.md](../decisions.md#storage).
