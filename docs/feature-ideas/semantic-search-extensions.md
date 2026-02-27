# Semantic Search — Future Extensions

> Feature ideas for extending OntoForge's semantic search capability.
> Each section is a self-contained feature proposal with context, motivation, and scope.

## Current State

OntoForge supports semantic search over entity instances using vector embeddings. The implementation:

- **Embedding at write time** — every entity's string properties are concatenated into a text representation and embedded via Ollama (`nomic-embed-text`, 768 dimensions). The embedding is stored as `_embedding` on the Neo4j node.
- **REST endpoint** — `GET /api/runtime/{ontologyKey}/search/semantic` with parameters: `q` (query), `type` (entity type scope), `limit`, `min_score`.
- **MCP tool** — `semantic_search(query, entity_type_key, limit)` on the runtime MCP server.
- **Vector indexes** — one per entity type, created/dropped automatically with the entity type lifecycle.
- **Graceful degradation** — entities are created normally when the embedding provider is unavailable; they just lack embeddings until re-embedded.
- **Configuration** — opt-in via `EMBEDDING_PROVIDER=ollama` environment variable. When unset, semantic search is disabled entirely.

All string properties on an entity contribute to the embedding. Non-string properties are excluded. There is no per-property control, no property filtering combined with vector search, and no minimum score default for MCP.

---

## Property-Level Filtering on Semantic Search

**Priority: High**

### Problem

The current semantic search is pure vector similarity — there is no way to combine it with property constraints. A query like "find engineers in Berlin" requires two separate calls: a semantic search for "engineers" followed by manual filtering on `location=Berlin`, or an entity list with `filter.location=Berlin` and `q=engineer` (which is substring matching, not semantic).

### Proposal

Add property filter parameters to the semantic search endpoint, matching the existing filter syntax from the entity list endpoint (`filter.{key}` for equality). Filters are applied as Cypher `WHERE` clauses on the vector search results, so the database handles both vector ranking and property constraints in a single query.

**REST**: Add `filter.{key}` query parameters to `GET /search/semantic`, at minimum supporting equality (`filter.location=Berlin`). The Cypher query would add `WHERE` clauses to the `db.index.vector.queryNodes` result set.

**MCP**: Expose as a `filters` dict parameter on the `semantic_search` tool, e.g. `semantic_search(query="engineers", filters={"location": "Berlin"})`.

### Design Considerations

- Start with equality only. Range operators (`__gt`, `__contains`, etc.) add complexity and may not be needed for the initial extension.
- Filters apply after vector search — Neo4j's vector index returns candidates, then `WHERE` clauses narrow them. This means `limit` applies after filtering, so the vector query may need to over-fetch to compensate.
- Reuse the existing `_build_filter_clauses` helper from the runtime service for consistency.

---

## MCP Minimum Score Configuration

**Priority: High**

### Problem

The MCP `semantic_search` tool has no minimum similarity threshold. When an LLM searches for something with low relevance to the dataset, it receives results with poor scores (e.g., 0.3–0.5) that are noise rather than signal. The LLM cannot judge score quality — it sees results and assumes they are relevant.

The REST endpoint has `min_score` as an explicit parameter for human callers who can judge quality. But for MCP, the threshold should be a server-level concern, not an LLM decision.

### Proposal

Add a configured default minimum score that is applied automatically in the MCP tool:

```env
EMBEDDING_MIN_SCORE=0.7    # default threshold for MCP results
```

- The MCP tool applies this threshold without exposing it as a parameter. The LLM only sees results above the quality bar.
- The REST endpoint keeps its explicit `min_score` parameter unchanged — human callers retain full control.
- If no config is set, a sensible default applies (e.g., 0.0 or 0.65 — needs tuning based on `nomic-embed-text` score distribution).

### Design Considerations

- The right threshold depends on the embedding model and dataset. It may need tuning per deployment. A config value is more flexible than a hardcoded default.
- Consider whether the MCP tool should still accept an optional `min_score` override for advanced use cases, or whether server config is the only source.

---

## Embeddable Flag on Property Definitions

**Priority: Medium**

### Problem

Currently all string properties on an entity contribute to the embedding. This works when properties are meaningful text (names, descriptions, bios), but becomes noisy when string properties contain non-semantic data — URLs, serialized JSON, internal IDs, file paths, or machine-generated codes.

### Proposal

Add an `embeddable` boolean flag to `PropertyDefinition` in the schema (default `true` for string properties, ignored for non-string types). When building the text representation for embedding, only include properties where `embeddable=true`.

This is a schema-level change — modifying a property's `embeddable` flag means existing entities need re-embedding to reflect the change. Combine with the batch re-embed feature below.

---

## Frontend Semantic Search UI

**Priority: Medium**

### Problem

Semantic search is only accessible via REST and MCP. The runtime UI has no search interface that uses vector similarity — the existing entity list search (`q` parameter) is substring matching only.

### Proposal

Add a semantic search bar to the runtime dashboard or entity list page. When the user types a natural language query, call the `GET /search/semantic` endpoint and display results ranked by score. Results should show the similarity score, entity type, and key properties.

Cross-type search (no type filter) is the default mode — the UI groups or labels results by entity type. The user can optionally scope to a single type.

---

## Re-Embed on Schema Change

**Priority: Medium**

### Problem

Embeddings are built from property keys and values at write time. If the schema changes — a property key is renamed, a string property is added or removed, or the `embeddable` flag is modified — existing embeddings become stale. They were built with the old schema and no longer reflect the entity's current text representation.

### Proposal

When a schema mutation affects embedding-relevant properties (add/remove/rename string properties, change `embeddable` flag), trigger a background re-embed of all entities of that type. This could be:

- **Automatic** — on schema change, queue a re-embed job for all affected entities.
- **Manual** — surface a "re-embed" action in the UI or API, leaving the decision to the user.

The manual approach is simpler and avoids unexpected bulk operations on schema edits.

---

## Batch Re-Embed Endpoint

**Priority: Medium**

### Problem

When the embedding model or provider changes (e.g., switching from `nomic-embed-text` to a different model), all existing embeddings are invalid — they were generated by a different model and live in a different vector space. There is no way to regenerate all embeddings without manually recreating every entity.

### Proposal

Add an admin endpoint:

```
POST /api/runtime/{ontologyKey}/admin/re-embed
```

Optional parameters: `entity_type_key` (scope to one type), `batch_size` (for large datasets).

This endpoint iterates all entities (or entities of a specific type), rebuilds their text representation from current property values, generates new embeddings, and updates the `_embedding` property. It should be idempotent and resumable.

For MCP, expose as an admin tool: `re_embed(entity_type_key=None)`.

---

## Hybrid Search (Vector + Full-Text)

**Priority: Low**

### Problem

Pure vector search excels at semantic similarity but can miss exact keyword matches. For example, searching for "PROJ-2024" (a project code) may return semantically similar but wrong entities, while a full-text search would match exactly. Conversely, full-text search misses paraphrases and synonyms that vector search handles well.

### Proposal

Combine Neo4j vector indexes with full-text indexes. Score results by a weighted blend of vector similarity and full-text relevance. This is commonly called hybrid or fusion search.

Implementation would require creating Neo4j full-text indexes alongside vector indexes, running both queries, and merging results using reciprocal rank fusion or a similar scoring strategy.

---

## Additional Embedding Providers

**Priority: Low**

### Problem

The current implementation only supports Ollama with `nomic-embed-text`. Production deployments may need hosted providers (OpenAI, Cohere) for reliability, or local alternatives (sentence-transformers) for air-gapped environments.

### Proposal

The embedding provider interface (`EmbeddingProvider` ABC in `core/embedding.py`) is already pluggable. Add implementations for:

- **OpenAI** — `text-embedding-3-small` (1536 dimensions) or `text-embedding-3-large` (3072 dimensions)
- **Sentence-transformers** — local Python inference, no external service needed

Each provider has different dimensions, so the vector index dimensions must match the configured provider. Switching providers requires re-creating vector indexes and re-embedding all entities.
