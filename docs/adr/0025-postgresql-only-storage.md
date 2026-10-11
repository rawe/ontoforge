# PostgreSQL as the only storage adapter

Rule: [Storage](../decisions.md#storage)

## Context

The persistence port admits more than one storage adapter, and every deployment runs
PostgreSQL. A second adapter such as Neo4j needs features of its own (its own search
storage, reserved type keys, a cap of one ontology) and a conformance run of its own.
Building every feature for two databases pulls focus from the features; the aim is to get
each right in one reference implementation first.

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
