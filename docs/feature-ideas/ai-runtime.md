# AI-Powered Runtime

> LLM-powered endpoints for natural language querying, entity extraction, and schema-aware Q&A — scoped to an ontology, consuming existing runtime MCP tools.

## Purpose

The runtime CRUD, Cypher query, and semantic search endpoints require structured input. AI-powered endpoints let users interact with their knowledge graph through natural language. The AI receives the ontology's scoped schema as context and uses existing runtime capabilities (via MCP tool consumption) to answer questions, extract structured data from text, and translate natural language to Cypher.

## Design Decisions

- **Framework**: PydanticAI — type-safe, supports function calling and MCP, fits the existing Pydantic/FastAPI stack.
- **Ontology-scoped**: Every AI endpoint lives under `/api/runtime/{ontologyKey}/ai/...`. The AI agent automatically operates within the ontology's schema scope.
- **MCP consumption**: The AI connects to the runtime MCP server as a client, using a configurable subset of tools per feature. Since runtime MCP is already ontology-scoped, no additional filtering is needed.
- **Stateless**: No server-side conversation storage. Multi-turn chat sends history from the client.
- **No streaming**: Simple request/response for now.
- **Feature flag**: Controlled by `AI_PROVIDER` env var. When unset, AI endpoints are disabled and return `FEATURE_DISABLED` errors.

## Configuration

Environment variables (following existing `EMBEDDING_*` pattern):

```
AI_PROVIDER=ollama          # "ollama" or "openai" (compatible) — unset = feature disabled
AI_BASE_URL=http://localhost:11434
AI_API_KEY=                 # required for openai-compatible providers
AI_MODEL=llama3.2           # model to use
```

Features endpoint extension:

```
GET /api/runtime/features
{"semanticSearch": true, "ai": true}
```

## Endpoints

### 1. Natural Language Query

Translates a natural language question into a validated Cypher query, executes it, and summarizes the results.

```
POST /api/runtime/{ontologyKey}/ai/query
Content-Type: application/json

{
  "question": "Find all companies in Berlin with more than 100 employees"
}
```

Response:

```json
{
  "answer": "Found 3 companies in Berlin with more than 100 employees.",
  "cypher": "MATCH (c:company) WHERE c.city = 'Berlin' AND c.employee_count > 100 RETURN c",
  "results": [...]
}
```

**Flow**: The AI receives the scoped schema (entity types, relation types, properties with their data types) and generates Cypher using schema keys (snake_case). The generated query passes through the existing `cypher.py` validation and rewriting engine before execution. The AI then summarizes the results.

**MCP tools used**: `execute_cypher_query`

### 2. Entity Extraction

Extracts structured entities and relations from unstructured text, guided by the ontology schema.

```
POST /api/runtime/{ontologyKey}/ai/extract
Content-Type: application/json

{
  "text": "John Smith has been working at Acme Corp since 2019. He is based in Berlin.",
  "entity_types": ["person", "company"],
  "create": false
}
```

- `entity_types` (optional): filter to specific types, defaults to all in scope.
- `create` (optional, default `false`): when `true`, persist extracted entities and relations through the existing service layer with full validation.

Response:

```json
{
  "entities": [
    {
      "entity_type_key": "person",
      "properties": {"name": "John Smith", "city": "Berlin"}
    },
    {
      "entity_type_key": "company",
      "properties": {"name": "Acme Corp"}
    }
  ],
  "relations": [
    {
      "relation_type_key": "works_for",
      "source": {"entity_type_key": "person", "match": {"name": "John Smith"}},
      "target": {"entity_type_key": "company", "match": {"name": "Acme Corp"}},
      "properties": {"since": 2019}
    }
  ],
  "created": false
}
```

When `create: true`, the response additionally includes `_id` fields for each created entity and relation. Entities are matched by the `match` fields in relations to link them. Full validation applies (required properties, type coercion, unknown property rejection).

**MCP tools used**: none (schema context only, persistence via service layer)

### 3. Schema-Aware Chat

Conversational interface that uses runtime MCP tools to answer questions about the knowledge graph.

```
POST /api/runtime/{ontologyKey}/ai/chat
Content-Type: application/json

{
  "message": "How many people work at Acme Corp?",
  "history": [],
  "include_tool_calls": false
}
```

- `history` (optional): list of `{"role": "user"|"assistant", "content": "..."}` for multi-turn context.
- `include_tool_calls` (optional, default `false`): when `true`, response includes the AI's tool usage for debugging.

Response:

```json
{
  "reply": "There are 12 people who work at Acme Corp."
}
```

With `include_tool_calls: true`:

```json
{
  "reply": "There are 12 people who work at Acme Corp.",
  "tool_calls": [
    {
      "tool": "execute_cypher_query",
      "args": {"cypher": "MATCH (p:person)-[:works_for]->(c:company {name: 'Acme Corp'}) RETURN count(p)"},
      "result_summary": "count: 12"
    }
  ]
}
```

**MCP tools used**: `list_entities`, `get_entity`, `semantic_search`, `execute_cypher_query`

## MCP Tool Allowlists

Each AI feature consumes a configured subset of runtime MCP tools. Defined in code:

```python
QUERY_TOOLS = ["execute_cypher_query"]
EXTRACT_TOOLS = []  # Schema context only, no tool use
CHAT_TOOLS = ["list_entities", "get_entity", "semantic_search", "execute_cypher_query"]
```

These lists are the single point of configuration for controlling what the AI can do per feature.

## Implementation Modules

- `core/ai.py` — AI provider initialization, PydanticAI agent factory, MCP client management
- `runtime/ai_service.py` — Business logic for AI endpoints (query, extract, chat)
- `runtime/router.py` — AI endpoint routes (added to existing runtime router)
- `runtime/schemas.py` — Request/response models for AI endpoints (added to existing schemas)
- `config.py` — `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` settings

## Future Ideas (Tier 2)

Deferred for now, but worth revisiting:

- **Entity Enrichment** — Given an entity with sparse properties, AI suggests values based on context or external knowledge.
- **Relation Discovery** — Analyze existing entities and suggest potential relations between them based on property similarity or semantic proximity.
- **Data Classification** — Given raw/unstructured data, suggest which entity type it best maps to within the ontology scope.
