# Cypher Query Support

> Read-only Cypher queries through the runtime API, validated and scoped to the ontology schema.

## Purpose

The existing runtime CRUD endpoints cover single-entity and single-relation operations. For more complex data retrieval — multi-hop traversals, aggregations, filtered joins — an LLM or developer needs to express graph patterns directly. The Cypher query endpoint provides this capability while enforcing the same ontology scoping and schema validation as the CRUD layer.

## Supported Cypher Subset

Allowed read clauses:

- `MATCH`, `OPTIONAL MATCH`
- `WHERE`
- `RETURN`
- `ORDER BY`, `LIMIT`, `SKIP`
- `WITH`
- `UNWIND`

Blocked operations (rejected before execution):

- **Write clauses**: `CREATE`, `DELETE`, `DETACH DELETE`, `SET`, `MERGE`, `REMOVE`
- **Procedures**: `CALL`

## Schema Validation

Every query is parsed and validated against the **scoped** ontology schema before execution:

1. **Node labels** must be entity type keys from the ontology scope.
2. **Relationship types** must be relation type keys from the ontology scope.
3. **Properties** in `WHERE`, `RETURN`, and `ORDER BY` must exist on the referenced type's scoped property set.
4. **System properties** (`_id`, `_entityTypeKey`, `_relationTypeKey`, `_createdAt`, `_updatedAt`) are always allowed.
5. **Labelless node patterns** (e.g., `MATCH (n)`) are rejected to prevent scope leakage.
6. **Internal labels** (`_Entity`) cannot be queried directly.

When validation fails, error messages include the available types and properties so that LLMs can self-correct.

## Label Translation

Users write Cypher using **schema keys** (snake_case). The system rewrites them to Neo4j conventions before execution:

- Entity type keys: `person` &rarr; `Person`, `research_paper` &rarr; `ResearchPaper`
- Relation type keys: `works_for` &rarr; `WORKS_FOR`

## Result Filtering

Returned nodes and relationships are post-processed to strip properties that fall outside the scoped ontology. This prevents leakage of properties that exist in the full schema but are not included in the ontology's scope.

## REST Endpoint

```
POST /api/runtime/{ontology_key}/query
Content-Type: application/json

{
  "cypher": "MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, c LIMIT 10"
}
```

Response:

```json
{
  "columns": ["p", "c"],
  "results": [
    {
      "p": {"_id": "...", "_entityTypeKey": "person", "name": "Alice"},
      "c": {"_id": "...", "_entityTypeKey": "company", "name": "Acme Corp"}
    }
  ]
}
```

## MCP Tool

The `cypher_query` tool is available on the existing runtime MCP server at `/mcp/runtime`. The ontology key is provided via the `X-Ontology-Key` header (same mechanism as all other runtime MCP tools).

Tool signature:

- **Name**: `cypher_query`
- **Parameter**: `cypher` (string) — the Cypher query using schema keys
- **Returns**: `{"columns": [...], "results": [...]}`

## Implementation

The feature is implemented across these modules:

- `runtime/cypher.py` — ANTLR-based parser, validator, and rewriter (uses `antlr4-cypher`)
- `runtime/service.py` — `execute_cypher_query()` orchestrates validation, execution, and result filtering
- `runtime/repository.py` — `execute_cypher_read()` runs the rewritten query against Neo4j
- `runtime/router.py` — `POST /query` endpoint
- `mcp/runtime.py` — `cypher_query` MCP tool
