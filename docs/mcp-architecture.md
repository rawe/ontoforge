# OntoForge — MCP Integration Architecture

> Architecture for the Model Context Protocol (MCP) integration.
> Defines transport, deployment, scoping, and tool surface for Phase 4.

## 1. Context and Design Decisions

### 1.1 Use Cases

Two primary scenarios drive the MCP integration:

1. **Schema brainstorming** — An AI coding assistant (e.g., Claude Code) connects to OntoForge to collaboratively design an ontology. The assistant can inspect the current schema, propose entity types, relation types, and properties, and persist changes live in Neo4j. This enables conversational ontology design where the developer and the LLM iterate together.

2. **Schema-enforced data access** — An LLM uses OntoForge as a controlled write layer for a Neo4j knowledge graph. Every write is validated against the ontology, preventing the LLM from hallucinating new entity types, inventing undefined properties, or writing structurally invalid data. The LLM gets structured, schema-aware CRUD access without needing to understand Cypher or Neo4j internals.

Both use cases share a key requirement: the LLM should operate on **one ontology at a time**, without being aware that the system supports multiple ontologies.

### 1.2 Transport: HTTP/SSE

MCP supports two transport mechanisms: stdio (subprocess) and HTTP/SSE (network).

**Decision: HTTP/SSE.**

Reasons:
- The user's AI framework requires HTTP-based MCP servers.
- HTTP allows any MCP-compatible client to connect over the network, not just local subprocesses.
- HTTP integrates naturally with the existing FastAPI-based architecture.

### 1.3 Deployment: Embedded in the Existing Server

We evaluated three deployment shapes:

**Shape A — Embedded (chosen):** MCP endpoints are mounted inside the existing `ontoforge-server` FastAPI application. One process, one port.

**Shape B — Separate process, REST adapter (rejected):** A standalone MCP process that wraps the REST API, calling it over HTTP.

**Shape C — Separate process, direct DB (rejected):** A standalone MCP process with its own Neo4j connection, importing service code as a library.

#### Why Shape A (Embedded)

- **No extra process.** The `ontoforge-server` already runs at port 8000. MCP endpoints are additional FastAPI routes — no second process to start for local development.
- **Direct service calls.** MCP handlers call the same service layer (`modeling/service.py`, `runtime/service.py`) as the REST routers. No REST-to-REST network hop, no HTTP adapter layer, no serialization/deserialization overhead.
- **Shared infrastructure.** Reuses the existing Neo4j connection, schema cache, error handling, and configuration. No duplication.
- **Natural ontology scoping.** The ontology key is part of the MCP endpoint URL. The client configures which ontology it connects to by choosing the URL.

#### Why Not Shape B (Separate process, REST adapter)

- Adds a second process to manage during local development.
- Every MCP tool call requires a network round-trip to the REST API — unnecessary latency.
- Requires an HTTP client dependency and error-mapping logic just to call an API running on the same machine.
- No real architectural benefit at this scale.

#### Why Not Shape C (Separate process, direct DB)

- Duplicates Neo4j connection management, schema cache, and startup logic.
- Two processes competing for the same database.
- Over-engineered for the use case — violates KISS.

### 1.4 Scope: Two MCP Servers, One Process

The MCP layer exposes **two separate MCP server endpoints** within the same process:

- **Modeling MCP** — tools for ontology schema design
- **Runtime MCP** — tools for instance data operations

This mirrors the REST API's separation (`/api/model` vs `/api/runtime`) and the PRD's requirement that each mode has its own MCP interface with no cross-mode access. A modeling session cannot write instance data; a runtime session cannot alter the schema.

### 1.5 Ontology Scoping

The REST API is multi-ontology: each request specifies which ontology to operate on. For an LLM, this is overwhelming — it should focus on one ontology without choosing or discovering ontologies per call.

**Decision: The ontology key is embedded in the MCP endpoint URL.** The MCP client connects to a specific URL, and all tools operate on that single ontology. The LLM never sees multi-ontology complexity.

| Connection Purpose | MCP Endpoint URL |
|--------------------|------------------|
| Model ontology "acme" | `http://localhost:8000/mcp/model/acme` |
| Use ontology "acme" data | `http://localhost:8000/mcp/runtime/acme` |

**Ontology existence rules:**

- **Modeling MCP:** The ontology may not exist yet — creating it is part of the workflow. A `create_ontology` tool bootstraps it using the key from the URL. All other tools work once the ontology exists.
- **Runtime MCP:** The ontology **must** exist with a defined schema. If the key doesn't resolve, all tools return an error directing the user to create the ontology first.

---

## 2. System Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    ontoforge-server                         │
│                   (FastAPI, port 8000)                      │
│                                                             │
│  ┌────────────────────┐    ┌──────────────────────────────┐ │
│  │    REST Routers    │    │       MCP Endpoints          │ │
│  │                    │    │                              │ │
│  │  /api/model/...    │    │  /mcp/model/{ontologyKey}    │ │
│  │  /api/runtime/...  │    │  /mcp/runtime/{ontologyKey}  │ │
│  └─────────┬──────────┘    └──────────────┬───────────────┘ │
│            │                              │                 │
│            │      ┌──────────────────┐    │                 │
│            └─────►│  Service Layer   │◄───┘                 │
│                   │                  │                      │
│                   │  modeling/       │                      │
│                   │    service.py    │                      │
│                   │  runtime/        │                      │
│                   │    service.py    │                      │
│                   └────────┬─────────┘                      │
│                            │                                │
│                   ┌────────▼──────────┐                     │
│                   │  Repository Layer │                     │
│                   └────────┬──────────┘                     │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │     Neo4j       │
                    └─────────────────┘
```

REST and MCP are **two interfaces to the same business logic**. Both call the service layer directly. Neither depends on the other.

### 2.2 Modeling MCP — Connection Flow

```
AI Coding Assistant (e.g., Claude Code)
  │
  │  MCP over HTTP/SSE
  │  URL: http://localhost:8000/mcp/model/acme
  │
  ▼
┌───────────────────────────────────────────────┐
│  Modeling MCP Handler                         │
│                                               │
│  1. Extract ontology key from URL: "acme"     │
│  2. Resolve key → ontology (incl. UUID)       │
│  3. Expose modeling tools to the LLM          │
│     (all scoped to this ontology)             │
│  4. Translate key-based tool arguments        │
│     into UUID-based service calls             │
└───────────────────┬───────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│  modeling/service.py                          │
│  (same code the REST router uses)             │
└───────────────────┬───────────────────────────┘
                    ▼
                 [Neo4j]
```

**Example:** The LLM calls `create_entity_type(key="person", display_name="Person")`. The MCP handler resolves the ontology key "acme" to its UUID, then calls `service.create_entity_type(ontology_id="<uuid>", ...)`.

### 2.3 Runtime MCP — Connection Flow

```
LLM Application / AI Agent
  │
  │  MCP over HTTP/SSE
  │  URL: http://localhost:8000/mcp/runtime/acme
  │
  ▼
┌───────────────────────────────────────────────┐
│  Runtime MCP Handler                          │
│                                               │
│  1. Extract ontology key from URL: "acme"     │
│  2. Verify ontology exists with schema        │
│  3. Expose runtime tools to the LLM           │
│     (all scoped to this ontology)             │
│  4. All writes validated against schema cache │
└───────────────────┬───────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│  runtime/service.py                           │
│  (schema cache validates every write)         │
└───────────────────┬───────────────────────────┘
                    ▼
                 [Neo4j]
```

**Example:** The LLM calls `create_entity(entity_type_key="person", properties={"name": "Alice", "age": 30})`. The runtime service checks the schema cache: does `person` exist? Is `name` a valid string property? Is `age` a valid integer? Is anything required but missing? Only valid data reaches Neo4j.

---

## 3. MCP Tool Catalog

### Design Principles

1. **Key-based addressing.** All type references use human-readable keys (`person`, `works_for`), never UUIDs. The MCP layer resolves keys to UUIDs internally.
2. **Ontology is implicit.** No tool takes an ontology parameter. The ontology is fixed by the MCP connection URL.
3. **Minimal surface.** Only expose tools the LLM genuinely needs. Consolidate where possible to avoid overwhelming the LLM with similar tools.
4. **Self-documenting.** Each tool has a description that tells the LLM when and how to use it. The `get_schema` tool provides full context about what types and properties exist.

### 3.1 Modeling MCP Tools (15 tools)

#### Schema Introspection

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `get_schema` | — | Full schema: ontology metadata, all entity types with properties, all relation types with properties | Get the current state of the ontology. Call this first to understand what exists before making changes. |

#### Ontology Lifecycle

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `create_ontology` | `name` (required), `description` (optional) | Created ontology | Bootstrap the ontology. The key is set automatically from the connection URL. Fails if the ontology already exists. |
| `update_ontology` | `name` (optional), `description` (optional) | Updated ontology | Update the ontology's display name or description. |

#### Entity Types

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `create_entity_type` | `key`, `display_name`, `description` (opt) | Created entity type | Add a new entity type. Key must be snake_case, unique within the ontology. |
| `update_entity_type` | `entity_type_key`, `display_name` (opt), `description` (opt) | Updated entity type | Update display name or description. Key is immutable. |
| `delete_entity_type` | `entity_type_key` | Confirmation | Remove an entity type and its properties. Fails if any relation type references it as source or target. |

#### Relation Types

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `create_relation_type` | `key`, `display_name`, `source_entity_type_key`, `target_entity_type_key`, `description` (opt) | Created relation type | Add a new relation type connecting two entity types. Source and target are specified by entity type key. |
| `update_relation_type` | `relation_type_key`, `display_name` (opt), `description` (opt) | Updated relation type | Update display name or description. Source/target endpoints are immutable. |
| `delete_relation_type` | `relation_type_key` | Confirmation | Remove a relation type and its properties. |

#### Properties (Unified)

Properties are managed through unified tools that work on both entity types and relation types, distinguished by the `type_kind` parameter.

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `add_property` | `type_kind` ("entity_type" or "relation_type"), `type_key`, `key`, `display_name`, `data_type`, `required` (opt, default false), `default_value` (opt), `description` (opt) | Created property | Add a property definition. `data_type` must be one of: string, integer, float, boolean, date, datetime. |
| `update_property` | `type_kind`, `type_key`, `property_key`, `display_name` (opt), `required` (opt), `default_value` (opt), `description` (opt) | Updated property | Update a property's metadata. Key and data type are immutable after creation. |
| `delete_property` | `type_kind`, `type_key`, `property_key` | Confirmation | Remove a property definition from an entity type or relation type. |

#### Validation and Transfer

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `validate_schema` | — | Validation result: `valid` (boolean), `errors` (list) | Check the schema for consistency — dangling references, duplicate keys, missing fields. |
| `export_schema` | — | JSON export payload | Export the full ontology schema in OntoForge transfer format. |
| `import_schema` | `payload` (JSON object), `overwrite` (opt, default false) | Imported ontology | Import a schema from a JSON payload into the current ontology. With `overwrite=true`, replaces the existing schema. |

### 3.2 Runtime MCP Tools (13 tools)

#### Schema Introspection

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `get_schema` | — | Full schema: entity types with properties, relation types with source/target keys and properties | Understand the ontology before creating data. Shows available entity types, relation types, and their property definitions. |

#### Entity Operations

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `create_entity` | `entity_type_key`, `properties` (object) | Created entity with `_id` | Create a new entity instance. Properties must conform to the schema — required properties must be present, types must match. |
| `list_entities` | `entity_type_key`, `search` (opt), `filters` (opt, object), `sort` (opt), `order` (opt), `limit` (opt, default 50), `offset` (opt) | Paginated list: `items`, `total`, `limit`, `offset` | List entities of a type. `search` does substring matching across string properties. `filters` uses `{"name": "Alice", "age__gt": 25}` syntax. |
| `get_entity` | `entity_type_key`, `entity_id` | Single entity instance | Retrieve a specific entity by its `_id`. |
| `update_entity` | `entity_type_key`, `entity_id`, `properties` (object) | Updated entity instance | Partial update — only provided properties change. Set a property to `null` to remove it (fails for required properties). |
| `delete_entity` | `entity_type_key`, `entity_id` | Confirmation | Delete an entity and all its connected relations. |

#### Relation Operations

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `create_relation` | `relation_type_key`, `from_entity_id`, `to_entity_id`, `properties` (opt, object) | Created relation with `_id` | Create a relation between two entities. Entity types must match the relation type's source/target definition. |
| `list_relations` | `relation_type_key`, `from_entity_id` (opt), `to_entity_id` (opt), `sort` (opt), `order` (opt), `limit` (opt, default 50), `offset` (opt) | Paginated list: `items`, `total`, `limit`, `offset` | List relations of a type. Optionally filter by source or target entity. |
| `get_relation` | `relation_type_key`, `relation_id` | Single relation instance | Retrieve a specific relation by its `_id`. |
| `update_relation` | `relation_type_key`, `relation_id`, `properties` (object) | Updated relation instance | Partial update of relation properties. Cannot change connected entities — delete and recreate instead. |
| `delete_relation` | `relation_type_key`, `relation_id` | Confirmation | Delete a relation. Connected entities are unaffected. |

#### Graph Exploration

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `get_neighbors` | `entity_type_key`, `entity_id`, `direction` (opt: "outgoing"/"incoming"/"both", default "both"), `relation_type_key` (opt), `limit` (opt, default 50) | Center entity + list of neighbor entities with connecting relations | Explore an entity's local neighborhood — discover what it's connected to and how. |

#### Data Management

| Tool | Arguments | Returns | Description |
|------|-----------|---------|-------------|
| `wipe_data` | — | Count of deleted entities and relations | **Destructive.** Delete all instance data for this ontology. Schema is preserved. |

---

## 4. Key Abstraction: UUID Hiding

The REST modeling API uses UUIDs extensively in URL paths (`ontologyId`, `entityTypeId`, `relationTypeId`, `propertyId`). The MCP layer hides all type-level UUIDs behind human-readable keys:

| What REST uses | What MCP exposes | How the MCP resolves it |
|----------------|------------------|------------------------|
| `ontologyId` in URL path | Ontology key in connection URL | Resolved once on session init, cached |
| `entityTypeId` in URL path | `entity_type_key` parameter | Looked up via schema cache per call |
| `relationTypeId` in URL path | `relation_type_key` parameter | Looked up via schema cache per call |
| `sourceEntityTypeId` / `targetEntityTypeId` | `source_entity_type_key` / `target_entity_type_key` | Looked up via schema cache per call |
| `propertyId` in URL path | `property_key` parameter | Looked up via service layer per call |

**Instance-level IDs** (`_id` on entities and relations) remain as opaque UUID strings. The LLM receives them from create/list operations and passes them to get/update/delete operations. This is natural — instance IDs are data, not schema structure.

---

## 5. Client Configuration

### Example: Claude Code MCP settings

```json
{
  "mcpServers": {
    "ontoforge-modeling": {
      "type": "http",
      "url": "http://localhost:8000/mcp/model/my_ontology"
    },
    "ontoforge-runtime": {
      "type": "http",
      "url": "http://localhost:8000/mcp/runtime/my_ontology"
    }
  }
}
```

The user chooses which ontology to work with by setting the URL. Connecting both servers simultaneously is valid — model the schema in one session, write data in another.

No additional environment variables are needed beyond the existing `ontoforge-server` configuration (`DB_URI`, `DB_USER`, `DB_PASSWORD`, `PORT`).

---

## 6. Implementation Scope

### 6.1 New Code

```
backend/src/ontoforge_server/
├── mcp/
│   ├── __init__.py
│   ├── modeling.py      # Modeling MCP server: tool definitions + handlers
│   ├── runtime.py       # Runtime MCP server: tool definitions + handlers
│   └── mount.py         # FastAPI integration: mount MCP endpoints
```

The `mcp/` module depends on `core/` and the service layers of `modeling/` and `runtime/`. It does **not** depend on the REST routers.

### 6.2 New Dependency

```toml
# pyproject.toml
dependencies = [
    ...,
    "mcp[http]",
]
```

### 6.3 Changes to Existing Code

- `main.py` — mount MCP endpoints alongside REST routers
- No changes to service, repository, or core layers
