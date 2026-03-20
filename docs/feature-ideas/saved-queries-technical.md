# Saved Queries — Technical Architecture

## Storage Model

SavedQuery nodes store pre-defined, parameterized query pipelines per ontology.

**Node properties:**
| Property | Type | Description |
|----------|------|-------------|
| `savedQueryId` | UUID string | Unique identifier |
| `key` | string | Unique within ontology, pattern `^[a-z][a-z0-9_-]*$` |
| `name` | string | Display name |
| `description` | string | Required description |
| `steps` | JSON string | Serialized array of pipeline step definitions |
| `parameters` | JSON string | Serialized list of `{name, description, dataType}` |
| `_ontologyKey` | string | Owning ontology key (denormalized for in-index vector filtering) |
| `_embedding` | float list | Vector embedding of the description field |
| `createdAt` | datetime | Auto-set on creation |
| `updatedAt` | datetime | Auto-set on creation and update |

**Relationships:** `(Ontology)-[:HAS_SAVED_QUERY]->(SavedQuery)`

**Cascade:** Deleting an Ontology cascades to its SavedQuery nodes via `OPTIONAL MATCH ... DETACH DELETE`.

**Constraint:** `saved_query_id_unique` ensures `savedQueryId` uniqueness.

## Step Types

Each step in the pipeline has a `name` (unique within the query), a `type`, and type-specific fields.

### Cypher Step

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Step identifier for binding references |
| `type` | Yes | `"cypher"` |
| `cypher` | Yes | Parameterized Cypher query with `$param` placeholders |
| `bindings` | No | Dict mapping param names to `{{stepName.fieldName}}` expressions |

### Semantic Search Step

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Step identifier |
| `type` | Yes | `"semantic_search"` |
| `entityTypeKey` | Yes | Entity type to search |
| `query` | Yes | Search query text (supports `$param_name` substitution) |
| `limit` | No | Max results, default 10 (1–100) |
| `minScore` | No | Minimum similarity score (0.0–1.0) |
| `bindings` | No | Dict mapping param names to `{{stepName.fieldName}}` expressions |

## Pipeline Validation

Validation is **collect-all-errors** (not fail-fast), returning all issues in a single response with paths like `steps[0].cypher`, `steps[1].bindings.skill_ids`.

**Structural checks:**
- Steps array non-empty (enforced by Pydantic `min_length=1`)
- Valid step types (enforced by Pydantic `StepType` enum)
- Step `name` uniqueness across all steps
- Cypher steps must have non-empty `cypher` field
- Semantic search steps must have `entityTypeKey` and `query`

**Binding reference checks:**
- Each `{{stepName.fieldName}}` must reference a step name that appears *before* the current step
- Invalid expression syntax is flagged

**Parameter cross-checks:**
- All `$param` references in Cypher queries (minus those provided by bindings) must be declared as parameters
- All `$param` references in semantic search `query` fields must be declared
- All declared parameters must be referenced somewhere in the pipeline
- Parameters supplied by bindings are excluded from the "must be declared" check

**Cypher validation** (when scoped schema is available):
- Each cypher step's query goes through `validate_and_rewrite()` — schema label validation, read-only check, no CALL

## Parameter Handling

All declared parameters are required at execution time. Parameter values are coerced from JSON to declared data types using the existing `coerce_value()` pipeline.

Parameters are passed to Neo4j as native parameterized query arguments — they are **never** interpolated into Cypher strings. This prevents injection and leverages Neo4j's query plan caching.

For semantic search steps, `$param_name` in the `query` field is resolved via string substitution before passing to the embedding provider.

**Supported data types:** string, integer, float, boolean, date, datetime.

## Runtime Execution Flow

The pipeline engine in `execute_saved_query()`:

1. **Cache lookup** — `_load_schema()` loads `SavedQueryConfig` objects with `steps: list[StepConfig]` into `LoadedSchema.saved_queries`
2. **Parameter validation** — verify all declared parameters are present; reject missing or extra
3. **Type coercion** — coerce each parameter value to its declared data type
4. **Pipeline execution** — for each step in order:
   - **Resolve bindings** — `_resolve_bindings()` evaluates `{{stepName.fieldName}}` expressions against the step results context, collecting the named field from all rows into a list
   - **Dispatch by type:**
     - **cypher** — merge user params + resolved bindings, `validate_and_rewrite()` the Cypher, execute via `repository.execute_cypher_read()`, strip out-of-scope properties
     - **semantic_search** — substitute `$param` references in query text, call `semantic_search()` service, flatten results (entity dicts with `_score`)
   - **Store results** — step output rows are stored in the context dict keyed by step name
5. **Return last step's output** — the final step determines the response shape

### Binding Resolution

`_resolve_bindings()` parses `{{stepName.fieldName}}` expressions:

- Looks up `stepName` in the results context
- Collects `fieldName` from each row, skipping rows where the field is absent
- Returns a list (even if empty)

Example: `"bindings": {"skill_ids": "{{skills._id}}"}` with step "skills" returning `[{_id: "a"}, {_id: "b"}]` resolves to `{"skill_ids": ["a", "b"]}`.

### Semantic Search Step Output

Semantic search results are flattened for binding compatibility: each result's entity dict becomes a row with an added `_score` field. This allows subsequent steps to reference `{{searchStep._id}}` or any entity property.

## Data Models

### Core (`core/ai.py`)

```python
@dataclass
class StepConfig:
    name: str
    type: str  # "cypher" or "semantic_search"
    cypher: str | None
    entity_type_key: str | None
    query: str | None
    limit: int | None
    min_score: float | None
    bindings: dict[str, str] | None

@dataclass
class SavedQueryConfig:
    key: str
    name: str
    description: str
    steps: list[StepConfig]
    parameters: list[SavedQueryParameter]
```

### Modeling Schemas (`modeling/schemas.py`)

```python
class StepType(str, Enum):
    CYPHER = "cypher"
    SEMANTIC_SEARCH = "semantic_search"

class StepSchema(BaseModel):
    name: str
    type: StepType
    cypher: str | None
    entity_type_key: str | None  # alias: entityTypeKey
    query: str | None
    limit: int | None  # 1–100
    min_score: float | None  # 0.0–1.0, alias: minScore
    bindings: dict[str, str] | None
```

### Export (`core/schemas.py`)

```python
class ExportSavedQueryStep(BaseModel):
    name: str
    type: str
    cypher: str | None
    entity_type_key: str | None  # alias: entityTypeKey
    query: str | None
    limit: int | None
    min_score: float | None  # alias: minScore
    bindings: dict[str, str] | None

class ExportSavedQuery(BaseModel):
    key: str
    name: str
    description: str
    steps: list[ExportSavedQueryStep]
    parameters: list[ExportSavedQueryParameter]
```

## Tool Registry Integration

Three tools registered in `VALID_AGENT_TOOLS`:
- `list_saved_queries` — returns `{key, name, description, steps, parameters}` from the loaded schema cache
- `run_saved_query` — calls `service.execute_saved_query()` (pipeline engine)
- `search_saved_queries` — semantic search over saved query descriptions

Exposure:
- **AI chat** — available as PydanticAI tools in the agent runtime
- **Runtime MCP** — registered on the runtime MCP server at `/mcp/runtime/{ontology_key}`
- **Agent config UI** — appear as checkboxes in the AiAgentForm

## MCP Modeling Tool

`set_saved_query` accepts:
- `ontology_key`, `key`, `name`, `description`
- `steps` — list of step dicts with `name`, `type`, and type-specific fields
- `parameters` — list of parameter dicts with `name`, `description`, `dataType`

The tool description includes a complete example of a multi-step pipeline with semantic search and Cypher binding.

## Export/Import

Format version **2.2** replaces `cypher: str` with `steps: list[ExportSavedQueryStep]` on `ExportSavedQuery`.

On import:
- Steps are converted to `StepSchema` objects for pipeline validation
- Cypher steps are validated against the schema (when available)
- Descriptions are re-embedded if an embedding provider is configured
- `_ontologyKey` is set from the importing ontology

## Semantic Search over Saved Queries

Saved queries support semantic search by description. The search operates on the `description` field only — at write time, the description is embedded and stored as `_embedding`.

**Ontology scoping:** A denormalized `_ontologyKey` property enables in-index filtering (Neo4j SEARCH WHERE can only filter on node properties, not relationships).

**Vector index:** `saved_query_embedding` on SavedQuery nodes, includes `_ontologyKey` for scoping.

## Known Limitations

- **Schema changes don't proactively invalidate saved queries.** Queries fail at execution time with clear validation errors.
- **No conditional branching.** Pipelines are strictly sequential. Empty results flow through as empty lists.
- **No loops.** Use `IN` clauses for batch operations.
- **`{{step.field}}` always produces a flat list.** No complex transformations — Cypher handles aggregation.
- **Only `cypher` and `semantic_search` step types.** Other runtime tools (list_entities, get_neighbors) can be expressed as Cypher.
- **Steps stored as JSON blob.** No individual step querying in Neo4j.

## Integration Test Recommendations

| Test | What It Verifies |
|------|-----------------|
| Saved query CRUD round-trip | Create, read, update, delete. Verify cascade on ontology deletion. |
| Single-step cypher execution | Create a single-cypher-step query, seed data, execute with params, verify results. |
| Multi-step pipeline execution | Create a semantic_search → cypher pipeline, seed data, verify binding resolution and correct results. |
| Parameter type coercion | Pass string "42" for integer param, verify Neo4j receives correct type. |
| Pipeline validation errors | Verify all validation checks (duplicate names, invalid bindings, missing fields) return proper errors. |
| Export/import with saved queries | Export schema with pipeline queries, wipe, re-import, verify queries survive and execute. |
| MCP modeling tools | Call `set_saved_query` with multi-step pipeline via MCP client. |
| MCP runtime tools | Call `list_saved_queries` and `run_saved_query` via MCP client with seeded data. |
| Semantic search over saved queries | Create queries with descriptions, search by intent, verify ranking. |
