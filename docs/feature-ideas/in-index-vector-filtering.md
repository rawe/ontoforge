# In-Index Vector Filtering (Neo4j 2026)

> Replace the over-fetch + post-filter strategy for semantic search with Neo4j's native in-index filtered vector search, available since Neo4j 2026.02.

## Problem

Semantic search property filtering currently works by over-fetching from the vector index (`min(limit * 5, 500)` candidates via `db.index.vector.queryNodes`), then applying `WHERE` clauses to narrow results. This has two weaknesses:

- **Recall loss on selective filters.** If only 1% of entities match the filter, the 500-candidate window may contain few or no matches — the user gets fewer results than requested, or misses relevant entities entirely.
- **Wasted work.** The vector index retrieves candidates that are immediately discarded. The over-fetch multiplier (5x) is a heuristic with no guarantee of correctness.

Both issues worsen as datasets grow and filters become more selective.

## What Changed in Neo4j

Neo4j 2026.01 (preview) / 2026.02 (GA) introduced the `SEARCH` clause under Cypher 25. It supports **in-index WHERE filtering** — property predicates are evaluated during HNSW graph traversal, not after. The index keeps searching until it finds k results that satisfy the predicate, eliminating the over-fetch guessing game.

**Available in Community Edition.** The `SEARCH` clause, in-index `WHERE`, and the `WITH` clause on index creation all work on Community, Enterprise, and Aura. The only Community restriction is that embeddings must remain stored as `LIST<FLOAT>` (the native `VECTOR` data type requires Enterprise block format) — which is what OntoForge already uses.

## Proposal

Upgrade Neo4j from `5` to `2026` and migrate the semantic search query from `db.index.vector.queryNodes` to the `SEARCH` clause with in-index filtering.

### Index Creation — Before and After

**Current (Neo4j 5):**

```cypher
CREATE VECTOR INDEX {type}_embedding IF NOT EXISTS
FOR (n:{Label}) ON (n._embedding)
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}}
```

**Proposed (Neo4j 2026):**

```cypher
CREATE VECTOR INDEX {type}_embedding IF NOT EXISTS
FOR (n:{Label}) ON (n._embedding)
WITH [n.prop1, n.prop2, ...]
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}}
```

The `WITH [...]` clause stores specified property values alongside vectors in the index, enabling in-index filtering. Which properties to include must be determined from the schema — all properties that could appear in `filter.*` parameters.

### Search Query — Before and After

**Current:**

```cypher
CALL db.index.vector.queryNodes($index_name, $vector_limit, $query_embedding)
YIELD node, score
WHERE node.location = $filter_location AND node.experience >= $filter_experience
RETURN node {.*} AS entity, score
ORDER BY score DESC
LIMIT $limit
```

**Proposed:**

```cypher
MATCH (n:{Label})
SEARCH n IN (
  VECTOR INDEX {type}_embedding
  FOR $query_embedding
  WHERE n.location = $filter_location AND n.experience >= $filter_experience
  LIMIT $limit
) SCORE AS score
RETURN n {.*} AS entity, score
```

The over-fetch logic (`min(limit * 5, 500)`) and the separate `vector_limit` parameter become unnecessary.

### In-Index WHERE Limitations

The in-index `WHERE` supports a subset of predicates:

| Supported | Not Supported |
|---|---|
| `=`, `>`, `<`, `>=`, `<=` | `<>` (not-equal) |
| `AND` | `OR` |
| Boolean `NOT` | `NOT` (general) |
| Range predicates | `IN`, `STARTS WITH`, `CONTAINS`, `ENDS WITH` |

The existing `__contains` filter operator uses `toLower(toString(node.{key})) CONTAINS toLower(...)`, which is **not** supported in-index. It must remain a post-filter `WHERE` clause outside the `SEARCH` block.

### Hybrid Approach — Open Question

A hybrid strategy (in-index `WHERE` for supported operators, post-filter `WHERE` for `__contains`) is technically possible:

```cypher
MATCH (n:{Label})
SEARCH n IN (
  VECTOR INDEX {type}_embedding
  FOR $query_embedding
  WHERE n.year >= $filter_year          -- in-index (fast)
  LIMIT $over_limit                     -- slight over-fetch for post-filter
) SCORE AS score
WHERE toLower(toString(n.name)) CONTAINS toLower($filter_name)  -- post-filter
RETURN n {.*} AS entity, score
LIMIT $limit
```

**However, it reintroduces the over-fetch complexity we are trying to eliminate.** The hybrid path means maintaining two filter categories (in-index-eligible vs. post-filter-only), partitioning logic in the service layer, and keeping the over-fetch heuristic alive for `__contains` queries. This adds significant implementation and maintenance complexity for a single operator.

**Decision needed at implementation time:** Consider dropping the `__contains` filter operator from semantic search entirely and relying only on operators that the in-index `WHERE` supports (`=`, `>`, `<`, `>=`, `<=`). This would allow removing all over-fetch logic and fully delegating filtering to Neo4j with no fallback path. The `__contains` operator would remain available on the entity list endpoint (which does not use vector search) where it continues to work without constraints.

If `__contains` on semantic search proves essential for real use cases, the hybrid path can be revisited — but the default position should be to avoid it in favor of a single, clean in-index filtering strategy.

## Changes Required

1. **`docker-compose.yml`** — Update image from `neo4j:5` to `neo4j:2026` (all three compose files).
2. **`core/database.py`** — Modify `create_vector_index` to accept a list of metadata properties and emit the `WITH [...]` clause.
3. **`runtime/service.py`** — Remove the over-fetch multiplier logic. If `__contains` is dropped from semantic search, remove the filter partitioning entirely — all filters go directly to the in-index `WHERE`.
4. **`runtime/repository.py`** — Rewrite `semantic_search` to emit the `SEARCH` clause with in-index `WHERE`.
5. **Schema-driven index metadata** — When an entity type is created or updated, determine which properties to include in `WITH [...]`. Strategy options:
   - All non-string properties + all properties used in known filter patterns.
   - All properties (simpler, but may bloat the index).
   - Only properties explicitly marked as filterable in the schema (requires a schema extension).
6. **Index migration** — Existing vector indexes must be dropped and recreated with `WITH [...]` to add metadata properties. Embeddings on nodes are preserved; only the index structure changes. Add a migration path or document a manual re-index step.
7. **Cypher version** — Ensure the Neo4j driver sends queries as Cypher 25. In Neo4j 2026.02+, Cypher 25 is the default for new databases.

## Design Considerations

- **Backward compatibility.** The REST and MCP API surfaces do not change. This is a purely internal optimization — callers continue using `filter.*` parameters as before.
- **Index size.** Storing metadata properties in the vector index increases index size. For ontologies with many properties per entity type, consider limiting `WITH [...]` to frequently filtered properties rather than all properties.
- **`min_score` filtering.** Currently applied in Python after the Neo4j query. With the `SEARCH` clause this could remain as-is (post-filter in Python) since Neo4j's `SEARCH` does not support a minimum score predicate.
- **Testing.** The Neo4j 5 → 2026 upgrade may surface breaking changes in Cypher syntax or driver behavior beyond vector search. Run the full test suite against Neo4j 2026 before committing.

## References

- [Vector search with filters in Neo4j v2026.01 (Preview)](https://neo4j.com/blog/genai/vector-search-with-filters-in-neo4j-v2026-01-preview/) — announcement blog post
- [SEARCH clause — Cypher Manual](https://neo4j.com/docs/cypher-manual/current/clauses/search/) — syntax and semantics
- [Vector indexes — Cypher Manual](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/vector-indexes/) — index creation with `WITH` clause
- [VECTOR data type — Cypher Manual](https://neo4j.com/docs/cypher-manual/current/values-and-types/vector/) — Enterprise-only native type (not required)
- [Changes in Neo4j 2025–2026](https://neo4j.com/docs/operations-manual/current/changes-2025-2026/) — migration notes
