# 0010. Contract de-leak: `query`/`oql` naming, export format 3.0

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

With storage exchangeable (0008) and the query language specified as OntoForge's own
(0009), the public surface still carried Neo4j and Cypher vocabulary — in field names,
tool names, error messages, and product positioning. Vendor vocabulary in a contract whose
backend is exchangeable is a leak.

## Decision

No Neo4j or Cypher vocabulary anywhere in the public surface:

- the query endpoint takes `query`;
- saved-query steps use type `oql` with field `oql`;
- the AI query response returns `query`;
- the MCP tool is `execute_query`;
- error messages name no vendor.

The export format is 3.0. No aliases for the previous `cypher` spelling are kept on any
surface. "Neo4j-native" is retired from product positioning in favour of graph-native with
exchangeable storage.

## Consequences

The rename is a breaking contract change, absorbed in one step: alias removal was safe
because it happened before the first release carrying this contract, and nothing outside
the project consumed it.

Alias removal was approved 2026-07-27.

The format version has since moved to 4.0 — the multi-ontology hard cut
([0018](0018-multi-ontology-hard-cut.md)) renamed the top-level `ontologies[]` field to
`lenses[]`, an incompatible payload-shape change. The version policy is unchanged
([../decisions.md](../decisions.md#scope)).

## Alternatives considered

- **Renaming the saved-query step field `oql` to `query`** — rejected, because `query`
  already carries the search text of a `semantic_search` step, so the name would mean two
  different things within the same step vocabulary.
