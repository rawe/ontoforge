# Query paths inline in the filter key, not declared in the schema

Status: Accepted

Current behavior: [Query paths](../capabilities/instance-data.md#query-paths)

## Context

A structured filter that can name only a property of the listed type leaves OQL as the
only way to filter across a relation. Modelers under that pressure flatten relations into
properties, and the graph stops being the single source of truth. The question is whether
a filterable hop is described in the schema or in the filter key itself.

## Decision

Express a filterable one-hop path inline in the entity-list or search filter key,
resolved against the lens-scoped schema at query time. Do not create declared query-field
objects in the ontology schema. Use OQL for longer general query patterns.

## Consequences

A relation becomes filterable when it exists, without another declaration, its own
routes/tools, transfer representation or cascade lifecycle. Simple related-property
filters do not require a full query language or encourage flattening relations into
properties. The supported inline path remains deliberately limited to one hop.

## Rejected

- **Query fields declared on the schema**: a schema object per entity type naming
  relation type, direction, property source and property key. It needs its own routes,
  tools, transfer shape and cascade, all to restate a path the schema already implies. It
  is a second source of truth for the relation, and a relation would become filterable
  only once someone declared it.
- **OQL as the only answer.** The one-hop case is the one that drives modelers to flatten
  relations, and a full query language is the wrong tool for a client that only wants a
  list filtered by a related entity's property.
