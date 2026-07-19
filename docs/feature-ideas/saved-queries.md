# Saved Queries

> Pre-defined, parameterized query pipelines stored per ontology — enabling reliable, token-efficient querying for small models without raw Cypher composition.

## Purpose

The `execute_cypher_query` tool is powerful but demands that the model compose valid Cypher from scratch: correct label keys, relationship types, property names, `$param` syntax. For large models with a well-crafted system prompt, this works. For smaller, cheaper models that should handle routine lookups, it's fragile and wastes tokens on query construction.

Saved queries flip this: the ontology designer pre-defines named, parameterized pipelines at design time. At runtime, the agent picks a query by name — or calls it directly as a typed MCP tool — fills in the parameters, and gets results. The agent never sees Cypher.

### Example: Simple Cypher Query

A talent ontology designer creates a saved query `people_by_skill`:

```
Steps:      [{ name: "main", type: "cypher", cypher: "MATCH (p:person)-[:has_skill]->(s:skill) WHERE s._id = $skill RETURN p.name" }]
Parameters: skill (entity_ref → skill) — The skill to search for
Examples:   "Who knows Kubernetes?", "Find people with a given skill"
```

An agent connected to the runtime MCP server sees this as a first-class tool `query_people_by_skill(skill)` and calls it with either a skill `_id` or simply `"kubernetes"` — the entity reference is resolved automatically. Agents restricted to the generic tools instead call:

```json
run_saved_query({ "query_key": "people_by_skill", "params": { "skill": "kubernetes" } })
```

No Cypher knowledge required, and no manual ID lookup.

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

**Cypher-only field:** `bindings` — dict mapping parameter names to `{{stepName.fieldName}}` expressions. Bindings are not supported on semantic search steps.

**Semantic search optional fields:** `limit` (default 10), `minScore`.

### Data Flow Between Steps

Two reference syntaxes:

| Syntax | Where Used | Resolves To |
|--------|-----------|-------------|
| `$param_name` | Cypher `$param` placeholders, semantic search `query` field | User-provided parameter value (or its default) |
| `{{stepName.fieldName}}` | Cypher step `bindings` values | List of that field's values from all rows of the named step's output |

Bindings are resolved before each step executes. For cypher steps, resolved bindings are merged with user params to form the Cypher parameter map. For example, `"bindings": {"skill_ids": "{{skills._id}}"}` collects all `_id` values from the "skills" step's results into a list, then makes it available as `$skill_ids` in the Cypher query. A binding name must not shadow a declared parameter.

### Parameters

Each parameter declares `name`, `description`, and `dataType` — one of `string`, `integer`, `float`, `boolean`, `date`, `datetime`, or `entity_ref`.

- **Optional parameters** — a parameter with a `default` value may be omitted at run time; the default (validated against the data type at save time) is used instead. Parameters without a default are required.
- **Entity references** — `entity_ref` parameters additionally declare an `entityTypeKey`. Callers pass either an entity `_id` of that type or a natural-language reference (a name or description) that is resolved via semantic search. This removes the "look up the ID first" round-trip that LLM callers otherwise need.

### Example Questions

A saved query can carry `exampleQuestions` — natural-language questions it answers ("Who knows Kubernetes?"). They are embedded together with the description for semantic discovery, shown in agent tool descriptions, and double as few-shot material for system prompts.

### Result Limits and Diagnostics

- **`maxRows`** (optional, default 1000) caps the rows each cypher step returns, protecting agent context windows and server memory from unbounded result sets.
- Every run response carries a **`pipeline` block** with per-step row counts and truncation flags, so a caller — human or agent — can see which step ran dry when the final result is empty, and a **`resolvedParameters` block** showing how each `entity_ref` parameter was resolved.

### Neo4j Storage

**Node: SavedQuery** — see `docs/architecture.md` (§ Ontology-Related Nodes) for the property table. Steps and parameters are stored as JSON strings; example questions as a native string list.

**Relationship:** `(Ontology)-[:HAS_SAVED_QUERY]->(SavedQuery)`

### Pipeline Validation at Creation Time

When a saved query is created or updated, the pipeline goes through comprehensive validation (collect-all-errors, not fail-fast):

1. **Steps non-empty** — at least one step required
2. **Valid step types** — must be `cypher` or `semantic_search`
3. **Step name uniqueness** — no duplicate names
4. **Binding reference validity** — `{{stepName.fieldName}}` must reference a step that appears *before* the current step, must not shadow a declared parameter, and is rejected on semantic search steps
5. **Per-step parameter coverage** — every `$param` reference in a step must be satisfied by a declared parameter or by that step's own bindings (bindings of other steps don't count — they are resolved per step at execution time); every declared parameter must be referenced somewhere
6. **Parameter definitions** — defaults must coerce to the declared data type; `entity_ref` parameters must name an `entityTypeKey` that exists in the ontology scope
7. **Schema validation** — Cypher goes through `validate_and_rewrite()` (schema labels, read-only check); semantic step entity types must be in scope

### Modeling CRUD

| Operation | REST | MCP Tool |
|-----------|------|----------|
| List | `GET /api/model/ontologies/{key}/saved-queries` | `list_saved_queries` |
| Create/Update | `PUT /api/model/ontologies/{key}/saved-queries/{queryKey}` | `set_saved_query` |
| Delete | `DELETE /api/model/ontologies/{key}/saved-queries/{queryKey}` | `delete_saved_query` |
| Health check | `GET /api/model/ontologies/{key}/saved-queries/health` | `check_saved_queries` |

`set_saved_query` is an upsert (MERGE pattern). Accepts `steps`, `parameters`, `exampleQuestions`, and `maxRows`.

The **health check** re-validates every saved query against the current schema without executing anything, so queries broken by later schema or scope changes surface in the Studio (a "broken" badge in the saved queries list) instead of failing at agent runtime.

### Runtime Tools

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `list_saved_queries` | — | List of `{ key, name, description, exampleQuestions, parameters }` | Discover available queries. Steps are omitted — callers never need the Cypher. |
| `run_saved_query` | `query_key`, `params` | Last step's output + `pipeline` + `resolvedParameters` | Execute a saved query pipeline by name |
| `search_saved_queries` | `query`, `limit` (default 5) | List of `{ key, name, description, exampleQuestions, parameters, score }` | Semantic search over saved queries (description + example questions) |
| `query_<key>` | The query's own parameters | Same as `run_saved_query` | Each saved query is additionally exposed as its own typed MCP tool with a generated JSON input schema |

`run_saved_query` execution:

1. Look up saved query by key from the schema cache
2. Validate parameters (missing required / unknown), apply defaults
3. Coerce parameter values to declared data types
4. Resolve `entity_ref` parameters to entity `_id`s (direct match or semantic search)
5. Execute pipeline steps sequentially, resolving bindings between steps and capping cypher rows at `maxRows`
6. Return the last step's output with pipeline diagnostics

### Saved Queries as Typed MCP Tools

The runtime MCP server generates one tool per saved query of the connected ontology, named `query_<key>`. The tool description combines name, description, and example questions; the input schema is generated from the parameter definitions (types, defaults, required list). For LLM agents this is the most reliable calling convention — the MCP client validates arguments against the schema before the request ever reaches the server. The generic `list/run/search` tools remain for discovery-driven flows.

### Semantic Search over Saved Queries

`search_saved_queries` enables agents to find the right saved query by describing intent in natural language. At write time, the description and example questions are embedded via the configured embedding provider and stored as `_embedding`.

### What's Possible

- **Single Cypher query** — the simplest case: one cypher step
- **Semantic search → Cypher** — search entities by description, use results in a follow-up Cypher query
- **Cypher → Cypher chaining** — run a broad query, then use IDs in a more targeted query
- **Multiple semantic searches** — search different entity types, then join results in a Cypher step
- **Semantic search as final step** — skip Cypher entirely, just return search results directly

### Limitations

| Limitation | Why It's Acceptable |
|------------|-------------------|
| Only `cypher` and `semantic_search` step types | Everything the other runtime tools do (list_entities, get_neighbors) can be expressed as Cypher. Semantic search is the one capability that can't. |
| `{{step.field}}` always produces a flat list | Cypher handles filtering/aggregation. Use `limit` on semantic_search for "top N". |
| No conditional branching | Keeps the engine deterministic. Empty results from step 1 pass empty lists to step 2 — the `pipeline` block shows where results ran dry. |
| Strictly sequential execution | Easy to reason about. For "search two types", do two sequential steps and combine in a Cypher `UNWIND`. |
| No loops | Batch via `IN` clauses handles iteration: `WHERE s._id IN $skill_ids`. |
| Steps stored as JSON blob | Saved queries are always loaded/saved as a whole unit. |

### Export/Import

Export format version **2.3**: `ExportSavedQuery` carries `steps`, `parameters` (with `default`/`entityTypeKey`), `exampleQuestions`, and `maxRows`.

### Cascading Deletes

Deleting an ontology cascades to its saved queries. Removing entity types from an ontology scope may invalidate saved queries that reference them — the health check surfaces this in the Studio, and execution fails with a clear validation error.
