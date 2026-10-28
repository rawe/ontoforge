# PostgreSQL as the only storage adapter

Current behavior: [Storage adapters](../storage-adapters.md)

## Context

The persistence port admits more than one storage adapter, and every deployment runs
PostgreSQL. A second adapter such as Neo4j needs features of its own (its own search
storage, reserved type keys, a cap of one ontology) and a conformance run of its own.
Building every feature for two databases pulls focus from the features; the aim is to get
each right in one reference implementation first.

## Decision

Ship and maintain PostgreSQL as the only storage adapter while retaining the persistence
port. Keep only the port capabilities the shipped implementation needs; do not retain
an unmaintained Neo4j adapter or speculative branches for a future backend.

## Consequences

Features are developed, documented and tested against one reference implementation
rather than two divergent storage contracts. Other database backends are not promised.
The port remains a relatively cheap seam that isolates services from storage details
and leaves another adapter possible when there is an actual need.

## Rejected

- **Keeping a Neo4j adapter beside PostgreSQL.** Every feature would be designed,
  documented and tested twice for a backend no deployment uses, and that adapter held one
  ontology and no search indices.
- **Keeping the Neo4j adapter unmaintained.** An untested adapter is a broken promise, and
  its branches still cost every change to the port.
- **Keeping the adapter's optional port capabilities for a future adapter.** YAGNI: dead
  branches in the port, the API and the client.
- **Removing the port as well.** The port is a cheap seam that keeps storage details out
  of the services and keeps another database possible.
