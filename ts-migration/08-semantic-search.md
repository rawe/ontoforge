# Session 08 — Embeddings, vector indexes, semantic search, rebuild

**Goal:** the embedding provider, the complete vector-index lifecycle, write-path
embedding (entities + chunks), the semantic search route/tool, and the streaming rebuild
operation. `/features` starts reporting `semanticSearch: true` when configured.

**Prerequisites:** 01–07. Needs a local embedding provider for integration tests
(Ollama with `nomic-embed-text`, as the Python integration suite uses).

**Normative:** `docs/capabilities/search.md` (entire document — composition rules,
scopes, RRF, matchedVia, min_score, filters-on-search, rebuild, width drift),
`docs/capabilities/documents.md#embedding-behaviour` (chunk vector reuse),
`docs/storage-adapters.md` ("Search", "Vector index lifecycle", "Vector index width
reconciliation", "Embedding maintenance", engine constraints incl. the 32766-byte
indexed-string limit), `docs/decisions.md#behaviour` (warn-don't-repair),
`docs/architecture.md#startup` (steps 3 and 5 become real).

**Reference (Python):** `core/embedding.py`, `runtime/embedding.py`,
`runtime/service.py` (search + embedding portions), `adapters/neo4j/ddl.py` (vector
index DDL, width reconciliation, failed-index drop), `runtime_queries.py` (vector
search), `modeling/service.py` (rebuild-embeddings streaming, index hooks),
`mcp/runtime.py` (`semantic_search`).

## Scope

**In:**
- **Provider abstraction:** `ollama` and `openai` providers (OpenAI-compatible embedding
  endpoints; `EMBEDDING_*` config incl. optional `EMBEDDING_DIMENSIONS`); initialized at
  startup; absent → everything here disabled and `/features` stays false. Failed
  embedding calls are logged, never fail the write.
- **Entity embedding composition** — port the rules exactly: type key prefix, `string`
  properties only (never document/numeric/temporal), `key=value` in schema declaration
  order, skip empty, **full schema not the lens**, 30 000-char cap, deterministic.
  Recompute on create always; on update only when a string property is touched, from
  the merged post-update state.
- **Chunk sync goes live:** the session-06 gate opens — document writes re-chunk and
  embed with reuse-by-content (old text→vector map consulted before calling the
  provider).
- **Vector index lifecycle:** fill the session-02 seams — per-entity-type index (with
  the type's non-document property keys as in-index filterables, rebuilt when the
  property set changes), cross-type `_Entity` index, per-document-property chunk index
  (created with the property, dropped with it or its type), saved-query index ensure
  (used in 09). All no-ops without a provider. Cosine similarity. Failed-state indexes
  dropped before recreate. **Width reconciliation:** compare before every create; on
  startup report mismatches (identifying indexes by what they cover, never physical
  names) and change nothing; on rebuild drop and recreate.
- **Indexed-string size limit:** with a provider configured, entity writes carrying a
  string value over the engine limit are rejected as a validation error naming the
  property, not the engine; document values exempt.
- **Semantic search** `GET /search/semantic`: `q`, optional `type` (cross-type when
  omitted — hits carry `_entityTypeKey`; over-fetch-and-discard cap per docs),
  `searchIn` entities/documents/all (default all), `limit` 1–100 default 10,
  `min_score` (snake_case on the wire — documented irregularity) applied to raw
  similarity per ranking **before** fusion, `snippets` default true, `fields`
  projection, `filter.*` (require a type; reject `__contains`; document hits filtered
  after parent resolution). RRF fusion `1/(60+rank)`; passage hits deduped to parent —
  best passage wins and supplies `matchedVia`; document match info wins over entity
  when both rank. `matchedVia` fields exactly per docs. Without a provider:
  `422 VALIDATION_ERROR` + `details.code: "FEATURE_DISABLED"`.
- **Rebuild** `POST /api/model/rebuild-embeddings`: refused without a provider; NDJSON
  progress stream (per-item records with type key / count / group total, then the final
  summary with per-type processed/failed and overall totals — copy record shapes from
  the Python service); ensures/recreates indexes at the provider width, re-embeds every
  entity, re-chunks/re-embeds every document value, re-embeds saved-query descriptions
  (no-op list until 09).
- MCP: `semantic_search` — exposes scope, snippets, filters, projection, **no
  min_score** (documented difference).

**Out:** saved-query search (09), AI (11).

## Test plan

Port `backend/tests/test_embedding_provider.py`, `test_semantic_search_service.py`,
`test_document_search_service.py`, `tests/integration/test_semantic_search.py`,
`test_vector_index_drift.py`:

- **Unit (no provider needed):** composition text for every rule above; RRF ordering and
  the fused-score-vs-similarity distinction; matchedVia selection when both rankings hit;
  min_score pre-fusion semantics; filter rejections (no type, `__contains`); provider-
  absent gives FEATURE_DISABLED; write-path embed-trigger decisions (string touched vs
  not).
- **Integration (Ollama):** end-to-end entity/document/fused search with seeded data;
  chunk vector reuse (edit a document, assert unchanged chunks skipped via call
  counting); width drift — create index at one width, reconfigure, boot (warning, no
  repair), rebuild (repaired); NDJSON stream shape; oversized indexed string rejected.
- **MCP:** `semantic_search` round-trip.

## Definition of done

Frontend command palette and search surfaces work with embeddings configured; `/features`
truthful in both states. All tests + regression green. Overview updated.
