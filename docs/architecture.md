# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

OntoForge consists of:

- **ontoforge-server** — a Python application that serves both modeling and runtime routes from a single process
- **frontend** — React app for schema design, ontology scope configuration, and runtime data management
- **MCP layer** — two MCP servers: modeling (global schema) and runtime (data access through an ontology)
- **Database** — a single graph database holding the global schema and instance data, accessed through the persistence port — Neo4j is the current adapter

The server uses one database and always mounts both the modeling API (`/api/model`) and the runtime API (`/api/runtime/{ontologyKey}/...`). Schema objects and instance data coexist in the same database (see section 4); how they are physically separated is an adapter concern (see `neo4j-adapter.md`). Frontends communicate with the backend via REST only. The MCP layer wraps the same service layer used by the REST API.

## 2. Naming Conventions

| Layer | Component | Name |
|-------|-----------|------|
| Backend app | Python application | `ontoforge-server` |
| Backend module | Schema CRUD, validation, export/import | `modeling` |
| Backend module | Instance CRUD, search, traversal | `runtime` |
| Backend module | Shared infrastructure | `core` |
| Backend package | Database adapters | `adapters` |
| API route | Schema modeling | `/api/model` |
| API route | Runtime operations | `/api/runtime/{ontologyKey}` |
| Frontend app | Schema design UI | `modeling` |
| Frontend app | Instance management UI | `runtime` |
| MCP | Adapter layer | TBD — likely `modeling-mcp`, `runtime-mcp` |
| Infrastructure | Database (Neo4j adapter) | `neo4j` |

Physical database naming — labels, relationship-type spellings, index names, and the PascalCase/UPPER_SNAKE_CASE conventions — is internal to the Neo4j adapter and documented in `neo4j-adapter.md`.

## 3. Backend

### 3.1 Module Structure

The `ontoforge-server` is a modular monolith. At startup, both the modeling and runtime routers are mounted, and the persistence adapter selected via `DB_BACKEND` is initialized.

- **core** — shared infrastructure: the persistence port, configuration, error handling, Pydantic models for the ontology schema (used by both modules)
- **adapters** — one package per database adapter; `adapters/neo4j/` is the reference adapter (see `neo4j-adapter.md`)
- **modeling** — schema management (CRUD, validation, export/import). Routes under `/api/model`.
- **runtime** — instance management (entity/relation CRUD, schema introspection). Routes under `/api/runtime/{ontologyKey}`.

All database access goes through the persistence port in `core/ports.py`: `get_modeling_store()` and `get_runtime_store()` return the stores of the adapter selected via `DB_BACKEND` (default `neo4j`). Services, routers, and MCP handlers speak ontology vocabulary only — type keys, property keys, instance UUIDs, structured filters — and never see driver types, query text, or physical naming. The runtime module reuses schema Pydantic models from `core/` to read ontology data. It does **not** import from or depend on the `modeling` module.

**Python package structure:**

```
backend/src/ontoforge_server/
├── __init__.py
├── main.py              # FastAPI app factory, mounts both routers
├── config.py            # Pydantic Settings from environment (incl. DB_BACKEND)
├── core/
│   ├── __init__.py
│   ├── ports.py         # Persistence port: store accessors, adapter selection
│   ├── exceptions.py    # Domain exceptions → HTTP mapping
│   └── schemas.py       # Shared Pydantic models (ontology schema, export format)
├── adapters/
│   └── neo4j/
│       ├── driver.py           # Driver lifecycle, schema constraints
│       ├── ddl.py              # Index DDL, naming conventions, index limits
│       ├── modeling_store.py   # Neo4jModelingStore
│       ├── runtime_store.py    # Neo4jRuntimeStore
│       ├── modeling_queries.py # Schema persistence queries
│       └── runtime_queries.py  # Instance persistence queries
├── modeling/
│   ├── __init__.py
│   ├── router.py         # FastAPI router, /api/model
│   ├── service.py        # Business logic, validation, export/import
│   └── schemas.py        # Modeling-specific request/response models
└── runtime/
    ├── __init__.py
    ├── router.py         # FastAPI router, /api/runtime/{ontologyKey}
    ├── ai_router.py      # FastAPI router, AI agent endpoints
    ├── service.py        # Instance CRUD, validation, schema introspection
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
- Export/import via a database-independent JSON transfer format (v3.0)

**Layer responsibilities:**

| Layer | Responsibility |
|-------|---------------|
| `router.py` | HTTP handling, path/query params, delegates to service |
| `schemas.py` | Pydantic models for request validation and response serialization |
| `service.py` | Business logic, cross-entity validation, orchestrates store calls |
| store (adapter) | Persistence operations behind the port, returns dicts/primitives |

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

**Validation:** Every write operation validates properties against the schema cache before any store call. All validation errors are collected and returned at once (not fail-fast). The validation pipeline checks type existence, required properties, unknown properties, and data type coercion.

**Filters and temporals:** Filtering, search, and sorting inputs cross the persistence port as structured values, never as query fragments; the adapter compiles them to its native query form. Temporal values cross the port as plain Python `date`/`datetime` — driver-specific temporal types stay inside the adapter. How the adapter constructs its queries safely from schema-derived type keys is described in `neo4j-adapter.md`.

### 3.4 MCP Layer

Two MCP server endpoints are embedded in the FastAPI application, providing AI-assisted access to the same service layer used by the REST API. See `mcp-architecture.md` for the full design, tool catalog, and client configuration.

## 4. Logical Data Model

A single database instance holds both ontology schemas and instance data. Multiple ontologies coexist in the same database, each with their own schema objects and instance data. Entity and relation type keys colliding with reserved internal names are rejected by the modeling service, so user-defined types can never clash with the system's own storage structures. The physical representation of this model — labels, relationship storage, constraints, indexes — is the Neo4j adapter's concern and is documented in `neo4j-adapter.md`.

### 4.1 Schema Representation

All schema objects are stored as records connected by typed relationships.

**Ontology**

| Property | Type | Notes |
|----------|------|-------|
| `ontologyId` | String (UUID) | Stable identifier, immutable after creation |
| `name` | String | Display name, unique across all ontologies |
| `key` | String | URL-safe identifier (`^[a-z][a-z0-9_]*$`), unique, immutable after creation |
| `description` | String | Optional |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

The `key` field is used in runtime URL paths (`/api/runtime/{ontologyKey}/...`). It follows the same snake_case pattern as entity and relation type keys.

**EntityType**

| Property | Type | Notes |
|----------|------|-------|
| `entityTypeId` | String (UUID) | Stable identifier |
| `key` | String | Globally unique |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**RelationType**

| Property | Type | Notes |
|----------|------|-------|
| `relationTypeId` | String (UUID) | Stable identifier |
| `key` | String | Globally unique |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

Connected to its source and target entity types via `RELATES_FROM` and `RELATES_TO` relationships.

**PropertyDefinition**

| Property | Type | Notes |
|----------|------|-------|
| `propertyId` | String (UUID) | Stable identifier |
| `key` | String | Unique within owning type |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `dataType` | String | One of: `string`, `integer`, `float`, `boolean`, `date`, `datetime`, `document` |
| `required` | Boolean | Whether instances must provide this property |
| `defaultValue` | String | Optional, stored as string, interpreted by dataType |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

The `document` data type holds large text content interpreted as Markdown. It is only valid on entity type properties — the modeling layer rejects document properties on relation types, since the chunk/stub machinery is anchored to entity instances. Its logical behavior (stubs, chunking, passage search) is described under Document Chunks in §4.2; the physical chunk storage lives in `neo4j-adapter.md`.

**AiAgentConfig**

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

**SavedQuery**

| Property | Type | Notes |
|----------|------|-------|
| `savedQueryId` | String (UUID) | Stable identifier, immutable after creation |
| `key` | String | Unique within owning ontology, pattern `^[a-z][a-z0-9_-]*$` |
| `name` | String | Display name |
| `description` | String | Required description |
| `steps` | String (JSON) | Serialized step pipeline: `oql` steps carry query text in `oql`, `semantic_search` steps carry their search text in `query` (see `api-contracts/modeling-api.md`) |
| `parameters` | String (JSON) | Serialized list of `{name, description, dataType}` |
| `_ontologyKey` | String | Owning ontology key — denormalized for in-index filtering (see `neo4j-adapter.md`) |
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

Uniqueness of all IDs, names, and keys above — and of entity instance IDs — is enforced by database constraints, created on startup together with the supporting indexes. Entity type and relation type keys are globally unique. The concrete DDL is adapter-internal; see `neo4j-adapter.md`.

When an embedding provider is configured, semantic-search indexes are additionally ensured on startup: one per entity type, a shared cross-type index for search without a type filter, one for saved-query descriptions, and one per document property (kept in sync with the schema lifecycle — created when a document property is added, dropped when the property or its entity type is deleted). Physical index names and layouts are documented in `neo4j-adapter.md`.

**Cascading Deletes:**

- Deleting an **Ontology** removes its `INCLUDES_TYPE` edges and deletes all associated `AiAgentConfig` records (via `HAS_AI_AGENT`) and `SavedQuery` records (via `HAS_SAVED_QUERY`). Entity types, relation types, and properties are not affected (they are global).
- Deleting an **EntityType** fails with 409 Conflict if any relation type references it as source or target. With `cascade=true`, it also removes `INCLUDES_TYPE` edges from all ontologies. Its property definitions are deleted.
- Deleting a **RelationType** deletes its property definitions. With `cascade=true`, it also removes `INCLUDES_TYPE` edges from all ontologies.
- Deleting a **PropertyDefinition** is always allowed. With `cascade=true`, it also removes the property key from scoped ontology property lists.

### 4.2 Instance Representation

Instance data lives in the same database as schema data. Entity instances are graph nodes typed by their entity type key; relation instances are graph edges typed by their relation type key, connecting two entity instances. How the adapter maps type keys onto its physical storage is described in `neo4j-adapter.md`.

#### Entity Instances

**System properties** (underscore-prefixed, never collide with user properties which must start lowercase):

| Property | Type | Description |
|----------|------|-------------|
| `_id` | String (UUID) | Stable instance identifier, generated on creation |
| `_entityTypeKey` | String | Schema entity type key (e.g., `person`) |
| `_createdAt` | DateTime | Creation timestamp |
| `_updatedAt` | DateTime | Last-modified timestamp |
| `_embedding` | List of Float | Vector embedding of string properties, excluding document properties (only when an embedding provider is configured; never returned by the API) |
| `_doc_{key}_length` | Integer | Character count of the document property `{key}`, maintained at write time so reads can build stubs without loading the value (only on entities with document properties) |

**User-defined properties** are stored as individually typed values keyed by their property definition key — not serialized into a JSON blob. This enables native filtering, ordering, and indexing on property values. The mapping of schema data types to physical storage types is adapter-internal (see `neo4j-adapter.md`).

A `document` value is stored inline on the entity like any string, but it is treated specially everywhere else: it is excluded from the entity's `_embedding`, excluded from semantic-index filter metadata (and from the indexed property size limit that applies to indexed string properties), never returned inline in entity reads (a stub with the character length is returned instead), and — when an embedding provider is configured — chunked into dedicated chunk records for passage-level semantic search (see Document Chunks below). The API shapes for stubs, document reads, and search hits are defined in `api-contracts/runtime-api.md`.

#### Document Chunks

When an embedding provider is configured, each write of a document property synchronously replaces that property's chunks: the text is split into overlapping fixed-size character chunks (paragraph/sentence/whitespace boundaries preferred; sizes configured via `DOCUMENT_CHUNK_SIZE` and `DOCUMENT_CHUNK_OVERLAP`), each chunk is embedded — reusing the stored embedding when a chunk's text is unchanged, so partial writes only re-embed the chunks they touch — and the chunks are written as records linked to their owning entity. Without an embedding provider no chunks exist and `document` behaves as a plain long-text property.

Chunks store their character coordinates (`startChar`, `charLength`), the chunk text, the chunk vector, and denormalized owner references (`_entityId`, `_entityTypeKey`, `_propertyKey`) for direct index-to-entity resolution. Each (entity type, document property) pair gets its own vector index. There is no cross-type chunk index — cross-type document search queries the in-scope per-property indexes and merges by score. Physical chunk storage (marker labels, virtual labels, index names) is documented in `neo4j-adapter.md`.

**Lifecycle:** chunks are kept in sync on entity write (only the changed property's chunks are replaced); deleted together with their entity; dropped together with their vector index when the document property definition or its entity type is deleted; and rebuilt in full by the rebuild-embeddings operation. Chunks are internal derived data: hidden from the schema API, rejected by the OQL validator, and never exported — after an import they are regenerated by rebuild-embeddings.

#### Relation Instances

Each relation instance connects exactly two entity instances and is typed by its relation type key.

**System properties** on the relation:

| Property | Type | Description |
|----------|------|-------------|
| `_id` | String (UUID) | Stable instance identifier |
| `_relationTypeKey` | String | Schema relation type key (e.g., `works_for`) |
| `_createdAt` | DateTime | Creation timestamp |
| `_updatedAt` | DateTime | Last-modified timestamp |

**User-defined properties** are stored directly on the relation, with the same typed-value semantics as entity properties. The Neo4j adapter stores relations as native relationships — the rationale and its trade-offs are documented in `neo4j-adapter.md`.

#### Reserved Names

Entity and relation type keys that would collide with reserved internal names are rejected by the modeling service, on every write path — type creation and schema import alike. This keeps user-defined instance data structurally separate from the system's schema objects and internal storage structures. The concrete reserved set is derived from the adapter's physical naming and reaches the modeling service through the persistence port as plain type keys, so the service rejects a colliding key without knowing why it collides; an adapter with no such collisions reserves nothing (see `neo4j-adapter.md`).

Types created before the check existed are left in place — renaming a type key is destructive and is the operator's decision — but the server names each one in a startup warning, because their only other symptom is a failing modeling read once instance data exists under them.

### 4.3 Ontology Scoping

Multiple ontologies coexist in the same database as lenses over a shared global schema. Unscoped ontologies expose all types and properties. Scoped ontologies use `INCLUDES_TYPE` edges to expose a subset.

Instance data is shared — all ontologies see the same entities and relations. The ontology key in the runtime URL (`/api/runtime/{ontologyKey}/...`) determines which types and properties are visible for validation and response filtering. An entity created through one ontology is accessible through any other ontology that includes its type.

### 4.4 JSON Transfer Format

The export/import format is a self-contained JSON document:

```json
{
  "formatVersion": "3.0",
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
          "steps": [
            {
              "name": "string",
              "type": "oql",
              "oql": "MATCH (p:person) WHERE p.name = $name RETURN p"
            }
          ],
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

Saved-query steps are either `oql` steps (query text in the `oql` field) or `semantic_search` steps (search text in the `query` field). Import accepts format `2.x` payloads: the legacy step type `cypher` and its `cypher` field are mapped to `oql` on import.

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
| 500 | Storage failure (`STORAGE_ERROR`, with an `errorId` for log correlation) |

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

The runtime API is generic and schema-driven — endpoints use type keys from the ontology as path parameters. It covers schema introspection, entity and relation instance CRUD, graph traversal, and instance data management. Additional endpoints for semantic search, OQL queries, saved queries, and AI interaction are documented in the full contract.

**Endpoint summary (core data access):**

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
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}` | Read (a slice of) a document property |
| `PATCH` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}` | Partial write to a document property |
| `POST` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | Create relation instance |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | List relation instances |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Get relation instance |
| `PATCH` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Partial update relation instance |
| `DELETE` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Delete relation instance |

Full contract: see `api-contracts/runtime-api.md`

## 6. Frontend

React + TypeScript + Vite single-page application (`frontend/`) with two surfaces:

- **Studio** — schema design against the modeling API: entity/relation type editors with property management, ontology scoping, agents, saved queries, validation, export/import.
- **Workbench** — instance data work through one ontology lens against the runtime API: schema-driven type tables, entity detail, Explorer canvas, query workbench, AI assistant.

See `docs/runtime-ui-architecture.md` for the frontend architecture.

## 7. Data Flow

**Request lifecycle (modeling):**

```
HTTP Request
  → FastAPI router (path params, body parsing)
    → Pydantic schema validation (request model)
      → Service layer (business logic, cross-entity checks)
        → Store (persistence port)
          → Database adapter
        ← Store returns dict
      ← Service returns domain object
    ← Pydantic schema serialization (response model)
  ← HTTP Response (JSON)
```

The runtime module follows the same layered pattern against the same database, with an additional schema cache lookup step before validation.

**Error propagation:**

The adapter maps driver errors to domain exceptions (or returns `None` for missing records) → Service raises a domain exception (e.g., `NotFoundError`, `ConflictError`) → Exception handler in `main.py` maps to HTTP response with structured error body. Driver exception types never cross the persistence port.

Failures no domain exception describes — connection loss, timeouts, index state problems — become `StoreError`, so an unexpected storage failure is still answered with a structured body rather than a bare 500. Its message is deliberately empty of detail; the adapter logs the originating failure against the `errorId` the response carries, which is what ties a reported error to its server-side stack.

**Domain exceptions:**

| Exception | HTTP Status | Error Code |
|-----------|-------------|------------|
| `NotFoundError` | 404 | `RESOURCE_NOT_FOUND` |
| `ConflictError` | 409 | `RESOURCE_CONFLICT` |
| `ValidationError` | 422 | `VALIDATION_ERROR` |
| `StoreError` | 500 | `STORAGE_ERROR` |

## 8. Local Development

Dependencies are managed via Docker Compose. The default deployment runs the Neo4j adapter, so the compose stack provides a Neo4j instance as the current adapter's infrastructure.

**Docker Compose services:**
- `neo4j` — single database for both schema and instance data (ports 7474/7687), used by the Neo4j adapter

**Configuration:** The backend reads connection settings from environment variables.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_BACKEND` | `neo4j` | Persistence adapter selection (`neo4j` is the only built-in adapter) |
| `DB_URI` | `bolt://localhost:7687` | Database endpoint (Neo4j adapter) |
| `DB_USER` | `neo4j` | Database username (Neo4j adapter) |
| `DB_PASSWORD` | `ontoforge_dev` | Database password (Neo4j adapter) |
| `PORT` | `8000` | HTTP listen port |
| `DEFAULT_MCP_ONTOLOGY_KEY` | *(unset)* | MCP default ontology key (used when key is not in URL or header) |

**Running locally:**

```bash
# Start the database (Neo4j adapter)
docker compose up -d

# Start the server (serves both modeling and runtime)
uv run ontoforge-server
```

**Database bootstrap:** On startup, the adapter ensures all required constraints and indexes exist — both schema constraints (ontology, entity type, etc.) and instance constraints (entity `_id` uniqueness, entity type key index). The runtime schema cache is loaded lazily on first request per ontology, not at startup.
