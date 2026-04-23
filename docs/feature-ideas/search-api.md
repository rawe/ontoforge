# Search API Structure

> Proposal for the runtime read surface: how deterministic listing, scored search, and power-user queries are cut into endpoints. Strategy-agnostic endpoints; strategy choices live in a `search_config` payload.

## Goals

- Separate concerns by caller intent, not by retrieval strategy.
- Keep REST and MCP as independent surfaces, designed for their audiences.
- Let retrieval strategies (semantic, BM25, hybrid, rerankers) evolve without breaking endpoint contracts.
- Admit that deterministic listing and scored search are different contracts, and stop forcing one envelope across both.

## Non-goals

- Replacing saved-query pipelines as the composition primitive.
- Replacing Cypher as the power-user escape hatch.
- Defining the ranking algorithms themselves.

## Design Principles

1. **Endpoints are strategy-agnostic.** URL paths describe *what is returned* (entities, facts, rendered hits), not *how it was found*.
2. **Strategy lives in `search_config`.** Any caller may override; the ontology holds a default.
3. **Searches are `POST`.** Request bodies accommodate filters, vectors, and reranker configs without URL-length ceilings.
4. **Two envelopes, not one.** Deterministic reads return `total`; scored searches return `score` and `has_more`. Both paginate with `limit` + `offset`.
5. **REST ≠ MCP.** MCP tools are designed for LLM tool-selection, with defaults applied; they do not mirror REST 1:1.

## Tiers

The runtime read surface is cut into three tiers by caller intent.

### Tier 1 — Deterministic reads

For loading and browsing: editing forms, list views, neighbor expansion. Paginated with known totals. No scoring.

```
GET /api/runtime/{ontology}/entities/{type}
GET /api/runtime/{ontology}/entities/{id}
GET /api/runtime/{ontology}/relations/{type}
GET /api/runtime/{ontology}/relations/{id}
GET /api/runtime/{ontology}/entities/{id}/neighbors
```

Query parameters: `filter.<prop>`, `sort`, `limit`, `offset`. Filters support equality, range (`gt/gte/lt/lte`), and set membership. No free-text `q`; search belongs in Tier 2.

### Tier 2 — Search

For queries that rank results. Strategy chosen by `search_config`; server applies ontology defaults when absent.

```
POST /api/runtime/{ontology}/search/entities
POST /api/runtime/{ontology}/search/facts
```

Entity and fact search stay separate. Their filter namespaces, result shapes, and scoring semantics diverge enough that unification would hide rather than clarify — see [Cross-kind search](#cross-kind-search).

### Tier 2.5 — Retrieve (optional, opt-in)

For RAG-style context assembly: cross-kind ranked hits with rendered text. Introduced only if the consuming workload (episode ingestion, agent grounding) lands.

```
POST /api/runtime/{ontology}/retrieve
```

### Tier 3 — Power tools

```
POST /api/runtime/{ontology}/query                   # Cypher, scope-validated
POST /api/runtime/{ontology}/saved-queries/{key}/run # composed pipelines
```

Saved queries remain the composition primitive for multi-step retrieval.

## Request Shapes

### Tier 1 — list entities

```
GET /api/runtime/{ontology}/entities/person
    ?filter.status=active
    &filter.hired_on.gte=2024-01-01
    &sort=-created_at
    &limit=50
    &offset=0
```

### Tier 2 — search entities

```
POST /api/runtime/{ontology}/search/entities
```

```json
{
  "query": {
    "q": "renewable energy subsidies",
    "filter": { "type": "document", "year": { "gte": 2020 } }
  },
  "search_config": {
    "strategies": ["semantic", "bm25"],
    "fusion": { "method": "rrf" },
    "rerankers": [ { "kind": "cross_encoder" } ]
  },
  "limit": 20,
  "offset": 0
}
```

### Tier 2 — search facts

Same request envelope as entity search. `filter` uses the fact namespace: `predicate`, `subject_type`, `object_type`, relation properties, and optionally `subject_id` / `object_id`.

### Tier 2.5 — retrieve

```json
{
  "q": "European wind subsidies 2023",
  "kinds": ["entity", "fact"],
  "filter": {
    "entity": { "type": "document" },
    "fact":   { "predicate": "authored_by" }
  },
  "search_config": { "rerankers": [ { "kind": "cross_encoder" } ] },
  "limit": 20,
  "offset": 0
}
```

## Response Envelopes

Three envelopes, matched to the contract of each tier. All use `limit` + `offset` pagination.

### `ListEnvelope` (Tier 1)

```json
{ "items": [ ... ], "total": 1342, "limit": 50, "offset": 0 }
```

### `SearchEnvelope` (Tier 2)

```json
{
  "hits": [
    {
      "item": { "...": "entity or fact payload" },
      "score": 0.82,
      "matched_via": ["semantic:0.87", "bm25:0.40"]
    }
  ],
  "limit": 20,
  "offset": 0,
  "has_more": true,
  "config_echo": { "strategies": ["semantic","bm25"], "fusion": "rrf" },
  "warnings": []
}
```

No `total` — ranked results make it a meaningless number. `has_more` is enough. `config_echo` reports what the server actually ran, so changing defaults does not leave callers guessing. A different `search_config` on the next page is expected to produce a different ranking from `offset=0`; that is correct behavior, not an error.

### `RetrieveEnvelope` (Tier 2.5)

```json
{
  "hits": [
    {
      "kind": "entity",
      "score": 0.91,
      "rendered": "Document: EU Wind Subsidies 2023",
      "ref": { "entityId": "ent_1" }
    },
    {
      "kind": "fact",
      "score": 0.88,
      "rendered": "EU Wind Subsidies 2023 authored_by Marie Dubois",
      "ref": { "relationId": "rel_9", "subjectId": "ent_1", "objectId": "ent_7" }
    }
  ],
  "limit": 20,
  "offset": 0,
  "has_more": true,
  "config_echo": { "...": "..." }
}
```

Cross-kind scoring is honest only against rendered text; `rendered` is the unifying contract.

### Why offset, not cursor

- Result sets are ontology-scoped — bounded, not streamed.
- Scored endpoints cap `limit`, so deep pagination is not a workload.
- Re-ranking happens on every call anyway; cursor and offset incur the same server cost.
- Offset is simpler to implement, debug, and explain to callers.
- Cursor would pay for itself only with multi-million-row sets, continuous-insert streams, or infinite-scroll UIs — none of which apply here.

## `search_config`

Open, forward-compatible object. Unknown keys produce warnings, not errors — new strategies and rerankers are additive.

```json
{
  "strategies": ["semantic", "bm25"],
  "fusion":     { "method": "rrf", "weights": { "semantic": 0.6, "bm25": 0.4 } },
  "rerankers":  [ { "kind": "cross_encoder", "model": "bge-reranker" } ]
}
```

- **Per-ontology default.** Stored on the ontology. Absent `search_config` → default applied. This is where generic vs domain-specific search diverges.
- **Partial overrides.** Caller sets only what it cares about; unset keys inherit the default.
- **`config_echo` is mandatory.** Every search response reports the resolved config.
- **Saved queries reference, not redefine.** Pipeline steps point to `search_config`; they do not embed a second copy.

## Cross-kind search

Entity search and fact search stay separate in Tier 2. The arguments:

- **Scores are not commensurable.** Entity-semantic and fact-semantic scores come from different text distributions; RRF merges ranks but hides that "rank 3" means different things.
- **Filter namespaces diverge.** Entities filter on `type` + properties; facts filter on `predicate`, endpoint types, and relation properties.
- **Result shapes diverge.** Entities carry rich property graphs; facts carry compact triples with locators.
- **Redundancy.** Query-matching both an entity and a fact mentioning it wastes hit slots on the same information.

Tier 2.5 (`/retrieve`) exists for the one case where cross-kind fusion is the point: assembling ranked text for an LLM. Its contract (rendered text, separate filter namespaces, `kind`-tagged hits) admits the difference rather than hiding it.

## MCP Surface

Designed independently from REST. Tools are narrow, flat, and described for LLM tool-selection. Defaults hide `search_config` unless the agent explicitly overrides.

- `list_entities(type, filter?, page?)`
- `get_entity(id)` / `get_relation(id)`
- `list_relations(type, filter?, page?)`
- `get_neighbors(id, via?, depth?)`
- `search_entities(q, filter?, config?)`
- `search_facts(q, filter?, config?)`
- `retrieve(q, kinds?, k?)` — only if Tier 2.5 is built
- `run_cypher(cypher, params?)`

## Summary

| Tier | Endpoint | Method | Envelope | Total | `has_more` | Pagination | Score |
|---|---|---|---|---|---|---|---|
| 1 | `/entities/{type}`, `/relations/{type}`, `/neighbors` | GET | `ListEnvelope` | yes | — | `limit`+`offset` | no |
| 2 | `/search/entities`, `/search/facts` | POST | `SearchEnvelope` | no | yes | `limit`+`offset` | yes |
| 2.5 | `/retrieve` | POST | `RetrieveEnvelope` | no | yes | `limit`+`offset` | yes (`kind`-tagged) |
| 3 | `/query`, `/saved-queries/{key}/run` | POST | native | n/a | — | caller | no |

## Open Questions

- Should `filter` syntax in Tier 1 query strings and Tier 2 bodies share a grammar, or intentionally differ (URL-safe vs. full)?
- Does `search_config` belong on the ontology alone, or also per entity/relation type?
- When `/retrieve` is built, do saved queries gain a retrieve step, or is retrieve always terminal?
- Is a `describe_search_config` endpoint needed so clients can discover supported strategies and rerankers?
