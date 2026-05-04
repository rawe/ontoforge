# M4 — Cross-type entity semantic search + EntityType display/projection config

**Status:** plan settled, awaiting implementation.
**Branch:** `feature/relation-facts`.
**Precedents:** M1 (relation-side semantic search), M2 (reconcile worker).

This document is the authoritative implementation brief for M4. It supersedes the open questions in `HANDOVER-M4.md` and the M4 row of `roadmap.md`. Read those for context, but the decisions below are final.

---

## 1. Scope

### In

- Single global vector index `(:_Entity)._embedding` named `_entity_embedding` (Option B from prior design discussion: dual indexing — keep per-type indexes, add one global index).
- New REST endpoint `GET /api/runtime/{ontologyKey}/search/semantic/entities`.
- New MCP tool `semantic_search_entities` on the runtime MCP server.
- Two new optional fields on `EntityType`:
  - `displayNameProperty: str | None`
  - `defaultSearchProperties: list[str] | None`
- Modeling REST + MCP surface for the two new fields (create / update / response / export / import).
- Auto-cascade on property delete and rename to keep references consistent.
- Tests: unit (modeling + runtime), integration (REST + Docker/Ollama), modeling-MCP integration if MCP test infra is being added.

### Out

- `embeddable` flag work — separate M4 sub-track, not in this plan.
- Keyword/hybrid search, RRF, fact templates for entities.
- Symmetry on `RelationType` for `displayNameProperty` / `defaultSearchProperties` — deferred.
- Any change to `runtime/embedding.py::build_text_repr`.
- Any change to entity write path (`create_entity` / `update_entity`).
- Any change to the M2 reconcile worker.
- Migrations — existing entities already have `_embedding`; the new index populates from existing data via Neo4j's index population.

---

## 2. Architectural delta

| Area | Today | After M4 |
|---|---|---|
| Per-type entity vector indexes | `{entity_type_key}_embedding` on `(:PascalLabel)._embedding` | unchanged |
| Global entity vector index | none | new `_entity_embedding` on `(:_Entity)._embedding` |
| Single-type entity search | `GET /search/semantic?type=…` | unchanged |
| Cross-type entity search | absent | new `GET /search/semantic/entities` |
| MCP cross-type tool | absent | new `semantic_search_entities` |
| `EntityType` schema | `key`, `displayName`, `description` | adds `displayNameProperty`, `defaultSearchProperties` |
| Entity write path | sync embed in `create_entity`/`update_entity` | unchanged (one `_embedding` populates both indexes) |
| M2 reconcile worker | relations only | unchanged |
| Build-text-repr | string-prop concat | unchanged |

---

## 3. Resolved design decisions

These were debated and locked. Implementers must not re-open them without explicit user approval.

| # | Decision | Resolution |
|---|---|---|
| 1 | Global index name | `_entity_embedding` (leading underscore mirrors `_Entity` label / system-property convention) |
| 2 | Index pre-filter property list | `[n._entityTypeKey, n._groupId]` |
| 3 | Endpoint path | `GET /api/runtime/{ontologyKey}/search/semantic/entities` |
| 4 | Query params | `q` (required), `limit` (1–100, default 20), `group_id` / alias `groupId` (optional), `min_score` (optional, 0–1). No `k` — no RRF. |
| 5 | Ontology scope enforcement | Service filters via `WHERE n._entityTypeKey IN $allowed_keys` for scoped ontologies; unscoped passes `None` (no filter). Overfetch multiplier `5×`. |
| 6 | Index lifecycle | Created at startup whenever `EMBEDDING_PROVIDER` is set, independent of any entity type existing. Never dropped. |
| 7 | MCP tool naming | `semantic_search_entities`, registered under `tool_names.TOOL_SEMANTIC_SEARCH_ENTITIES` |
| 8 | Placement of `displayNameProperty` / `defaultSearchProperties` | On `EntityType` (centralized), not on `PropertyDefinition` |
| 9 | Defaults when unset | `displayName` is `null`; `properties` is `{}`. No fallback guessing. |
| 10 | Cascade on property **delete** | **Auto-clear references** (lenient B). Clear `displayNameProperty` if it equals the deleted key; remove the deleted key from `defaultSearchProperties` lists. Log INFO per affected type. |
| 11 | Cascade on property **rename** | **Auto-update references** to the new key in both fields. Log INFO per affected type. |
| 12 | Symmetry with `RelationType` | Defer. RelationType already has `factTemplate` filling much of the role. |
| 13 | Validation: type-check on `displayNameProperty` | No type check — coerce to string on read (`str(value)`). |
| 14 | Cross-type response shape | See §6.7. Uses `properties` field (not `entity`) to signal "configured projection, not full entity". |

---

## 4. Open verification (implementer must check before coding)

- **Are property keys mutable today?** If yes, the rename-cascade logic must be live. If no, wire the cascade anyway as a no-op safety net but don't add a rename endpoint.

---

## 5. Modeling layer changes

### 5.1 Storage — Neo4j `EntityType` node

Two new properties on `(:_EntityType)`:

- `displayNameProperty: string` (nullable)
- `defaultSearchProperties: list<string>` (nullable / empty)

No new relationships. No new constraints. No data migration required — existing nodes simply lack these properties; read code treats absent as `null` / `[]`.

### 5.2 `modeling/schemas.py`

Extend `EntityTypeCreate`, `EntityTypeUpdate`, `EntityTypeResponse` with the two fields. Both optional. Order in `defaultSearchProperties` is preserved.

### 5.3 `modeling/service.py`

**Validation in `create_entity_type` and `update_entity_type`:**

- After the existing property checks:
  - If `displayNameProperty` is set: must reference a property key defined on this entity type. Reject with structured 422 on violation.
  - Every key in `defaultSearchProperties`: must reference a property key defined on this type. Reject with structured 422 on violation.

**Cascade on property delete (`delete_property` or equivalent):**

- After delete, run a single Cypher pass that:
  - Clears `displayNameProperty` on any `EntityType` where it equals the deleted key.
  - Removes the deleted key from any `defaultSearchProperties` list.
- Emit `INFO` log per type touched: `auto-cleared {field} on entity type {key} due to property delete`.
- Must run in the same transaction as the delete so observers never see a dangling reference.
- Return 200 on success (no 409).

**Cascade on property rename:**

- Same pass, but **substitutes** the old key with the new one in both fields.
- Same INFO log per affected type.
- Same transaction-scoped guarantee.

**Schema invalidation:** existing `_invalidate_runtime_schema_cache` calls already cover entity-type and property mutations — no new invalidation hooks needed.

### 5.4 `modeling/repository.py`

The existing entity-type CRUD Cypher gets two more fields in the `SET` / `RETURN` projection. Trivial change.

### 5.5 `modeling/router.py`

No path changes. Pydantic models in §5.2 carry the new fields automatically into request/response bodies.

### 5.6 MCP modeling tools — `mcp/modeling.py`

Extend `create_entity_type` and `update_entity_type` tool signatures with the two new optional params. Mirror the description style of existing params; no behavior unique to MCP. Both tool names already exist in `tool_names.py` — no new tool names.

### 5.7 Export / import

The JSON schema export/import for EntityType must round-trip the two new fields. One-liner change in the export serializer and import parser. Validation in import mirrors create.

### 5.8 API contract docs

Update `docs/api-contracts/modeling-api.md` with:

- Two new fields on `POST /api/model/entity-types` and `PATCH /api/model/entity-types/{key}`.
- New 422 error codes for referenced-property-not-found.
- Cascade behavior documented on property delete and rename (no 409; auto-cascade with log).

---

## 6. Runtime layer changes

### 6.1 Index bootstrap — `core/database.py`

Add `create_global_entity_vector_index(driver, dimensions)` that issues:

```cypher
CREATE VECTOR INDEX _entity_embedding IF NOT EXISTS
FOR (n:_Entity) ON (n._embedding)
WITH [n._entityTypeKey, n._groupId]
OPTIONS {indexConfig: {`vector.dimensions`: $dimensions, `vector.similarity_function`: 'cosine'}}
```

Call it from `ensure_vector_indexes()` once, before the per-type loop. Idempotent via `IF NOT EXISTS`. No changes to `create_vector_index` (per-type) — those still get created per entity type.

### 6.2 Schema cache — `runtime/schema_cache.py`

Add the two new fields to `EntityTypeDef`:

- `display_name_property: str | None`
- `default_search_properties: list[str]` (default `[]`)

Populate from Neo4j on cache load.

If `displayNameProperty` references a property that the ontology scope filters out, treat the property as not present in the projected `EntityTypeDef.scoped_property_keys`. The runtime then returns `displayName: null` for that match. No special-case logic beyond the existing scope filter.

### 6.3 Runtime service — `runtime/service.py`

Add `semantic_search_entities(ontology_key, q, limit, group_id, min_score, driver)`:

1. Resolve `LoadedSchema` for `ontology_key`. Compute `allowed_type_keys = list(scoped.entity_types.keys())` if scoped, else `None`.
2. Call `provider.embed(q)`. If `None`, return `[]`.
3. Call repository function `semantic_search_entities_global(...)` with `internal_limit = limit * 5` (overfetch), the embedding, `allowed_type_keys`, `group_id`, `min_score`.
4. For each `(node, score, type_key)` returned:
   - Look up `type_def = loaded_schema.scoped.entity_types[type_key]`.
   - Resolve `displayName` from `type_def.display_name_property` (coerce to `str`, `None` if unset or absent).
   - Build `properties = {k: node[k] for k in type_def.default_search_properties if k in node and k in type_def.scoped_property_keys}`.
   - Strip `_embedding` and other system props (reuse existing `_strip_embedding`).
5. Truncate to `limit`. Return `list[EntitySemanticMatch]`.

No `_rrf_fuse`. No per-type fan-out. One Cypher call.

### 6.4 Runtime repository — `runtime/repository.py`

Add `semantic_search_entities_global(...)`:

```cypher
CALL db.index.vector.queryNodes('_entity_embedding', $internal_limit, $query_embedding)
YIELD node, score
WHERE ($allowed_keys IS NULL OR node._entityTypeKey IN $allowed_keys)
  AND ($group_id IS NULL OR node._groupId = $group_id)
  AND ($min_score IS NULL OR score >= $min_score)
RETURN node {.*} AS entity, score, node._entityTypeKey AS type_key, node._id AS id
ORDER BY score DESC
```

No type-label match — the index is keyed by `_Entity` label only.

### 6.5 Runtime router — `runtime/router.py`

Add `GET /search/semantic/entities` directly under the existing semantic block. Mirror the structural pattern of the `search/semantic/relations` handler.

### 6.6 Runtime MCP tool — `mcp/runtime.py` + `runtime/tool_names.py`

- Add constant `TOOL_SEMANTIC_SEARCH_ENTITIES = "semantic_search_entities"`.
- Register tool with same param shape as the endpoint (`q` / `limit` / `group_id` / `min_score`). Body delegates to `service.semantic_search_entities`. Mirror error-mapping pattern from the relation tool.

### 6.7 Response model — `runtime/schemas.py`

```python
class EntitySemanticMatch:
    _id: str
    _entityTypeKey: str
    displayName: str | None       # from EntityType.displayNameProperty, null if unset
    properties: dict              # from EntityType.defaultSearchProperties, {} if unset, scope-filtered
    score: float
    matched_via: list[str] = ["vector"]
```

### 6.8 Single-type endpoint regression

`GET /search/semantic?type=…` must continue to behave exactly as today. It does not consume the new EntityType fields — its caller already specifies `fields`, so the default projection isn't its problem.

---

## 7. Test plan

### 7.1 Modeling unit tests — `backend/tests/modeling/`

- Create entity type with valid `displayNameProperty` → 201, response echoes the field.
- Create with `displayNameProperty` referencing a missing key → 422.
- Create with `defaultSearchProperties` containing a missing key → 422.
- Update to clear `displayNameProperty` (set to `null`) → 200.
- Delete a property referenced by `displayNameProperty` → 200; verify the type's `displayNameProperty` is now `null` and an INFO log entry was emitted.
- Delete a property listed in `defaultSearchProperties` → 200; verify the key was removed from the list while other keys remain.
- Rename a property referenced by either field → 200; verify references now point at the new key. (Skip if property keys are immutable today; see §4.)
- Cascade transaction atomicity: simulate intra-transaction observation — should never see a dangling reference.

### 7.2 Modeling integration tests

One end-to-end test through REST: create type, set both fields, retrieve, verify, delete a referenced property → cascade observed, retrieve type → reference cleared.

### 7.3 Runtime unit tests — `backend/tests/runtime/`

New file `test_semantic_search_entities.py`. Mock-driver tests:

- Service-layer happy path: embedding called once, repository called with correct overfetch (`limit * 5`), results truncated to `limit`.
- Ontology scope: scoped ontology produces `allowed_keys` filter; unscoped passes `None`.
- `min_score` and `group_id` plumbed through to repository.
- Empty embedding result → empty list, no DB call.
- `_strip_embedding` actually removes `_embedding` from results.
- `displayName` populated when `display_name_property` set; `None` when unset.
- `properties` populated only for keys in `default_search_properties` and present on the node and in scope.

### 7.4 Runtime integration tests — `backend/tests/integration/test_semantic_search_entities.py`

Marker `integration`. Uses existing `clean_db`, `_configure_embedding`, `integration_client`. Mirrors structure of `test_semantic_search.py`.

Cases:

1. **Cross-type returns hits from multiple types.** Create two entity types (`person`, `company`), insert entities of both, query a phrase appearing in both → response contains both type keys.
2. **Score ordering.** Insert one near-identical and one distantly-related entity → near-identical ranks first.
3. **Scoped ontology hides out-of-scope types.** Create a scoped ontology including only `person`; insert entities of both types; query → only `person` entities returned.
4. **`group_id` filter.** Insert entities with two group IDs, query with one → only matching group returned.
5. **`min_score` floor.** Set high `min_score` → empty results; low → populated.
6. **Per-type endpoint regression.** Same query against `GET /search/semantic?type=person` still works as before.
7. **`displayName` populated.** Type with `displayNameProperty` set → `displayName` is the configured property's value.
8. **`displayName` null.** Type with `displayNameProperty` unset → `displayName` is `null`.
9. **`properties` projection.** Type with `defaultSearchProperties=["name","city"]` → response `properties` contains exactly those keys, in order, and only those.
10. **`properties` empty.** Type with `defaultSearchProperties` unset → `properties` is `{}`.
11. **Out-of-scope `displayNameProperty`.** Scoped ontology where `displayNameProperty` references an out-of-scope property → `displayName` is `null`.

### 7.5 MCP tests

If the MCP test infrastructure is being added in this PR (the `backend/tests/mcp/` directory is empty today):

- `backend/tests/mcp/test_runtime_semantic.py` — call `semantic_search_entities` tool via FastMCP client, assert results.
- `backend/tests/mcp/test_modeling_entity_type_display.py` — call `update_entity_type` with `displayNameProperty` and `defaultSearchProperties`, assert echo.

If MCP test infra is being deferred, document that omission explicitly in the PR.

### 7.6 Docker / Ollama orchestration

Pre-flight (one-time per dev machine):

```bash
# 1. Neo4j
docker compose up -d neo4j
docker compose ps neo4j   # should show (healthy)

# 2. Ollama — pull the embedding model if absent
curl -s http://localhost:11434/api/tags | jq '.models[].name' | grep -q nomic-embed-text \
  || ollama pull nomic-embed-text
```

Run:

```bash
cd backend

# unit tests (no external services required)
uv run pytest tests/runtime/test_semantic_search_entities.py
uv run pytest tests/modeling/  # for new modeling cases

# integration tests (Neo4j + Ollama running)
uv run pytest -m integration tests/integration/test_semantic_search_entities.py
```

Per-test isolation: `clean_db` issues `MATCH (n) DETACH DELETE n` between tests. The new global index survives the wipe (schema object) and re-populates as new entities are inserted. If async index propagation causes flaky reads in the first run, add `CALL db.awaitIndex('_entity_embedding')` after seeding in affected tests.

Coordination order each test session:

1. `docker compose ps neo4j` — assert healthy.
2. `curl http://localhost:11434/api/tags` — assert `nomic-embed-text` present.
3. Set env: `EMBEDDING_PROVIDER=ollama`, `EMBEDDING_MODEL=nomic-embed-text`, `EMBEDDING_BASE_URL=http://localhost:11434`, `DB_URI=bolt://localhost:7687`, `DB_USER=neo4j`, `DB_PASSWORD=ontoforge_dev`.
4. `uv run pytest -m integration`.

If a clean Neo4j slate is required (recreate index from scratch): `docker compose down -v && docker compose up -d neo4j`. Use `down -v` only with explicit confirmation — it drops the data volume.

### 7.7 Manual smoke test

After tests pass, before merge:

```bash
docker compose up -d neo4j
cd backend && uv run uvicorn ontoforge_server.main:app --port 8000 &
# seed via existing scripts or manual POSTs, then:
curl "http://localhost:8000/api/runtime/{key}/search/semantic/entities?q=acme&limit=5"
```

Verify response shape matches `EntitySemanticMatch`.

### 7.8 Baseline test count

Before M4 starts: `cd backend && uv run pytest` → **310 passed, 16 deselected** (per `HANDOVER-M4.md`). Verify before any code change. After M4 ships: count should grow by approximately 25–35 new tests (modeling + runtime + integration); no existing tests should break.

---

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Two HNSW graphs double index-maintenance write cost | Low at current scale | Measurable via `scripts/bench.py` — extend with a cross-type case |
| Scoped ontology + narrow scope returns empty due to overfetch insufficiency | Medium for very narrow scopes | Document the 5× overfetch; expose multiplier as env var only if measurement shows need |
| Index dimensions mismatch if `EMBEDDING_DIMENSIONS` changes | Existing concern, unchanged | Same handling as today — drop & recreate indexes manually |
| Index population async lag on first request after creation | Low | `CALL db.awaitIndex(...)` in tests where needed |
| Cascade clears configuration silently | Low (by design) | INFO log per affected type; documented behavior; reversible by re-setting the field |

---

## 9. Effort estimate

| Area | Estimate |
|---|---|
| Index bootstrap + lifecycle | 30 min |
| Modeling schemas / service / repository / validation | 1.5 h |
| Schema cache fields + propagation | 30 min |
| Modeling MCP tool param additions | 30 min |
| Export/import round-trip | 30 min |
| Runtime service + repository | 1 h |
| Runtime router + Pydantic models | 30 min |
| Runtime MCP tool | 30 min |
| Cascade-on-delete + cascade-on-rename | 1 h |
| Modeling unit tests | 1.5 h |
| Runtime unit tests | 1 h |
| Integration tests (11 cases) | 2.5 h |
| MCP tests (if scoped) | 1 h |
| API contract docs update | 30 min |

**Total: ~12.5 h** of implementer time, single PR.

---

## 10. Documents to update when M4 ships

- `docs/api-contracts/runtime-api.md` — new `search/semantic/entities` endpoint.
- `docs/api-contracts/modeling-api.md` — `displayNameProperty`, `defaultSearchProperties` on `EntityType`; cascade behavior on property delete and rename.
- `docs/feature-ideas/relation-facts/roadmap.md` — tick M4 box, shipped banner matching M1/M2 style.
- `docs/embeddings.md` — note the global `_entity_embedding` index and that it complements per-type indexes.
- This document — add a `**Status: shipped**` banner at the top with the PR link.
