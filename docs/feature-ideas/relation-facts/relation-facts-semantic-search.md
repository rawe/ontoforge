# Relation facts + semantic search over relations — Phase 1 plan

**Status:** approved scope, ready to plan implementation
**Last updated:** 2026-04-19
**Supersedes scope of:** [graphiti-inspired-rearchitecture.md](graphiti-inspired-rearchitecture.md) — Phases 0 and 1 as scoped in that doc
**Inherits:** design principles, forward-compat contract, out-of-scope list from the source doc

This document is the implementation-level decision record for the first concrete slice of the Graphiti-inspired re-architecture. The source doc defines the end-state and full staging; this doc narrows Phase 1 to what we actually ship, with every design question resolved. Where the source doc is ambiguous or generic, the decisions below override.

---

## 1. Phase 1 scope in one paragraph

Phase 1 focuses on **relations**. Relations gain a deterministic fact sentence and an embedding, and become first-class objects in semantic search. Two new REST endpoints (+ matching MCP tools) ship: a cross-type semantic search over relation facts, and a cross-type structural listing of relations touching a given entity. The entity side of search is untouched in Phase 1 — the existing single-type `semantic_search(entity_type_key=…)` endpoint is preserved unchanged, and the entity-embedding composition (today's "all string properties") is not refined in this phase. Phase 0 reservations (system properties on all nodes and edges) ship alongside so later phases never require a migration.

---

## 2. What stays unchanged

The following existing surfaces are **not** modified in Phase 1:

- `GET /api/runtime/{key}/search/semantic?type=…` — single-type, typed-payload entity semantic search. Untouched.
- `GET /api/runtime/{key}/entities/...`, `list_entities`, `get_entity` — untouched.
- `get_relation(id)`, `list_relations(relation_type_key, filters, …)` — untouched. `list_relations` continues to require a specific `relation_type_key` and continues to accept user-property filters for that single type.
- `get_neighbors(entity_id, direction, relation_type_key, limit)` — untouched.
- Entity embedding composition: today's "all string properties concatenated" behavior stays exactly as it is. No `embeddable` flag in Phase 1.
- Existing MCP tools: no signature changes.

Anything new in Phase 1 is **additive** and sits alongside.

---

## 3. Phase 0 reservations (forward-compat, ship in Phase 1)

Cheap to commit now, expensive to retrofit. Applied to all new entity and relation writes from the Phase 1 cutover; existing data is backfilled once at deploy.

On **every entity node** and **every relation edge**:
- `_groupId: string` — always populated. Default `"default"` for all existing and new data. Indexed in every vector index's `WITH [...]` list.
- `_validAt: datetime | null` — reserved, always null in Phase 1.
- `_invalidAt: datetime | null` — reserved, always null in Phase 1.
- `_embeddingState: enum("ok" | "pending" | "failed" | "stale")` — tracks embedding freshness explicitly.
- `_embeddingVersion: int` — bumps when the embedding composition changes.

Reserved schema keys blocked from user declaration: `Episode`, `MENTIONS`, `provenance`.

No user-visible behavior change from these reservations in Phase 1. Their cost now is trivial; their absence later would force a full-graph migration.

---

## 4. Modeling surface — relations

### 4.1 New field on `RelationType`

- `factTemplate: string | null` — optional. Default `null`.

**Presence of a non-null `factTemplate` is the opt-in.** A type with `factTemplate` set is a **semantic relation type**; it gets a `_fact`, an `_embedding`, a per-type vector index, and participates in the semantic relation search endpoint. A type with `factTemplate: null` is structural-only, unchanged from today.

There is no separate `semantic: bool` flag. The "is this type semantic?" predicate is computed: `relationType.factTemplate is not None`. Export/import format carries only `factTemplate`.

### 4.2 Template language

Constrained Jinja2 via `SandboxedEnvironment`.

- **Disabled:** `{% for %}`, `{% include %}`, `{% import %}`, `{% macro %}`, `{% call %}`, attribute access patterns that bypass the sandbox.
- **Allowed:** variable expansion (`{source.x}`, `{target.y}`, `{relation.z}`, `{source.displayName}`, `{target.displayName}`, `{relation.displayName}`), `{% if %}`/`{% elif %}`/`{% else %}`/`{% endif %}`, `{% set %}`.
- **Filter whitelist:** `|date`, `|date(fmt)`, `|default(x)`, `|lower`, `|upper`, `|title`, `|join(", ")`, `|trim`.
- **Hard caps:** template source ≤ 2000 characters; rendered output ≤ 2000 characters.
- **Identifier rejection:** `__` in expressions is rejected to block common SSTI escape patterns.

### 4.3 Template validation at schema write time

When a `factTemplate` is set or changed, the validator enforces:

1. **Parses as a valid sandboxed Jinja2 template.**
2. Referenced variables must exist: every `{source.X}` refers to a property defined on the relation's declared source entity type; every `{target.X}` to the target; every `{relation.X}` to a property on the relation type itself. `displayName` is always available on all three.

The stricter "every branch produces non-empty output for every legal property combination" check is **not** enforced. Authors are trusted to write sensible templates; templates that render empty on certain inputs will produce empty embeddings for those instances. Accepted risk.

### 4.4 Template → fact rendering: hidden-data trade-off

Templates render against the **full** source and target entity data, regardless of the active lens's `INCLUDES_TYPE` property allowlist at render time. If a template references `{source.displayName}` but the current lens's property allowlist for the source type omits `displayName`, the rendered `_fact` still contains it. The `_fact` then flows through the embedding and into search results visible through that lens.

This is a conscious accepted risk. Mitigation path (not in Phase 1): template validation could cross-reference lens scopes, or `_fact` could be re-rendered per lens. Both add complexity disproportionate to Phase 1's goals.

---

## 5. Storage mapping

Still 1:1 native Neo4j. Every semantic relation edge carries:

- Existing: `_id`, `_relationTypeKey`, `_createdAt`, `_updatedAt`, user-defined properties.
- From Phase 0: `_groupId`, `_validAt`, `_invalidAt`, `_embeddingState`, `_embeddingVersion`.
- New for semantic relations: `_fact: string`, `_factVersion: int`, `_embedding: list<float>`.

Structural (non-semantic) relations carry only the Phase 0 reservations on top of today's fields.

Vector indexes are declared per relation type, created from schema at startup. Each semantic relation type gets its own vector index on `_embedding`. The index's `WITH [...]` list includes `_groupId`, `_validAt`, `_invalidAt`, `_relationTypeKey` so future filters can be pushed into the in-index `WHERE` clause. Only `_groupId` is used in Phase 1; the others are reserved for Phase 4 temporal.

No fulltext indexes in Phase 1.

---

## 6. Write path

### 6.1 Create / update of a semantic relation

Mirrors the existing entity-embedding write path (try-sync, graceful degradation on failure):

1. Persist the relation and its user properties.
2. Render `_fact` from the template (synchronous, deterministic, cheap).
3. Attempt to embed `_fact` synchronously. On success: store `_embedding`, set `_embeddingState = "ok"`, `_embeddingVersion = <current>`. On failure (model unavailable, timeout): store no `_embedding`, set `_embeddingState = "failed"`. The relation is created regardless — failure does **not** block the write. The background worker retries failed states.
4. `_factVersion` is set to the current version of the relation type's template.

Update of a relation's own properties follows the same path: re-render, re-embed, overwrite.

### 6.2 Entity-update staleness propagation

When any property on an entity changes, the write path marks **every semantic relation of any type where that entity is source or target** as `_embeddingState = "stale"`. Dumb and over-inclusive by design: relations whose templates don't actually reference the changed property are still re-reconciled. This is the Phase 1 approach; a template-to-property-dependency index is a Phase 2+ optimization.

Marking is a cheap label-scan by `_id` — no rendering, no embedding call, no model round-trip on the critical path.

### 6.3 Template update on a `RelationType`

When a `factTemplate` is changed (or first set) on a relation type:

- Bump the relation type's template version.
- Mark every existing instance of that type as `_embeddingState = "stale"`.
- Background worker reconciles.

### 6.4 Background reconcile worker

A background worker drains the `_embeddingState = "stale"` and `_embeddingState = "failed"` queues in batches. For each: re-render `_fact`, re-embed, update `_embeddingVersion` / `_factVersion`, set state to `"ok"`. Retries `"failed"` items with exponential backoff.

---

## 7. Read path — new endpoints

Two new REST endpoints (+ matching MCP tools) ship in Phase 1.

### 7.1 `GET /api/runtime/{key}/search/semantic/relations`

Cross-relation-type semantic search over relation facts.

**Query params:**
- `q: string` — required. Natural-language query to embed.
- `limit: int` — default 20.
- `group_id: string | null` — optional. If provided, filters in-index to that group; otherwise uses the lens's default.
- `k: int` — advanced. RRF k parameter. Default 60.

**Behavior:**
1. Embed `q`.
2. Enumerate eligible relation types: all relation types visible in the active lens that have a non-null `factTemplate` (and therefore a vector index).
3. Fan out: N parallel Cypher queries, one per eligible type, each executing a Cypher 25 `SEARCH … IN (VECTOR INDEX …) … WHERE _groupId = $groupId … LIMIT max(limit, 50) SCORE AS score`. Each query returns a ranked list.
4. Fuse in application code using RRF: `score = Σ 1/(k + rank_in_list)` across all source lists in which the item appears.
5. Sort by RRF score descending, break ties by `_id` ascending, return top `limit`.
6. Per-index failure is isolated: if one index errors or is unavailable, its list is empty + logged; the overall request still succeeds.

**Response shape** (one entry per match):
```
{
  "_id": string,
  "_relationTypeKey": string,
  "source_id": string,
  "target_id": string,
  "_fact": string,
  "score": float,
  "matched_via": ["vector"]
}
```

`_fact` is included so callers see *why* the match surfaced without a second fetch. `source_id` / `target_id` are included so downstream pipelines can traverse without an N+1 over `get_relation`. User-defined relation properties are **not** included — fetch via `get_relation(id)` for those.

`matched_via` is always `["vector"]` in Phase 1. The field exists to be forward-compatible for multi-path retrieval in later phases.

### 7.2 `GET /api/runtime/{key}/entities/{entity_id}/relations`

Structural cross-relation-type listing of relations touching a specific entity.

**Query params:**
- `direction: "in" | "out" | "both"` — default `"both"`.
- `relation_type_keys: list<string> | null` — optional whitelist. Null = all relation types in the lens.
- `limit: int` — default 50.
- `group_id: string | null` — optional.

**Behavior:** one Cypher query: `MATCH (e)-[r]-(n) WHERE e._id = $entity_id AND type(r) IN allowed_types AND r._groupId = $groupId …`, respecting direction. No embedding, no ranking — ordered by `_createdAt DESC` by default.

**Response shape:**
```
{
  "_id": string,
  "_relationTypeKey": string,
  "source_id": string,
  "target_id": string,
  "_createdAt": datetime,
  "_updatedAt": datetime,
  "score": null,
  "matched_via": ["filter"]
}
```

User-defined properties are not returned — fetch via `get_relation(id)`. This keeps the shape uniform across types and uniform with `search/semantic/relations`.

This endpoint exists to make the semantic endpoint's locators usable in real pipelines: "find candidate facts → list other relations on the involved entities → decide" becomes a natural two-step flow without per-type branching.

### 7.3 Filters at fan-out on `search/semantic/relations`

Only system properties are filterable at fan-out: `_groupId` in Phase 1, with `_validAt`/`_invalidAt` reserved for Phase 4. User-property filtering is not supported on this endpoint — callers who need it compose downstream (fetch matches, filter client-side or via a later saved-query step).

Rationale: every eligible type has a different user-property set, so a single filter map doesn't type-check across types. The old single-type endpoint remains the path for typed filtering.

---

## 8. MCP tools

Two new tools, mirroring the endpoints:

- `semantic_search_relations(query, limit?, group_id?, k?)` — returns the shape of §7.1.
- `list_entity_relations(entity_id, direction?, relation_type_keys?, limit?, group_id?)` — returns the shape of §7.2.

Existing MCP tools (`semantic_search`, `get_relation`, `list_relations`, etc.) are unchanged.

---

## 9. Indexes and constraints

Declared from schema at startup, created idempotently.

- **Per-semantic-relation-type vector index** on `_embedding`, with `WITH [_groupId, _validAt, _invalidAt, _relationTypeKey]` in-index property list.
- **Existing indexes** on relation `_id`, `_relationTypeKey`, timestamps — unchanged.

No fulltext indexes, no entity-side vector index changes, no new entity-side constraints.

---

## 10. Response-shape principles summary

For reference across the four read endpoints that touch relations:

| Endpoint                                       | Response per item                                                                 |
|------------------------------------------------|------------------------------------------------------------------------------------|
| `get_relation(id)` (existing)                  | Full typed payload with user props.                                                |
| `list_relations(type)` (existing)              | Full typed payload with user props (single type).                                  |
| `search/semantic/relations` (new)              | Locator + `source_id` + `target_id` + `_fact` + score + `matched_via`.              |
| `/entities/{id}/relations` (new)               | Locator + `source_id` + `target_id` + `_createdAt`/`_updatedAt` + `matched_via`.    |

Callers who want user-defined properties on matches fetch via `get_relation(id)`.

---

## 11. Explicitly deferred to later phases

- **`embeddable: bool` on `PropertyDefinition`.** Deferred to Phase 2. Entity embeddings in Phase 1 continue to use today's "all string properties concatenated" composition.
- **`searchable: bool` on `PropertyDefinition`.** Deferred (Phase 2+ along with fulltext).
- **`search/semantic/entities` (cross-entity-type semantic search).** Deferred to Phase 2 — Phase 1 concentrates on the relation side. The existing single-type entity semantic search covers the entity side in the meantime.
- **Fulltext search on anything.** Deferred to Phase 2.
- **`search/any` composer across entities and relations.** Deferred to Phase 2 or later. Callers who want cross-kind results call both primitives client-side.
- **Saved-query step integration** (`relation_search`, `hybrid_search`, `fulltext`, `expand`, `seed_filter`). Deferred to Phase 2. The new endpoints are still callable directly; they just don't appear as saved-query step types yet.
- **`type_keys?` whitelist on `search/semantic/relations`.** Deferred. Phase 1 always fans out over all eligible types in the lens.
- **Template-to-property dependency index** for narrower stale-marking on entity updates. Deferred. Phase 1 uses the dumb "mark all relations of semantic types touching this entity" rule.
- **Temporal (`_validAt`/`_invalidAt` actually populated, `asOf` queries, relation versioning).** Deferred to Phase 4. Fields are reserved now.
- **Ingest-episode / LLM extraction.** Deferred to Phase 5.
- **Community detection, LLM-synthesized facts, per-field vectors.** Deferred to Phase 6 and only if needed.

---

## 12. Accepted risks and trade-offs

1. **Hidden-data leak through `_fact`.** Templates render against full entity data, not lens-scoped data. `_fact` can surface entity properties that would otherwise be hidden by the lens's property allowlist. Accepted; see §4.4.
2. **Entity-update storm.** A single entity property change marks every semantic relation touching it as stale. For highly connected entities with many semantic relation types, this can queue a large reconcile batch. The worker absorbs this; user-visible impact is search-result staleness until reconcile catches up. Dependency-index optimization is a known future improvement.
3. **Empty renderings.** A template that references an optional property without an `{% if %}` guard will produce an empty or partial `_fact` when the property is absent. Accepted; author's responsibility. Validator does not enforce non-empty output for all property combinations.
4. **Embedding failure at create time produces a searchable gap.** A relation whose create-time embedding fails is persisted with `_embeddingState = "failed"` and no `_embedding`. It is invisible to `search/semantic/relations` until the worker reconciles. Mirrors today's entity-embedding behavior.
5. **Locator-plus-fact is a soft relaxation of the source doc's strict locator-only contract.** Phase 1's semantic relation response includes `_fact` in each match. Entity-side locators stay strict. Accepted for UX.

---

## 13. Out of scope for Phase 1 (hard "no")

Same as the source doc's §6, plus:

- No changes to entity embedding composition.
- No cross-entity-type semantic search endpoint.
- No saved-query step types.
- No fulltext or hybrid search.
- No `search/any` composer.
- No temporal queries.

---

## 14. Decision log (summary)

| # | Decision                                                                                       | Why                                                                                  |
|---|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| 1 | Symmetric fan-out design for entities and relations; Phase 1 only ships the relation half.     | Preserves future symmetry without shipping the entity half early.                    |
| 2 | Two mono-purpose primitives, no composer in Phase 1.                                           | KISS; MCP tool-use crispness; composer deferred until needed.                        |
| 3 | N parallel Cypher calls + app-side RRF.                                                        | Per-index failure isolation; trivial to test; RRF needs per-list rank.               |
| 4 | Filters at fan-out limited to system properties (`_groupId` now; temporal reserved).           | Cross-type user-prop filtering is ill-defined; old endpoint handles single-type.     |
| 5 | Existing `semantic_search`, `list_relations`, `get_relation` untouched.                        | Explicit user constraint; new endpoints are additive.                                |
| 6 | New endpoints always fan out over all eligible types in the lens.                              | KISS; `type_keys?` whitelist is a non-breaking later addition.                       |
| 7 | URL naming: `/search/semantic/relations` and `/entities/{id}/relations`.                       | Conventional REST; distinct from the single-type `?type=` pattern.                   |
| 8 | Stale-marking on entity updates + background reconcile; dumb rule first.                       | Phase 0's `_embeddingState` makes marking free; dependency index is later.           |
| 9 | Relation locator shape includes `source_id`, `target_id`, and (semantic only) `_fact`.         | Endpoints `_id`s are structural identity; `_fact` answers "why did this match?".     |
| 10 | One field — `RelationType.factTemplate: string | null`; presence = semantic.                 | Pit of success; no redundant flag states.                                            |
| 11 | Constrained Jinja2 `SandboxedEnvironment`; filter whitelist; write-time parse validation only. | Expressive enough for §3.3 examples; security surface bounded; "just parses" gate.   |
| 12 | Lazy entity re-embed triggered by `embeddable` flips — deferred to Phase 2.                    | Phase 1 focuses on relations; no unnecessary entity-side migration.                  |

---

## 15. Credit

The relation-level fact + embedding concept comes from [Graphiti](https://github.com/getzep/graphiti). The synthesis with OntoForge's native-typed Neo4j mapping, Cypher 25 `SEARCH` clause, schema-validated deterministic templates, and RRF fan-out is OntoForge-native.
