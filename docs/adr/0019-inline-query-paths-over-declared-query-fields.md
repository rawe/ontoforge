# 0019. Inline query paths in the filter language, not pre-declared schema fields

- **Status:** Accepted
- **Date:** 2026-09-01

## Context

A structured filter (`filter.<key>`) could only name a property of the type being
listed; filtering by anything on the other side of a relation meant OQL. Modelers
under that pressure flatten relations into properties — a status entity becomes a
status string — so the graph stops being the single source of truth. One relation hop
had to become filterable without a query language, and the question was where the hop
is described: in the schema, or in the filter key itself.

## Alternatives considered

- **Query fields declared on the schema** — a new schema object owned by an entity
  type, carrying key, display name, description, relation type, direction, property
  source and property key; managed over modeling REST and MCP, exported and imported,
  lens-scoped, joined to the cascade protocol so that deleting a referenced relation
  type or property deletes the field with consent — rejected: a fourth schema-object
  kind with its own routes, tools, transfer shape and format version bump, its own
  key namespace shared with properties, and a cascade extension, all to describe a
  fact the schema already states — that the relation type exists and has these
  endpoints. Every declared field would duplicate a derivable path; the declaration
  is a second source of truth for the relation it names. And each relation is only
  filterable once someone declares it, where the goal was that every relation is
  queryable the moment it exists.
- **Named query fields as a naming layer over inline paths** — the same declared
  object, but backed by a path string parsed by the filter parser, so that limited
  language-model clients filter by a flat, described key without reading the graph —
  deferred, not rejected: it adds only names and descriptions, so it can be layered on
  top of inline paths later if limited clients demonstrably struggle to compose paths
  from schema discovery. Building it first would decide that question before there is
  evidence. The gate and the shape stay recorded outside the documentation until then.
- **OQL only** — the escape hatch already existed and covers every hop count — rejected
  as the sole answer: the one-hop case is the one that drives modelers to flatten
  relations, and a full query language is the wrong tool for the client that just
  wants a list filtered by a related entity's property.

## Outcome

The one-relation and existential rules in [../decisions.md](../decisions.md#behaviour)
and the resolved-above-the-port rule in [../decisions.md](../decisions.md#storage).
