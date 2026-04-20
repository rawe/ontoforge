# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

OntoForge consists of:

- **ontoforge-server** — a Python application that serves both modeling and runtime routes from a single process
- **frontend** — React app for schema design, ontology scope configuration, and runtime data management
- **MCP layer** — two MCP servers: modeling (global schema) and runtime (data access through an ontology)
- **Neo4j** — a single database holding the global schema and instance data

The server connects to one Neo4j database and always mounts both the modeling API (`/api/model`) and the runtime API (`/api/runtime/{ontologyKey}/...`). Schema nodes and instance nodes coexist in the same database, separated by label conventions (see section 4). Frontends communicate with the backend via REST only. The MCP layer wraps the same service layer used by the REST API.

## 2. Naming Conventions

| Layer | Component | Name |
|-------|-----------|------|
| Backend app | Python application | `ontoforge-server` |
| Backend module | Schema CRUD, validation, export/import | `modeling` |
| Backend module | Instance CRUD, search, traversal | `runtime` |
| Backend module | Shared infrastructure | `core` |
| API route | Schema modeling | `/api/model` |
| API route | Runtime operations | `/api/runtime/{ontologyKey}` |
| Frontend app | Schema design UI | `modeling` |
| Frontend app | Instance management UI | `runtime` |
| MCP | Adapter layer | TBD — likely `modeling-mcp`, `runtime-mcp` |
| Infrastructure | Neo4j database | `neo4j` |

### Neo4j Label and Relationship Naming

All Neo4j labels use PascalCase. Relationships use UPPER_SNAKE_CASE.

**Schema nodes:**

| Neo4j Element | Name |
|---------------|------|
| Node label | `Ontology` |
| Node label | `EntityType` |
| Node label | `RelationType` |
| Node label | `PropertyDefinition` |
| Node label | `AiAgentConfig` |
| Node label | `SavedQuery` |
| Relationship | `INCLUDES_TYPE` (Ontology → EntityType/RelationType, optional scoping) |
| Relationship | `HAS_PROPERTY` (EntityType/RelationType → PropertyDefinition) |
| Relationship | `RELATES_FROM` (RelationType → EntityType) |
| Relationship | `RELATES_TO` (RelationType → EntityType) |
| Relationship | `HAS_AI_AGENT` (Ontology → AiAgentConfig) |
| Relationship | `HAS_SAVED_QUERY` (Ontology → SavedQuery) |

**Instance nodes:**

| Neo4j Element | Name | Rule |
|---------------|------|------|
| Marker label | `_Entity` | Present on every entity instance node |
| Type label | e.g. `Person`, `ResearchPaper` | Entity type key converted to PascalCase |
| Relationship type | e.g. `WORKS_FOR`, `AUTHORED_BY` | Relation type key converted to UPPER_SNAKE_CASE |

The underscore-prefixed `_Entity` label separates instance nodes from schema nodes. Entity type keys are converted from `snake_case` to `PascalCase` (split on underscores, capitalize segments). Relation type keys are converted to `UPPER_SNAKE_CASE`.

## 3. Backend

### 3.1 Module Structure

The `ontoforge-server` is a modular monolith with three code modules. At startup, both the modeling and runtime routers are mounted, and the server connects to a single Neo4j database.

- **core** — shared infrastructure: Neo4j driver, configuration, error handling, Pydantic models for the ontology schema (used by both modules)
- **modeling** — schema management (CRUD, validation, export/import). Routes under `/api/model`.
- **runtime** — instance management (entity/relation CRUD, schema introspection). Routes under `/api/runtime/{ontologyKey}`.

Both modules share the same Neo4j database connection through `core/database.py`. The runtime module reuses schema Pydantic models from `core/` to read ontology data. It does **not** import from or depend on the `modeling` module.

**Python package structure:**

```
backend/src/ontoforge_server/
├── __init__.py
├── main.py              # FastAPI app factory, mounts both routers
├── config.py            # Pydantic Settings from environment
├── core/
│   ├── __init__.py
│   ├── database.py      # Neo4j async driver management
│   ├── exceptions.py    # Domain exceptions → HTTP mapping
│   └── schemas.py       # Shared Pydantic models (ontology schema, export format)
├── modeling/
│   ├── __init__.py
│   ├── router.py         # FastAPI router, /api/model
│   ├── service.py        # Business logic, validation, export/import
│   ├── repository.py     # Neo4j Cypher queries (schema CRUD)
│   └── schemas.py        # Modeling-specific request/response models
└── runtime/
    ├── __init__.py
    ├── router.py         # FastAPI router, /api/runtime/{ontologyKey}
    ├── ai_router.py      # FastAPI router, AI agent endpoints
    ├── service.py        # Instance CRUD, validation, schema introspection
    ├── repository.py     # Neo4j Cypher queries (instance CRUD)
    └── schemas.py        # Runtime-specific request/response models
```

**Shared code boundary:** The export/import Pydantic models (`ExportPayload`, `ExportOntology`, `ExportEntityType`, etc.) live in `core/schemas.py`. Both modules use these models: the modeling module for its export/import endpoints, the runtime module for schema introspection.

**Web framework:** FastAPI. Chosen for async support, Pydantic integration, and automatic OpenAPI docs.

### 3.2 Modeling Module

Owns all schema operations. Has a narrow dependency on the runtime module: after every mutation, the modeling service calls `invalidate_loaded_schema_cache()` to clear the runtime's in-memory cache. This is the only coupling between the two modules.

- Global entity type and relation type CRUD
- Property definition CRUD
- Ontology CRUD and scope management (INCLUDES_TYPE edges with optional property filtering)
- Schema validation
- Export/import via a Neo4j-independent JSON transfer format (v2.1)

**Layer responsibilities:**

| Layer | Responsibility |
|-------|---------------|
| `router.py` | HTTP handling, path/query params, delegates to service |
| `schemas.py` | Pydantic models for request validation and response serialization |
| `service.py` | Business logic, cross-entity validation, orchestrates repository calls |
| `repository.py` | Raw Cypher queries against Neo4j, returns dicts/primitives |

The service layer raises domain exceptions (from `core/exceptions.py`). The exception handler in `main.py` maps these to HTTP responses.

### 3.3 Runtime Module

Owns all instance operations. Reads schema data directly from the same database where the modeling module stores it. All operations are scoped through an ontology lens — the ontology key determines which types and properties are visible.

- Schema introspection (read-only — returns types and properties visible through the ontology)
- Entity instance CRUD (create, read, update, delete, list with filtering)
- Relation instance CRUD (create, read, update, delete, list with filtering)
- Neighborhood exploration (graph traversal from a given entity)
- Instance validation against the scoped schema

The runtime module reads schema data using the same Pydantic models as the modeling module's export. These shared models live in `core/schemas.py`. The runtime module has **no dependency** on the modeling module — it only depends on `core/`.

**Schema cache:** The runtime lazily loads the schema for each ontology into an in-memory `LoadedSchema` structure (containing both full and scoped `SchemaCache` instances), keyed by ontology key. The cache is invalidated by the modeling service after any schema or scope mutation. Unscoped ontologies (no `INCLUDES_TYPE` edges) expose the full schema; scoped ontologies expose only the included types and their selected properties.

**Validation:** Every write operation validates properties against the schema cache before executing Cypher. All validation errors are collected and returned at once (not fail-fast). The validation pipeline checks type existence, required properties, unknown properties, and data type coercion.

**Dynamic Cypher safety:** Entity type keys become Neo4j labels and relation type keys become relationship types in generated Cypher. These values are never raw user input — they come from the schema cache, which was built from the ontology stored in the database. Only property *values* are passed as Cypher parameters. This makes dynamic Cypher construction safe from injection.

### 3.4 MCP Layer

Two MCP server endpoints are embedded in the FastAPI application, providing AI-assisted access to the same service layer used by the REST API. See `mcp-architecture.md` for the full design, tool catalog, and client configuration.

## 4. Neo4j Storage Model

A single Neo4j instance holds both ontology schemas and instance data. Multiple ontologies coexist in the same database, each with their own schema nodes and instance data. Schema nodes and instance nodes are separated by label conventions — instance nodes carry the `_Entity` marker label, and a reserved label collision check prevents entity type keys from producing labels that match schema node labels.

### 4.1 Schema Representation

All schema objects are stored as Neo4j nodes connected by typed relationships.

**Node: Ontology**

| Property | Type | Notes |
|----------|------|-------|
| `ontologyId` | String (UUID) | Stable identifier, immutable after creation |
| `name` | String | Display name, unique across all ontologies |
| `key` | String | URL-safe identifier (`^[a-z][a-z0-9_]*$`), unique, immutable after creation |
| `description` | String | Optional |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

The `key` field is used in runtime URL paths (`/api/runtime/{ontologyKey}/...`). It follows the same snake_case pattern as entity and relation type keys.

**Node: EntityType**

| Property | Type | Notes |
|----------|------|-------|
| `entityTypeId` | String (UUID) | Stable identifier |
| `key` | String | Globally unique |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Node: RelationType**

| Property | Type | Notes |
|----------|------|-------|
| `relationTypeId` | String (UUID) | Stable identifier |
| `key` | String | Globally unique |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

Connected to its source and target entity types via `RELATES_FROM` and `RELATES_TO` relationships.

**Node: PropertyDefinition**

| Property | Type | Notes |
|----------|------|-------|
| `propertyId` | String (UUID) | Stable identifier |
| `key` | String | Unique within owning type |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `dataType` | String | One of: `string`, `integer`, `float`, `boolean`, `date`, `datetime` |
| `required` | Boolean | Whether instances must provide this property |
| `defaultValue` | String | Optional, stored as string, interpreted by dataType |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

**Node: AiAgentConfig**

| Property | Type | Notes |
|----------|------|-------|
| `agentConfigId` | String (UUID) | Stable identifier |
| `key` | String | Unique within owning ontology (`^[a-z][a-z0-9_]*$`) |
| `name` | String | Display name |
| `description` | String | Optional |
| `systemPrompt` | String | Optional, custom system prompt for this agent |
| `tools` | List of String | Tool names available to this agent |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

Connected to its owning ontology via a `HAS_AI_AGENT` relationship.

**Node: SavedQuery**

| Property | Type | Notes |
|----------|------|-------|
| `savedQueryId` | String (UUID) | Stable identifier, immutable after creation |
| `key` | String | Unique within owning ontology, pattern `^[a-z][a-z0-9_-]*$` |
| `name` | String | Display name |
| `description` | String | Required description |
| `cypher` | String | Parameterized Cypher query |
| `parameters` | String (JSON) | Serialized list of `{name, description, dataType}` |
| `_ontologyKey` | String | Owning ontology key — denormalized because SEARCH WHERE can only filter on node properties, not relationships |
| `_embedding` | List of Float | Vector embedding of the description field |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

Connected to its owning ontology via a `HAS_SAVED_QUERY` relationship.

**Relationships:**

```
(Ontology)-[:INCLUDES_TYPE {properties: [...] | null}]->(EntityType)    # scoped ontology only
(Ontology)-[:INCLUDES_TYPE {properties: [...] | null}]->(RelationType)  # scoped ontology only
(Ontology)-[:HAS_AI_AGENT]->(AiAgentConfig)
(Ontology)-[:HAS_SAVED_QUERY]->(SavedQuery)
(EntityType)-[:HAS_PROPERTY]->(PropertyDefinition)
(RelationType)-[:HAS_PROPERTY]->(PropertyDefinition)
(RelationType)-[:RELATES_FROM]->(EntityType)
(RelationType)-[:RELATES_TO]->(EntityType)
```

An ontology without any `INCLUDES_TYPE` edges is unscoped and exposes the full schema. An ontology with `INCLUDES_TYPE` edges is scoped — only the referenced types are visible. The `properties` attribute on `INCLUDES_TYPE` controls which properties are exposed: `null` means all properties, a list means only those properties.

**Constraints and Indexes:**

```cypher
-- Unique ontology name
CREATE CONSTRAINT ontology_name_unique FOR (o:Ontology) REQUIRE o.name IS UNIQUE;
-- Unique ontology ID
CREATE CONSTRAINT ontology_id_unique FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE;
-- Unique ontology key
CREATE CONSTRAINT ontology_key_unique FOR (o:Ontology) REQUIRE o.key IS UNIQUE;
-- Unique entity type ID
CREATE CONSTRAINT entity_type_id_unique FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE;
-- Unique relation type ID
CREATE CONSTRAINT relation_type_id_unique FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE;
-- Unique property ID
CREATE CONSTRAINT property_id_unique FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE;
-- Unique AI agent config ID
CREATE CONSTRAINT ai_agent_config_id_unique FOR (ac:AiAgentConfig) REQUIRE ac.agentConfigId IS UNIQUE;
-- Unique saved query ID
CREATE CONSTRAINT saved_query_id_unique FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE;
-- Entity instance uniqueness
CREATE CONSTRAINT entity_instance_id_unique FOR (n:_Entity) REQUIRE n._id IS UNIQUE;
-- Index on entity type key for type-scoped queries
CREATE INDEX entity_type_key_index FOR (n:_Entity) ON (n._entityTypeKey);
```

All constraints and indexes — both schema and instance — are created on startup.

Entity type and relation type keys are globally unique, enforced by Neo4j constraints.

**Cascading Deletes:**

- Deleting an **Ontology** removes its `INCLUDES_TYPE` edges and deletes all associated `AiAgentConfig` nodes (via `HAS_AI_AGENT`) and `SavedQuery` nodes (via `HAS_SAVED_QUERY`). Entity types, relation types, and properties are not affected (they are global).
- Deleting an **EntityType** fails with 409 Conflict if any relation type references it as source or target. With `cascade=true`, it also removes `INCLUDES_TYPE` edges from all ontologies. Its property definitions are deleted.
- Deleting a **RelationType** deletes its property definitions. With `cascade=true`, it also removes `INCLUDES_TYPE` edges from all ontologies.
- Deleting a **PropertyDefinition** is always allowed. With `cascade=true`, it also removes the property key from scoped ontology property lists.

### 4.2 Instance Representation

Instance data lives in the same database as schema data. Entity instances are Neo4j nodes; relation instances are native Neo4j relationships.

#### Entity Instances

Each entity instance is a Neo4j node with two labels:

1. `_Entity` — shared marker label on every entity instance node
2. The entity type key in PascalCase — e.g., entity type key `person` becomes label `Person`

**System properties** (underscore-prefixed, never collide with user properties which must start lowercase):

| Property | Type | Description |
|----------|------|-------------|
| `_id` | String (UUID) | Stable instance identifier, generated on creation |
| `_entityTypeKey` | String | Schema entity type key (e.g., `person`) |
| `_createdAt` | DateTime | Creation timestamp |
| `_updatedAt` | DateTime | Last-modified timestamp |

**User-defined properties** are stored as direct node properties, keyed by their property definition key:

```
(:_Entity:Person {
  _id: "b7e3f1a2-...",
  _entityTypeKey: "person",
  _createdAt: datetime("2026-02-22T10:00:00Z"),
  _updatedAt: datetime("2026-02-22T10:00:00Z"),
  name: "Alice",
  age: 30
})
```

Properties are stored using native Neo4j types, not serialized into a JSON blob. This enables Neo4j's native filtering, ordering, and indexing on property values.

| Schema dataType | Neo4j Storage Type |
|----------------|--------------------|
| `string` | String |
| `integer` | Integer (64-bit) |
| `float` | Float (64-bit) |
| `boolean` | Boolean |
| `date` | Date |
| `datetime` | DateTime |

#### Relation Instances

Each relation instance is a **native Neo4j relationship** between two entity instance nodes. The relationship type is the relation type key converted to UPPER_SNAKE_CASE (e.g., `works_for` becomes `WORKS_FOR`).

**System properties** on the relationship:

| Property | Type | Description |
|----------|------|-------------|
| `_id` | String (UUID) | Stable instance identifier |
| `_relationTypeKey` | String | Schema relation type key (e.g., `works_for`) |
| `_createdAt` | DateTime | Creation timestamp |
| `_updatedAt` | DateTime | Last-modified timestamp |

**User-defined properties** are stored directly on the relationship:

```
(:_Entity:Person {_id: "b7e3f1a2-...", name: "Alice"})
  -[:WORKS_FOR {
    _id: "c4d5e6f7-...",
    _relationTypeKey: "works_for",
    _createdAt: datetime("2026-02-22T10:00:00Z"),
    _updatedAt: datetime("2026-02-22T10:00:00Z"),
    since: date("2024-03-15")
  }]->
(:_Entity:Company {_id: "x9y8z7-...", name: "Acme Corp"})
```

Native relationships are used instead of intermediate nodes because they leverage Neo4j's core strengths: natural Cypher traversal patterns, optimized relationship storage engine, and compatibility with graph algorithms and visualization tools.

**Trade-off:** Neo4j Community Edition does not support relationship property indexes. Relation instance lookup by `_id` scans relationships of the given type. This is acceptable at expected data volumes. If it becomes a bottleneck, a secondary lookup mechanism can be added later.

#### Reserved Label Collision

Entity type keys are converted to PascalCase labels. If an entity type key matches a schema label (e.g., `ontology` → `Ontology`), instance nodes would share a label with schema nodes. The modeling service rejects entity type keys that would collide with reserved labels: `Ontology`, `EntityType`, `RelationType`, `PropertyDefinition`.

### 4.3 Ontology Scoping

Multiple ontologies coexist in the same database as lenses over a shared global schema. Unscoped ontologies expose all types and properties. Scoped ontologies use `INCLUDES_TYPE` edges to expose a subset.

Instance data is shared — all ontologies see the same entities and relations. The ontology key in the runtime URL (`/api/runtime/{ontologyKey}/...`) determines which types and properties are visible for validation and response filtering. An entity created through one ontology is accessible through any other ontology that includes its type.

### 4.4 JSON Transfer Format

The export/import format is a self-contained JSON document:

```json
{
  "formatVersion": "2.1",
  "entityTypes": [
    {
      "key": "string",
      "displayName": "string",
      "description": "string",
      "properties": [
        {
          "key": "string",
          "displayName": "string",
          "description": "string",
          "dataType": "string",
          "required": true,
          "defaultValue": null
        }
      ]
    }
  ],
  "relationTypes": [
    {
      "key": "string",
      "displayName": "string",
      "description": "string",
      "fromEntityTypeKey": "string",
      "toEntityTypeKey": "string",
      "properties": []
    }
  ],
  "ontologies": [
    {
      "key": "string",
      "name": "string",
      "description": "string",
      "includes": null,
      "aiAgents": []
    },
    {
      "key": "string",
      "name": "string",
      "description": "string",
      "includes": {
        "entityTypes": [
          {"key": "string", "properties": null},
          {"key": "string", "properties": ["prop1", "prop2"]}
        ],
        "relationTypes": [
          {"key": "string", "properties": null}
        ]
      },
      "aiAgents": [
        {
          "key": "string",
          "name": "string",
          "description": "string",
          "systemPrompt": "string",
          "tools": ["string"]
        }
      ],
      "savedQueries": [
        {
          "key": "string",
          "name": "string",
          "description": "string",
          "cypher": "string",
          "parameters": [
            {
              "name": "string",
              "description": "string",
              "dataType": "string"
            }
          ]
        }
      ]
    }
  ]
}
```

Entity types and relation types are global — not nested under any ontology. Ontologies are separate entries with optional `includes` for scoping. An ontology with `"includes": null` is unscoped (exposes the full schema). A scoped ontology lists the types it includes; `"properties": null` means all properties, a list means only those properties. UUIDs are not included in the export — they are regenerated on import.

## 5. API Design

### 5.1 Common Conventions

**API scoping:** The modeling API operates on the global schema under `/api/model/...` — entity types, relation types, and properties are not scoped to any ontology. Ontologies and their scope configuration are managed as separate resources under `/api/model/ontologies/...`. The runtime API scopes all routes under `/api/runtime/{ontologyKey}/...` using the ontology's unique key.

**Error response format:**

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Entity type with key 'person' not found in ontology 'acme'",
    "details": {}
  }
}
```

**HTTP status codes:**

| Status | Usage |
|--------|-------|
| 200 | Successful read or update |
| 201 | Successful creation |
| 204 | Successful deletion |
| 400 | Malformed request (invalid JSON, missing fields) |
| 404 | Resource not found |
| 409 | Conflict (duplicate name/key, referenced entity in use) |
| 422 | Semantic validation error (schema inconsistency) |
| 500 | Internal server error |

**Validation errors** (400/422) include details:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fields": {
        "key": "Key must contain only lowercase letters, numbers, and underscores"
      }
    }
  }
}
```

### 5.2 Modeling API

Base path: `/api/model`

Full contract: see `api-contracts/modeling-api.md`

### 5.3 Runtime API

Base path: `/api/runtime/{ontologyKey}`

The runtime API is generic and schema-driven — endpoints use type keys from the ontology as path parameters. It covers schema introspection, entity and relation instance CRUD, graph traversal, and instance data management.

**Endpoint summary:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/runtime/{ontologyKey}/schema` | Schema introspection (scoped to ontology) |
| `GET` | `/api/runtime/{ontologyKey}/schema/entity-types` | List entity types |
| `GET` | `/api/runtime/{ontologyKey}/schema/entity-types/{key}` | Get entity type with properties |
| `GET` | `/api/runtime/{ontologyKey}/schema/relation-types` | List relation types |
| `GET` | `/api/runtime/{ontologyKey}/schema/relation-types/{key}` | Get relation type with properties |
| `POST` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}` | Create entity instance |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}` | List/search entity instances |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}` | Get entity instance |
| `PATCH` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}` | Partial update entity instance |
| `DELETE` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}` | Delete entity instance |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/neighbors` | Graph traversal |
| `POST` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | Create relation instance |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | List relation instances |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Get relation instance |
| `PATCH` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Partial update relation instance |
| `DELETE` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Delete relation instance |

Full contract: see `api-contracts/runtime-api.md`

## 6. Frontend

### 6.1 Modeling UI

React + TypeScript + Vite application for schema design.

Core views:
- Ontology list and creation
- Ontology detail with entity types and relation types
- Entity type editor with property management
- Relation type editor with source/target selection and property management
- Schema validation results
- Export/import interface

### 6.2 Runtime UI

<!-- Deferred to Phase 3. -->

## 7. Data Flow

**Request lifecycle (modeling):**

```
HTTP Request
  → FastAPI router (path params, body parsing)
    → Pydantic schema validation (request model)
      → Service layer (business logic, cross-entity checks)
        → Repository layer (Cypher query execution)
          → Neo4j
        ← Repository returns dict
      ← Service returns domain object
    ← Pydantic schema serialization (response model)
  ← HTTP Response (JSON)
```

The runtime module follows the same layered pattern against the same database, with an additional schema cache lookup step before validation.

**Error propagation:**

Repository raises `Neo4jError` or returns `None` → Service raises domain exception (e.g., `NotFoundError`, `ConflictError`) → Exception handler in `main.py` maps to HTTP response with structured error body.

**Domain exceptions:**

| Exception | HTTP Status | Error Code |
|-----------|-------------|------------|
| `NotFoundError` | 404 | `RESOURCE_NOT_FOUND` |
| `ConflictError` | 409 | `RESOURCE_CONFLICT` |
| `ValidationError` | 422 | `VALIDATION_ERROR` |

## 8. Local Development

Dependencies are managed via Docker Compose. The backend connects to a pre-configured Neo4j instance.

**Docker Compose services:**
- `neo4j` — single Neo4j database for both schema and instance data (ports 7474/7687)

**Configuration:** The backend reads connection settings from environment variables.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_URI` | `bolt://localhost:7687` | Neo4j Bolt endpoint |
| `DB_USER` | `neo4j` | Neo4j username |
| `DB_PASSWORD` | `ontoforge_dev` | Neo4j password |
| `PORT` | `8000` | HTTP listen port |
| `DEFAULT_MCP_ONTOLOGY_KEY` | *(unset)* | MCP default ontology key (used when key is not in URL or header) |

**Running locally:**

```bash
# Start Neo4j
docker compose up -d

# Start the server (serves both modeling and runtime)
uv run ontoforge-server
```

**Database bootstrap:** On startup, the server ensures all required constraints and indexes exist — both schema constraints (ontology, entity type, etc.) and instance constraints (`_Entity` uniqueness on `_id`, entity type key index). The runtime schema cache is loaded lazily on first request per ontology, not at startup.

**Optional features.** Semantic search and AI-powered runtime are opt-in via environment variables; see the README for the full env-var table. The embedding lifecycle — write-time path, staleness, background reconcile worker, and the `rebuild-embeddings` endpoint — is documented in [embeddings.md](embeddings.md).
