# Saved Queries

> Pre-defined, parameterized query pipelines stored per ontology — enabling reliable, token-efficient querying for small models without raw Cypher composition.

## Purpose

The `execute_cypher_query` tool is powerful but demands that the model compose valid Cypher from scratch: correct label keys, relationship types, property names, `$param` syntax. For large models with a well-crafted system prompt, this works. For smaller, cheaper models that should handle routine lookups, it's fragile and wastes tokens on query construction.

Saved queries flip this: the ontology designer pre-defines named, parameterized pipelines at design time. At runtime, the agent picks a query by name, fills in the parameters, and gets results. The agent never sees Cypher.

### Example: Simple Cypher Query

A talent ontology designer creates a saved query `people_by_skill`:

```
Steps:     [{ name: "main", type: "cypher", cypher: "MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id = $skillId RETURN p.name" }]
Parameters:  skillId (string) — The _id of the skill to search for
```

An agent configured with only `list_saved_queries` + `run_saved_query` calls:

```json
run_saved_query({ "query_key": "people_by_skill", "params": { "skillId": "3bd5..." } })
```

No Cypher knowledge required.

### Example: Multi-Step Pipeline

A more advanced saved query `find_skilled_persons` chains semantic search with Cypher:

```
Steps:
  1. { name: "skills", type: "semantic_search", entityTypeKey: "skill", query: "$skill_query", limit: 5 }
  2. { name: "results", type: "cypher", cypher: "MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id IN $skill_ids RETURN p", bindings: { skill_ids: "{{skills._id}}" } }
Parameters:  skill_query (string) — Natural language description of the skill
```

The agent provides `{"skill_query": "data engineering"}` and gets back people with matching skills — without knowing that a semantic search happened first. The pipeline is transparent to the caller.

## Design

### Pipeline Model

Each saved query is an **ordered pipeline of steps**. Steps execute sequentially, and data flows between them via **bindings**.

**Step types:**

| Type | Required Fields | Description |
|------|----------------|-------------|
| `cypher` | `cypher` | Execute a parameterized Cypher query |
| `semantic_search` | `entityTypeKey`, `query` | Run semantic search on an entity type |

**Common fields** (all steps):

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the step (used in binding references) |
| `type` | Yes | `cypher` or `semantic_search` |
| `bindings` | No | Dict mapping parameter names to `{{stepName.fieldName}}` expressions |

**Semantic search optional fields:** `limit` (default 10), `minScore`.

### Data Flow Between Steps

Two reference syntaxes:

| Syntax | Where Used | Resolves To |
|--------|-----------|-------------|
| `$param_name` | Cypher `$param` placeholders, semantic search `query` field | User-provided parameter value |
| `{{stepName.fieldName}}` | Step `bindings` values | List of that field's values from all rows of the named step's output |

Bindings are resolved before each step executes. For cypher steps, resolved bindings are merged with user params to form the Cypher parameter map. For example, `"bindings": {"skill_ids": "{{skills._id}}"}` collects all `_id` values from the "skills" step's results into a list, then makes it available as `$skill_ids` in the Cypher query.

### Neo4j Storage

**Node: SavedQuery**

| Property | Type | Notes |
|----------|------|-------|
| `savedQueryId` | String (UUID) | Stable identifier, immutable after creation |
| `key` | String | Unique within owning ontology (`^[a-z][a-z0-9_-]*$`) |
| `name` | String | Display name |
| `description` | String | Required — the agent uses this to choose the right query |
| `steps` | String (JSON) | Serialized array of step definitions |
| `parameters` | String (JSON) | Serialized array of parameter definitions |
| `_ontologyKey` | String | Owning ontology key (denormalized for in-index vector filtering) |
| `_embedding` | List of Float | Vector embedding of the description field |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

**Relationship:** `(Ontology)-[:HAS_SAVED_QUERY]->(SavedQuery)`

**Parameters** are stored as a JSON string. Each parameter definition:

```json
{ "name": "skillId", "description": "The _id of the skill entity", "dataType": "string" }
```

All parameters are required. Supported data types: string, integer, float, boolean, date, datetime.

### Pipeline Validation at Creation Time

When a saved query is created or updated, the pipeline goes through comprehensive validation (collect-all-errors, not fail-fast):

1. **Steps non-empty** — at least one step required
2. **Valid step types** — must be `cypher` or `semantic_search`
3. **Step name uniqueness** — no duplicate names
4. **Binding reference validity** — `{{stepName.fieldName}}` must reference a step that appears *before* the current step
5. **Cypher steps validated** — Cypher goes through `validate_and_rewrite()` (schema labels, read-only check)
6. **Parameter cross-check** — all `$param` references across all steps (Cypher and semantic search `query` fields) must be covered by declared parameters or bindings, and all declared parameters must be referenced somewhere

### Modeling CRUD

| Operation | REST | MCP Tool |
|-----------|------|----------|
| List | `GET /api/model/ontologies/{key}/saved-queries` | `list_saved_queries` |
| Create/Update | `PUT /api/model/ontologies/{key}/saved-queries/{queryKey}` | `set_saved_query` |
| Delete | `DELETE /api/model/ontologies/{key}/saved-queries/{queryKey}` | `delete_saved_query` |

`set_saved_query` is an upsert (MERGE pattern). Accepts `steps` (list of step definitions) and `parameters` (list of parameter definitions).

### Runtime Tools

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `list_saved_queries` | — | List of `{ key, name, description, steps, parameters }` | Discover available queries and their structure |
| `run_saved_query` | `query_key`, `params` | Last step's output | Execute a saved query pipeline by name |
| `search_saved_queries` | `query` | List of `{ key, name, description, parameters, score }` | Semantic search over saved query descriptions |

`run_saved_query` execution:

1. Look up saved query by key from the schema cache
2. Validate all required parameters are present
3. Coerce parameter values to declared data types
4. Execute pipeline steps sequentially, resolving bindings between steps
5. Return the last step's output

### Pipeline Execution Engine

For each step in order:

1. **Resolve bindings** — evaluate `{{stepName.fieldName}}` expressions against previous step results
2. **Dispatch by type:**
   - **cypher** — merge user params + resolved bindings, validate & rewrite Cypher, execute, strip out-of-scope properties
   - **semantic_search** — substitute `$param` in query text, call semantic search service with entity type, limit, min_score
3. **Store results** in the step context (keyed by step name)
4. **Return the last step's output** to the caller

### Semantic Search over Saved Queries

`search_saved_queries` enables agents to find the right saved query by describing intent in natural language. The search operates on the `description` field — at write time, the description is embedded via the configured embedding provider and stored as `_embedding`.

### What's Possible

- **Single Cypher query** — the simplest case: one cypher step (equivalent to the original design)
- **Semantic search → Cypher** — search entities by description, use results in a follow-up Cypher query
- **Cypher → Cypher chaining** — run a broad query, then use IDs in a more targeted query
- **Multiple semantic searches** — search different entity types, then join results in a Cypher step
- **Semantic search as final step** — skip Cypher entirely, just return search results directly

### Limitations

| Limitation | Why It's Acceptable |
|------------|-------------------|
| Only `cypher` and `semantic_search` step types | Everything the other runtime tools do (list_entities, get_neighbors) can be expressed as Cypher. Semantic search is the one capability that can't. |
| `{{step.field}}` always produces a flat list | Cypher handles filtering/aggregation. Use `limit` on semantic_search for "top N". |
| No conditional branching | Keeps the engine deterministic. Empty results from step 1 pass empty lists to step 2. |
| Strictly sequential execution | Easy to reason about. For "search two types", do two sequential steps and combine in a Cypher `UNWIND`. |
| No loops | Batch via `IN` clauses handles iteration: `WHERE s._id IN $skill_ids`. |
| Steps stored as JSON blob | Saved queries are always loaded/saved as a whole unit. |

### Export/Import

Export format version **2.2** includes `steps` on `ExportSavedQuery` (replacing the old `cypher` field from 2.1).

### Cascading Deletes

Deleting an ontology cascades to its saved queries. Removing entity types from an ontology scope may invalidate saved queries that reference them — this produces a validation error at execution time.

## Format Version

Adding `steps` to `ExportSavedQuery` (replacing `cypher`) is a breaking change from v2.1. Format version bumped to **2.2**.
