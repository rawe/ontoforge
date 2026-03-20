# Saved Queries

> Pre-defined, parameterized read operations stored per ontology — enabling reliable, token-efficient querying for small models without raw Cypher composition.

## Purpose

The `execute_cypher_query` tool is powerful but demands that the model compose valid Cypher from scratch: correct label keys, relationship types, property names, `$param` syntax. For large models with a well-crafted system prompt, this works. For smaller, cheaper models that should handle routine lookups, it's fragile and wastes tokens on query construction.

Saved queries flip this: the ontology designer pre-defines named, parameterized queries at design time. At runtime, the agent picks a query by name, fills in the parameters, and gets results. The agent never sees Cypher.

### Example

A talent ontology designer creates a saved query `people_by_skill`:

```
Cypher:      MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id = $skillId RETURN p.name
Parameters:  skillId (string, required) — The _id of the skill to search for
```

An agent configured with only `list_saved_queries` + `run_saved_query` calls:

```json
run_saved_query({ "query_key": "people_by_skill", "parameters": { "skillId": "3bd5..." } })
```

No Cypher knowledge required. The system prompt lists the available queries and their parameters — the agent just matches user intent to the right query name.

## Future: Beyond Cypher

Phase 1 backs each saved query with a single parameterized Cypher statement. But the runtime contract — name, description, parameters in, tabular results out — is deliberately abstract. In a future phase, a saved query could be backed by a **declarative workflow**: a multi-step pipeline chaining semantic search, Cypher traversal, aggregation, or other operations. From the agent's perspective, nothing changes — it still calls `run_saved_query` with a name and parameters. Only the backend execution changes.

Example workflow (future):

```
1. semantic_search(entity_type="skill", query=$skillQuery, limit=3)  →  skill IDs
2. MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id IN $skillIds RETURN p.name, s.title
```

The agent provides `{"skillQuery": "data engineering"}` and gets back people with matching skills — without knowing that a semantic search happened first. This is out of scope for phase 1 but informs the naming and abstraction choices below.

## Design

### Neo4j Storage

**Node: SavedQuery**

| Property | Type | Notes |
|----------|------|-------|
| `savedQueryId` | String (UUID) | Stable identifier, immutable after creation |
| `key` | String | Unique within owning ontology (`^[a-z][a-z0-9_-]*$`) |
| `name` | String | Display name |
| `description` | String | Required — the agent uses this to choose the right query |
| `cypher` | String | Parameterized Cypher template using `$param` syntax |
| `parameters` | String (JSON) | Serialized array of parameter definitions |
| `_ontologyKey` | String | Owning ontology key — denormalized because Neo4j's SEARCH WHERE clause can only filter on node properties, not relationships |
| `_embedding` | List of Float | Vector embedding of the description field (set when embedding provider is configured) |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

**Relationship:** `(Ontology)-[:HAS_SAVED_QUERY]->(SavedQuery)`

**Constraint:** `CREATE CONSTRAINT saved_query_id_unique IF NOT EXISTS FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE`

Key uniqueness is per-ontology, enforced by MERGE on the ontology + key combination (same pattern as `AiAgentConfig`).

**Parameters** are stored as a JSON string because they are always read and written as a unit, never queried individually. Each parameter definition:

```json
[
  {
    "name": "skillId",
    "description": "The _id of the skill entity",
    "dataType": "string"
  }
]
```

- `name` — matches the `$param` reference in the Cypher template
- `description` — explains what the parameter is for (included in tool output for agent context)
- `dataType` — one of: `string`, `integer`, `float`, `boolean`, `date`, `datetime` (reuses existing property data types)
- All parameters are required. No optional parameters — keeps validation simple and forces the agent to always provide everything.

### Cypher Validation at Creation Time

When a saved query is created or updated, the Cypher goes through the same validation pipeline as `execute_cypher_query`:

1. Schema key validation (labels and relationship types must exist in the ontology scope)
2. Read-only check (no writes, no CALL)
3. Label/type rewriting validation

This catches errors at design time, not at runtime when an agent calls it. The `$param` references in the Cypher must be recognized and allowed by the parser — they are standard Cypher parameter syntax and should pass through validation unchanged.

### Modeling CRUD

Same layered pattern as AI agents (repository → service → router/MCP):

| Operation | REST | MCP Tool |
|-----------|------|----------|
| List | `GET /api/model/ontologies/{key}/saved-queries` | `list_saved_queries` |
| Create/Update | `PUT /api/model/ontologies/{key}/saved-queries/{queryKey}` | `set_saved_query` |
| Delete | `DELETE /api/model/ontologies/{key}/saved-queries/{queryKey}` | `delete_saved_query` |

`set_saved_query` is an upsert (MERGE pattern). On create, validates Cypher against the ontology schema. On update, re-validates. Returns whether the operation was a create or update.

### Runtime Tools

Three tools registered in `ALL_TOOLS` (`runtime/ai_service.py`):

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `list_saved_queries` | — | List of `{ key, name, description, parameters }` | Discover available pre-defined queries and their required parameters. |
| `run_saved_query` | `query_key` (string), `parameters` (object) | `{ "columns": [...], "results": [...] }` | Execute a saved query by name with the required parameters. Returns tabular results. |
| `search_saved_queries` | `query` (string) | List of `{ key, name, description, parameters, score }` | Semantic search over saved query descriptions. Returns the most relevant queries ranked by similarity. |

`run_saved_query` execution:

1. Look up saved query by key from the schema cache
2. Validate all required parameters are present
3. Coerce parameter values to declared data types
4. Pass the Cypher template + parameters to Neo4j (native parameterized execution)
5. Post-process results (same scoped property filtering as `cypher_query`)

The return format matches `cypher_query` — agents and consumers don't need to handle a different shape.

### Semantic Search over Saved Queries

`search_saved_queries` enables agents and callers to find the right saved query by describing intent in natural language, rather than listing all queries and scanning manually. The search operates on the `description` field only — at write time (create/update), the description is embedded via the configured embedding provider and stored as `_embedding` on the SavedQuery node.

A dedicated vector index (`saved_query_embedding`) on SavedQuery nodes supports this search. Queries are scoped to a single ontology via in-index filtering on a stored `_ontologyKey` property.

**REST:** `GET /api/runtime/{ontologyKey}/saved-queries/search?q=...&limit=3&min_score=0.7` — limit and min_score are optional with conservative defaults.

**MCP/Agent tools:** `search_saved_queries(query)` — limit (3) and min_score (0.7) are fixed to avoid overloading LLM context. Only the query string is exposed as a parameter.

The response format extends `list_saved_queries` with an additional `score` field (cosine similarity, 0–1).

### Runtime MCP

All three tools are exposed as MCP tools on the runtime MCP server (`/mcp/runtime/{ontologyKey}`), following the same pattern as existing runtime tools.

### Agent Tool Selection

`list_saved_queries`, `run_saved_query`, and `search_saved_queries` become selectable in AI agent tool lists (validated against `ALL_TOOLS`). `search_saved_queries` requires an embedding provider — it is automatically excluded when none is configured. A minimal agent optimized for small models might use only:

```json
{ "tools": ["search_saved_queries", "run_saved_query"] }
```

Or, if the available queries are baked into the system prompt:

```json
{ "tools": ["run_saved_query"] }
```

### Export/Import

New model in `core/schemas.py`:

```python
class ExportSavedQuery(BaseModel):
    key: str
    name: str
    description: str
    cypher: str
    parameters: list[ExportSavedQueryParameter]
```

```python
class ExportSavedQueryParameter(BaseModel):
    name: str
    description: str
    data_type: str = Field(alias="dataType")
```

Added to `ExportOntology`:

```python
class ExportOntology(BaseModel):
    ...
    saved_queries: list[ExportSavedQuery] = Field(default_factory=list, alias="savedQueries")
```

Import validates the Cypher of each saved query against the ontology's schema, same as creation.

### Cascading Deletes

Deleting an ontology cascades to its saved queries (same as AI agents). Deleting or removing an entity type or relation type from an ontology's scope may invalidate saved queries that reference them — this should produce a validation warning, not a silent cascade delete.

## Impact on Existing Code

| File | Change |
|------|--------|
| `core/database.py` | New constraint for `SavedQuery`; `saved_query_embedding` vector index creation on startup |
| `core/schemas.py` | `ExportSavedQuery`, `ExportSavedQueryParameter` models; add to `ExportOntology` |
| `core/ai.py` | `SavedQueryConfig` dataclass for runtime loading |
| `modeling/schemas.py` | Request/response models for saved query CRUD |
| `modeling/repository.py` | CRUD Cypher queries (MERGE upsert with `_ontologyKey` and `_embedding`, list, delete, export) |
| `modeling/service.py` | Validation logic, Cypher validation at creation, description embedding at write time, export/import with embedding regeneration |
| `modeling/router.py` | REST endpoints |
| `mcp/modeling.py` | `set_saved_query`, `delete_saved_query`, `list_saved_queries` tools |
| `runtime/ai_service.py` | Register `list_saved_queries` + `run_saved_query` + `search_saved_queries` in `ALL_TOOLS` |
| `runtime/service.py` | Load saved queries into `LoadedSchema`, execution logic, `search_saved_queries` service function |
| `runtime/repository.py` | Load saved queries for schema cache; `search_saved_queries` vector search query |
| `runtime/router.py` | `GET /saved-queries/search` REST endpoint |
| `mcp/runtime.py` | `list_saved_queries` + `run_saved_query` + `search_saved_queries` MCP tools |
| `docs/architecture.md` | `SavedQuery` node in storage model, `HAS_SAVED_QUERY` relationship |
| `docs/mcp-architecture.md` | New tools in modeling and runtime catalogs |
| `docs/api-contracts/` | New endpoints in modeling and runtime contracts |

## Format Version

Adding `savedQueries` to `ExportOntology` is a backwards-compatible addition (defaults to empty list). Existing v2.1 exports without the field import cleanly. No format version bump needed.
