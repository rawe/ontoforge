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
| `exampleQuestions` | string list | Natural-language questions the query answers |
| `steps` | JSON string | Serialized array of pipeline step definitions |
| `parameters` | JSON string | Serialized list of `{name, description, dataType, default?, entityTypeKey?}` |
| `maxRows` | integer | Optional per-cypher-step row cap (absent → 1000) |
| `_ontologyKey` | string | Owning ontology key (denormalized for in-index vector filtering) |
| `_embedding` | float list | Vector embedding of description + example questions |
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

Bindings are not allowed on semantic search steps — parameter values flow into the `query` text via `$param` substitution only.

## Pipeline Validation

Validation is **collect-all-errors** (not fail-fast), returning all issues in a single response with paths like `steps[0].cypher`, `steps[1].bindings.skill_ids`.

**Structural checks:**
- Steps array non-empty (enforced by Pydantic `min_length=1`)
- Valid step types (enforced by Pydantic `StepType` enum)
- Step `name` uniqueness across all steps
- Cypher steps must have non-empty `cypher` field
- Semantic search steps must have `entityTypeKey` and `query`, and no `bindings`

**Binding reference checks:**
- Each `{{stepName.fieldName}}` must reference a step name that appears *before* the current step
- Binding names must not shadow declared parameters
- Invalid expression syntax is flagged

**Per-step parameter coverage:**
- Every `$param` reference in a cypher step must be satisfied by a declared parameter or by *that step's own* bindings — bindings are resolved per step at execution time, so a binding declared on another step does not cover the reference
- Every `$param` reference in a semantic search `query` field must be a declared parameter
- All declared parameters must be referenced in at least one step

**Parameter definition checks** (`_validate_parameter_defs`):
- Parameter names unique
- A `default` value must coerce to the declared data type (checked with `coerce_value()` at save time)
- `entity_ref` parameters require `entityTypeKey`; other types must not set it

**Schema validation** (when the runtime schema is available, `_validate_against_schema`):
- Each cypher step's query goes through `validate_and_rewrite()` — schema label validation, read-only check, no CALL
- Semantic step `entityTypeKey` and entity_ref parameter `entityTypeKey` must exist in the ontology scope

## Parameter Handling

Parameters without a `default` are required at execution time; parameters with a `default` may be omitted and receive the default. Parameter values are coerced from JSON to declared data types using the existing `coerce_value()` pipeline (`entity_ref` values coerce as strings).

Parameters are passed to Neo4j as native parameterized query arguments — they are **never** interpolated into Cypher strings. This prevents injection and leverages Neo4j's query plan caching.

For semantic search steps, `$param_name` in the `query` field is resolved via string substitution before passing to the embedding provider.

**Supported data types:** string, integer, float, boolean, date, datetime, entity_ref (`ParamDataType` enum in the modeling schemas).

### entity_ref Resolution

`_resolve_entity_ref()` turns an `entity_ref` parameter value into an entity `_id`:

1. **Direct match** — if the value is an existing `_id` of the declared entity type, it is used as-is (`matched: "id"`).
2. **Semantic resolution** — otherwise the value is treated as a natural-language reference and resolved via `semantic_search()` over the parameter's entity type (entities only, top 5). The top hit is accepted when its score is at least `ENTITY_REF_MIN_SCORE` (0.75) → `matched: "semantic"` with the score.
3. **Failure** — no acceptable hit raises a `ValidationError` whose details carry a `candidates` list (`_id`, `score`, up to three short string properties per candidate), so callers — particularly LLM agents — can pick an `_id` and retry.

Semantic resolution requires an embedding provider; without one, non-`_id` values fail with a clear error. Resolutions are reported in the run response under `resolvedParameters`.

## Runtime Execution Flow

The pipeline engine in `execute_saved_query()`:

1. **Cache lookup** — `_load_schema()` loads `SavedQueryConfig` objects (steps, parameters with defaults, example questions, max rows) into `LoadedSchema.saved_queries`
2. **Parameter validation** — parameters without a default must be present; unknown parameters are rejected
3. **Defaults + type coercion** — omitted optional parameters take their default; all values are coerced to their declared data types
4. **entity_ref resolution** — see above
5. **Pipeline execution** — for each step in order:
   - **Resolve bindings** — `_resolve_bindings()` evaluates `{{stepName.fieldName}}` expressions against the step results context, collecting the named field from all rows into a list
   - **Dispatch by type:**
     - **cypher** — merge user params + resolved bindings, `validate_and_rewrite()` the Cypher, execute via `repository.execute_cypher_read()` with the row cap, strip out-of-scope properties
     - **semantic_search** — substitute `$param` references in query text, call `semantic_search()` service, flatten results (entity dicts with `_score`)
   - **Record diagnostics** — step name, type, row count, and (cypher) truncation flag
   - **Store results** — step output rows are stored in the context dict keyed by step name
6. **Return last step's output** — the final step determines the response shape; a `pipeline` list (per-step diagnostics) and, when entity_ref parameters exist, `resolvedParameters` are attached to the response

### Row Cap

`DEFAULT_SAVED_QUERY_MAX_ROWS` (1000) applies per cypher step unless the query declares its own `maxRows` (1–10000). `execute_cypher_read()` stops consuming the Neo4j result after `max_rows + 1` rows; the extra row signals truncation, which is reported per step in the `pipeline` diagnostics. Semantic search steps are bounded by their `limit` (max 100).

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
class SavedQueryParameter:
    name: str
    description: str
    data_type: str
    default: str | int | float | bool | None = None  # non-None → optional
    entity_type_key: str | None = None  # entity_ref only

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
    example_questions: list[str]
    max_rows: int | None
```

### Modeling Schemas (`modeling/schemas.py`)

`StepType` (cypher | semantic_search) and `ParamDataType` (scalars + entity_ref) enums; `StepSchema`, `SavedQueryParameterSchema` (with `default`, `entityTypeKey`), `SavedQueryUpsert`/`SavedQueryResponse` (with `exampleQuestions`, `maxRows`), and `SavedQueryHealthResponse` for the health check. See `api-contracts/modeling-api.md` §12 for the wire shapes.

### Export (`core/schemas.py`)

`ExportSavedQuery` mirrors the upsert shape: `key`, `name`, `description`, `exampleQuestions`, `steps`, `parameters` (with `default`/`entityTypeKey`), `maxRows`.

## Tool Registry Integration

Three generic tools registered in `VALID_AGENT_TOOLS`:
- `list_saved_queries` — returns `{key, name, description, exampleQuestions, parameters}` from the loaded schema cache; steps are omitted (agents never need the Cypher). Parameter entries carry a computed `required` flag (false when a default exists).
- `run_saved_query` — calls `service.execute_saved_query()` (pipeline engine)
- `search_saved_queries` — semantic search over saved queries, agent-tunable `limit` (default 5), min score 0.5

Exposure:
- **AI chat** — available as PydanticAI tools in the agent runtime
- **Runtime MCP** — registered on the runtime MCP server at `/mcp/runtime/{ontology_key}`
- **Agent config UI** — appear as checkboxes in the AiAgentForm

## Dynamic MCP Tools

`RuntimeFastMCP` (subclass of FastMCP in `mcp/runtime.py`) overrides `list_tools`/`call_tool` to expose each saved query of the request's ontology as its own MCP tool:

- **Name** — `query_<key>` (`SAVED_QUERY_TOOL_PREFIX`)
- **Title** — the query name; **description** — description + example questions
- **Input schema** — generated from the parameter definitions (`_saved_query_input_schema`): JSON types per data type (`float` → `number`, `date`/`datetime` → string with format, `entity_ref` → string with resolution hint), `default` values, and a `required` list of exactly the parameters without defaults
- **Dispatch** — `call_tool` routes `query_*` names through the same `run_saved_query` path; unknown keys fall through to the static tools

The ontology key comes from the request-scoped contextvar set by `OntologyKeyMiddleware`, so each mount advertises exactly its ontology's queries. The tool list changes whenever saved queries change (served from the schema cache).

## MCP Modeling Tools

- `set_saved_query` — accepts `ontology_key`, `key`, `name`, `description`, `steps`, `parameters`, `example_questions`, `max_rows`. The tool description documents the step model, parameter defaults, and entity_ref semantics with a complete multi-step example.
- `check_saved_queries` — the health check (below) over MCP.

## Health Check

`saved_query_health()` (modeling service) re-runs the full validation stack — parameter definitions, pipeline structure, schema validation — for every saved query of an ontology against the *current* schema, without executing anything. Returns per-query `{key, name, valid, errors}` plus an aggregate `valid` flag.

- REST: `GET /api/model/ontologies/{key}/saved-queries/health`
- MCP: `check_saved_queries`
- Studio: the SavedQueriesTab fetches the health report and shows a "broken" badge (with the errors as tooltip) on queries invalidated by schema or scope changes

## Export/Import

Format version **2.3**. On import:
- Steps and parameters are converted to modeling schemas for the same validation as the upsert path
- Descriptions + example questions are re-embedded if an embedding provider is configured
- `_ontologyKey` is set from the importing ontology

## Semantic Search over Saved Queries

The embedded text is the description joined with the example questions (`_embedding_text()`); the same text is used by the rebuild-embeddings pipeline.

**Ontology scoping:** A denormalized `_ontologyKey` property enables in-index filtering (Neo4j SEARCH WHERE can only filter on node properties, not relationships).

**Vector index:** `saved_query_embedding` on SavedQuery nodes, includes `_ontologyKey` for scoping.

## Known Limitations

- **No conditional branching.** Pipelines are strictly sequential. Empty results flow through as empty lists; the `pipeline` diagnostics show which step ran dry.
- **No loops.** Use `IN` clauses for batch operations.
- **`{{step.field}}` always produces a flat list.** No complex transformations — Cypher handles aggregation.
- **Only `cypher` and `semantic_search` step types.** Other runtime tools (list_entities, get_neighbors) can be expressed as Cypher.
- **Steps stored as JSON blob.** No individual step querying in Neo4j.
- **Schema changes don't proactively invalidate saved queries.** The health check (and its Studio badge) surfaces broken queries; execution fails with clear validation errors.
