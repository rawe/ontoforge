# Saved Queries — Technical Architecture

## Storage Model

SavedQuery nodes store pre-defined, parameterized Cypher queries per ontology.

**Node properties:**
| Property | Type | Description |
|----------|------|-------------|
| `savedQueryId` | UUID string | Unique identifier |
| `key` | string | Unique within ontology, pattern `^[a-z][a-z0-9_-]*$` |
| `name` | string | Display name |
| `description` | string | Required description |
| `cypher` | string | Parameterized Cypher query |
| `parameters` | JSON string | Serialized list of `{name, description, dataType}` |
| `_ontologyKey` | string | Owning ontology key (denormalized for in-index vector filtering) |
| `_embedding` | float list | Vector embedding of the description field |
| `createdAt` | datetime | Auto-set on creation |
| `updatedAt` | datetime | Auto-set on creation and update |

**Relationships:** `(Ontology)-[:HAS_SAVED_QUERY]->(SavedQuery)`

**Cascade:** Deleting an Ontology cascades to its SavedQuery nodes via `OPTIONAL MATCH ... DETACH DELETE`.

**Constraint:** `saved_query_id_unique` ensures `savedQueryId` uniqueness.

## Cypher Validation Pipeline

Saved query Cypher is validated at **creation time** using `validate_and_rewrite()` from the ANTLR-based Cypher engine (`runtime/cypher.py`). This verifies:
- Node labels and relationship types exist in the scoped schema
- No write operations, CALL statements, or bare node patterns

The `$param` syntax is standard Cypher and parses natively through ANTLR — parameters pass through unchanged during rewriting.

**Parameter cross-check** at creation time: `re.findall(r'\$([a-zA-Z_]\w*)', cypher)` extracts parameter references from the Cypher string. The service verifies that every declared parameter appears in the Cypher and vice versa.

At **execution time**, `validate_and_rewrite()` runs again against the current schema, catching cases where schema changes have invalidated the query since creation.

## Parameter Handling

All declared parameters are required at execution time. Parameter values are coerced from JSON to declared data types using the existing `coerce_value()` pipeline from `runtime/service.py`.

Parameters are passed to Neo4j as native parameterized query arguments — they are **never** interpolated into Cypher strings. This prevents injection and leverages Neo4j's query plan caching.

**Supported data types:** string, integer, float, boolean, date, datetime.

## Runtime Execution Flow

1. **Cache lookup** — `_load_schema()` loads `SavedQueryConfig` objects into `LoadedSchema.saved_queries` (deserialized from JSON on each cache build)
2. **Parameter validation** — verify all declared parameters are present; reject missing or extra parameters
3. **Type coercion** — coerce each parameter value to its declared data type via `coerce_value()`
4. **Cypher rewrite** — `validate_and_rewrite()` translates snake_case labels to PascalCase/UPPER_SNAKE_CASE
5. **Parameterized execution** — `execute_cypher_read(session, rewritten, params=coerced_params)` passes parameters natively to Neo4j
6. **Scoped property post-processing** — strip out-of-scope properties from returned nodes/relationships (same logic as `execute_cypher_query`)

## Tool Registry Integration

Three tools are registered in `ALL_TOOLS` via `@_register_tool`:
- `list_saved_queries` — returns `{key, name, description, parameters}` for each saved query from the loaded schema cache
- `run_saved_query` — calls `service.execute_saved_query()`
- `search_saved_queries` — semantic search over saved query descriptions via `service.search_saved_queries()`

All three tools are included in `CHAT_TOOLS`, making them available to all agents by default. `search_saved_queries` requires an embedding provider and is automatically excluded when none is configured (same gating as `semantic_search`). They can be selectively enabled per agent via the `tools` field on `AiAgentConfig`.

Exposure:
- **AI chat** — available as PydanticAI tools in the agent runtime
- **Runtime MCP** — registered on the runtime MCP server at `/mcp/runtime/{ontology_key}`
- **Agent config UI** — `list_saved_queries`, `run_saved_query`, and `search_saved_queries` appear as checkboxes in the AiAgentForm

## Export/Import

The `savedQueries` field on `ExportOntology` defaults to an empty list, maintaining backward compatibility with existing v2.1 exports (no format version bump needed).

On export, parameters are deserialized from JSON and mapped to `ExportSavedQueryParameter` models. On import, parameters are cross-checked against the Cypher string, serialized back to JSON, and stored via `upsert_saved_query`.

## Semantic Search over Saved Queries

Saved queries support semantic search by description, enabling agents and callers to discover the right query by intent rather than by scanning all available queries.

**Embedding at write time:** When a saved query is created or updated, the `description` field is embedded via the configured `EmbeddingProvider` and stored as `_embedding` on the SavedQuery node. Only the description is embedded — name, cypher, and parameters are excluded from the embedding text.

**Ontology scoping:** A denormalized `_ontologyKey` property is stored on each SavedQuery node. This is necessary because the Neo4j SEARCH clause's in-index WHERE can only filter on node properties stored in the vector index — it cannot traverse relationships. Since SavedQuery nodes are linked to ontologies via `[:HAS_SAVED_QUERY]` relationships, scoping by ontology in a single vector search query requires the ontology key to be materialized as a flat property on the node itself. The property is set on both create and update, kept in sync with the owning ontology.

**Vector index:** A `saved_query_embedding` index is created on startup alongside entity type vector indexes. It includes `_ontologyKey` in the WITH clause for in-index filtering.

**Search flow:**
1. Embed the natural language query via the embedding provider
2. Execute a SEARCH clause against the `saved_query_embedding` index with `WHERE sq._ontologyKey = $ontology_key`
3. Filter results by min_score
4. Deserialize parameters JSON and return results in `list_saved_queries`-compatible format plus `score`

**REST endpoint:** `GET /api/runtime/{ontologyKey}/saved-queries/search?q=...` with optional `limit` (default 3) and `min_score` (default 0.7) parameters.

**MCP tool and AI agent tool:** `search_saved_queries(query)` — limit and min_score are fixed constants (3 and 0.7 respectively) to keep LLM context lean. Only the query string is exposed.

**Import:** On schema import, saved query descriptions are re-embedded if an embedding provider is configured, and `_ontologyKey` is set from the ontology being imported.

## Known Limitations

- **Schema changes don't proactively invalidate saved queries.** If an entity type or property referenced by a saved query is removed from the ontology scope, the query will fail at execution time with a clear Cypher validation error.
- **Parameters stored as JSON string.** Individual parameter querying within Neo4j is not supported — parameters must be fully loaded and deserialized.
- **No workflow execution.** Phase 1 backs each saved query with a single Cypher statement. Multi-step workflows (semantic search → Cypher pipelines) are deferred to future phases.

## Integration Test Recommendations

| Test | Location | What It Verifies |
|------|----------|-----------------|
| Saved query CRUD round-trip | `tests/integration/test_saved_queries.py` | Create, read, update, delete a saved query against real Neo4j. Verify cascade on ontology deletion. |
| Saved query execution | `tests/integration/test_saved_queries.py` | Create a saved query with `$param`, seed instance data, call `execute_saved_query` with real parameters, verify correct results from Neo4j. |
| Parameter type coercion | `tests/integration/test_saved_queries.py` | Pass string "42" for an integer parameter, verify Neo4j receives the correct native type and the query works. |
| Export/import with saved queries | `tests/integration/test_schema_operations.py` | Export a schema containing saved queries, wipe, re-import, verify queries survive and execute correctly. |
| MCP modeling tools | `tests/integration/test_mcp_modeling.py` | Call `set_saved_query`, `list_saved_queries`, `delete_saved_query` via MCP client against real server. |
| MCP runtime tools | `tests/integration/test_mcp_runtime.py` | Call `list_saved_queries` and `run_saved_query` via MCP client against real server with seeded data. |
| AI agent with saved query tools | `tests/integration/test_ai.py` | Configure an agent with only `run_saved_query` tool, send a chat message, verify the agent uses the saved query to answer. (Requires AI provider.) |
| Schema change impact | `tests/integration/test_saved_queries.py` | Create a saved query referencing an entity type, remove that type from the ontology scope, verify `run_saved_query` returns a clear validation error. |
| Semantic search over saved queries | `tests/integration/test_saved_queries.py` | Create saved queries with descriptive descriptions, call `search_saved_queries` with a natural language query, verify results are ranked by relevance and scoped to the correct ontology. (Requires embedding provider.) |
| Semantic search via MCP | `tests/integration/test_mcp_runtime.py` | Call `search_saved_queries` via MCP client, verify results and score format. |
