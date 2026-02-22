# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

OntoForge consists of:

- **ontoforge-server** — a Python application that runs in one of two modes: `model` or `runtime`
- **modeling** (frontend) — React app for schema design
- **runtime** (frontend) — React app for instance management (deferred)
- **MCP adapters** (deferred) — likely split into modeling-mcp and runtime-mcp, granularity TBD
- **Neo4j Model DB** — holds all ontology schemas, multiple ontologies isolated by `ontologyId`
- **Neo4j Instance DB** — holds a copied schema and instance data for one ontology

Each server process connects to exactly one Neo4j database. In `model` mode it serves `/api/model` against the Model DB. In `runtime` mode it serves `/api` against the Instance DB. The two modes never share a database connection. Frontends communicate with the backend via REST only. The MCP layer will wrap REST endpoints for AI-driven access.

In production, these are separate deployments: one modeling server managing ontologies, one or more runtime servers each serving a single ontology. Locally, both can run simultaneously on different ports.

## 2. Naming Conventions

| Layer | Component | Name |
|-------|-----------|------|
| Backend app | Python application | `ontoforge-server` |
| Backend module | Schema CRUD, validation, export/import | `modeling` |
| Backend module | Instance CRUD, search, traversal | `runtime` |
| Backend module | Shared infrastructure | `core` |
| Store | Schema persistence (Model DB) | `modeling store` |
| Store | Instance persistence (Instance DB) | `runtime store` |
| API route | Schema modeling | `/api/model` |
| API route | Runtime operations | `/api` |
| Frontend app | Schema design UI | `modeling` |
| Frontend app | Instance management UI | `runtime` |
| MCP | Adapter layer | TBD — likely `modeling-mcp`, `runtime-mcp` |
| Infrastructure | Schema library database | `neo4j-model` |
| Infrastructure | Runtime instance database | `neo4j-instance` |

### Neo4j Label and Relationship Naming

All Neo4j labels use PascalCase. Relationships use UPPER_SNAKE_CASE.

**Schema nodes (Model DB and Instance DB):**

| Neo4j Element | Name |
|---------------|------|
| Node label | `Ontology` |
| Node label | `EntityType` |
| Node label | `RelationType` |
| Node label | `PropertyDefinition` |
| Relationship | `HAS_ENTITY_TYPE` (Ontology → EntityType) |
| Relationship | `HAS_RELATION_TYPE` (Ontology → RelationType) |
| Relationship | `HAS_PROPERTY` (EntityType/RelationType → PropertyDefinition) |
| Relationship | `RELATES_FROM` (RelationType → EntityType) |
| Relationship | `RELATES_TO` (RelationType → EntityType) |

**Instance nodes (Instance DB only):**

| Neo4j Element | Name | Rule |
|---------------|------|------|
| Marker label | `_Entity` | Present on every entity instance node |
| Type label | e.g. `Person`, `ResearchPaper` | Entity type key converted to PascalCase |
| Relationship type | e.g. `WORKS_FOR`, `AUTHORED_BY` | Relation type key converted to UPPER_SNAKE_CASE |

The underscore-prefixed `_Entity` label separates instance nodes from schema nodes. Entity type keys are converted from `snake_case` to `PascalCase` (split on underscores, capitalize segments). Relation type keys are converted to `UPPER_SNAKE_CASE`.

## 3. Backend

### 3.1 Module Structure

The `ontoforge-server` is a modular monolith with three code modules. At startup, the server mode determines which module's routes are mounted and which database is connected.

- **core** — shared infrastructure: Neo4j driver, configuration, error handling, Pydantic models for the ontology schema (used by both modes)
- **modeling** — schema management (CRUD, validation, export/import). Mounted in `model` mode.
- **runtime** — instance management (entity/relation CRUD, schema introspection). Mounted in `runtime` mode.

Both modes use the same `core/database.py` driver — it always connects to a single database. The mode determines which database that is (via environment variables).

The runtime module reuses schema Pydantic models from `core/` to read the ontology that was provisioned into the Instance DB. It does **not** import from or depend on the `modeling` module.

**Python package structure:**

```
backend/src/ontoforge_server/
├── __init__.py
├── main.py              # FastAPI app factory, mode-based route mounting
├── config.py            # Pydantic Settings from environment
├── core/
│   ├── __init__.py
│   ├── database.py      # Neo4j async driver management (single connection)
│   ├── exceptions.py    # Domain exceptions → HTTP mapping
│   └── schemas.py       # Shared Pydantic models (ontology schema, export format)
├── modeling/
│   ├── __init__.py
│   ├── router.py         # FastAPI router, /api/model
│   ├── service.py        # Business logic, validation, export/import
│   ├── repository.py     # Neo4j Cypher queries (schema CRUD)
│   └── schemas.py        # Modeling-specific request/response models
└── runtime/              # Phase 2
    ├── __init__.py
    ├── router.py         # FastAPI router, /api
    ├── service.py        # Instance CRUD, validation, schema introspection
    ├── repository.py     # Neo4j Cypher queries (instance CRUD)
    └── schemas.py        # Runtime-specific request/response models
```

**Shared code boundary:** The export/import Pydantic models (`ExportPayload`, `ExportOntology`, `ExportEntityType`, etc.) live in `core/schemas.py`. Both modules use these models: the modeling module for its export/import endpoints, the runtime module for its provision endpoint and schema introspection.

**Web framework:** FastAPI. Chosen for async support, Pydantic integration, and automatic OpenAPI docs.

### 3.2 Modeling Module

Owns all schema operations. Standalone — no dependency on the runtime module or Instance DB.

- Ontology metadata CRUD
- Entity type and relation type CRUD
- Property definition CRUD
- Schema validation
- Export/import via a Neo4j-independent JSON transfer format

**Layer responsibilities:**

| Layer | Responsibility |
|-------|---------------|
| `router.py` | HTTP handling, path/query params, delegates to service |
| `schemas.py` | Pydantic models for request validation and response serialization |
| `service.py` | Business logic, cross-entity validation, orchestrates repository calls |
| `repository.py` | Raw Cypher queries against Model DB, returns dicts/primitives |

The service layer raises domain exceptions (from `core/exceptions.py`). The exception handler in `main.py` maps these to HTTP responses.

### 3.3 Runtime Module

Owns all instance operations. Runs against the Instance DB, which contains exactly one ontology (provisioned via import).

- Schema introspection (read-only — reads the ontology already in the Instance DB)
- Entity instance CRUD (create, read, update, delete, list with filtering)
- Relation instance CRUD (create, read, update, delete, list with filtering)
- Neighborhood exploration (graph traversal from a given entity)
- Instance validation against the schema
- Provision (reset Instance DB and import ontology JSON)

The runtime module reads schema data using the same Pydantic models and Neo4j query patterns as the modeling module's import/export. These shared models live in `core/schemas.py`. The runtime module has **no dependency** on the modeling module — it only depends on `core/`.

**Schema cache:** On startup, the runtime loads the full schema from the Instance DB into an in-memory dataclass structure (`SchemaCache`). This avoids per-request database reads for schema data. The cache is rebuilt atomically (pointer swap) whenever the provision endpoint is called. Since FastAPI runs on a single asyncio event loop, no locking is needed.

**Validation:** Every write operation validates properties against the schema cache before executing Cypher. All validation errors are collected and returned at once (not fail-fast). The validation pipeline checks type existence, required properties, unknown properties, and data type coercion.

**Dynamic Cypher safety:** Entity type keys become Neo4j labels and relation type keys become relationship types in generated Cypher. These values are never raw user input — they come from the schema cache, which was built from the provisioned ontology. Only property *values* are passed as Cypher parameters. This makes dynamic Cypher construction safe from injection.

### 3.4 MCP Layer

<!-- Deferred to Phase 4. -->

## 4. Neo4j Storage Model

Two separate Neo4j instances serve different purposes:

- **Model DB** — the schema library. Holds multiple ontologies, each isolated by `ontologyId`. Only the modeling server reads and writes here.
- **Instance DB** — the working database. Holds a copied schema for exactly one ontology plus all its instance data. Only the runtime server reads and writes here.

A deliberate **provisioning step** transfers an ontology schema from the Model DB into the Instance DB. This uses the existing JSON export/import format as an internal bridge — the modeling server exports, the runtime server imports. After provisioning, the Instance DB is fully self-contained.

### 4.0 Provisioning Workflow

Provisioning is the one-time step that prepares an Instance DB for runtime use. It relies entirely on two existing HTTP endpoints — no direct database connections, no new low-level code.

**Endpoints involved:**

| Endpoint | Server | Purpose |
|----------|--------|---------|
| `GET /api/model/ontologies/{id}/export` | Modeling server | Exports ontology as JSON |
| `POST /api/provision` | Runtime server | Resets Instance DB, imports the JSON |

The runtime provision endpoint wipes the Instance DB (all nodes, relationships, constraints) and then imports the received ontology JSON. This ensures a clean state. In future phases, this may evolve to support migration (non-destructive updates), but initially it is always a full reset.

**Provisioning script:** A convenience script orchestrates the two API calls. It has no database dependencies — it is purely an HTTP client.

```bash
# Both servers must be running
uv run ontoforge-provision \
  --model-url http://localhost:8000 \
  --runtime-url http://localhost:8001 \
  --ontology <ontology-id>
```

The script does:
1. `GET http://localhost:8000/api/model/ontologies/{id}/export` → receives JSON
2. `POST http://localhost:8001/api/provision` with that JSON → runtime resets and imports

This is fully decoupled: each server only knows about its own database. The script only knows about HTTP endpoints.

The Instance DB holds exactly one ontology at a time. The `ontologyId` is preserved for reference but is not used for scoping — all queries assume a single ontology.

### 4.1 Schema Representation (Model DB)

All schema objects are stored as Neo4j nodes connected by typed relationships.

**Node: Ontology**

| Property | Type | Notes |
|----------|------|-------|
| `ontologyId` | String (UUID) | Stable identifier, immutable after creation |
| `name` | String | Display name, unique across all ontologies |
| `description` | String | Optional |
| `createdAt` | DateTime | Set on creation |
| `updatedAt` | DateTime | Updated on every mutation |

**Node: EntityType**

| Property | Type | Notes |
|----------|------|-------|
| `entityTypeId` | String (UUID) | Stable identifier |
| `key` | String | Unique within owning ontology |
| `displayName` | String | Human-readable name |
| `description` | String | Optional |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Node: RelationType**

| Property | Type | Notes |
|----------|------|-------|
| `relationTypeId` | String (UUID) | Stable identifier |
| `key` | String | Unique within owning ontology |
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

**Relationships:**

```
(Ontology)-[:HAS_ENTITY_TYPE]->(EntityType)
(Ontology)-[:HAS_RELATION_TYPE]->(RelationType)
(EntityType)-[:HAS_PROPERTY]->(PropertyDefinition)
(RelationType)-[:HAS_PROPERTY]->(PropertyDefinition)
(RelationType)-[:RELATES_FROM]->(EntityType)
(RelationType)-[:RELATES_TO]->(EntityType)
```

**Constraints and Indexes:**

```cypher
-- Unique ontology name
CREATE CONSTRAINT ontology_name_unique FOR (o:Ontology) REQUIRE o.name IS UNIQUE;
-- Unique ontology ID
CREATE CONSTRAINT ontology_id_unique FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE;
-- Unique entity type ID
CREATE CONSTRAINT entity_type_id_unique FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE;
-- Unique relation type ID
CREATE CONSTRAINT relation_type_id_unique FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE;
-- Unique property ID
CREATE CONSTRAINT property_id_unique FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE;
```

Key uniqueness within an ontology (e.g., no two entity types with the same `key` under one ontology) is enforced at the application level in the service layer, since Neo4j community edition does not support composite constraints across relationships.

**Cascading Deletes:**

- Deleting an **Ontology** deletes all its entity types, relation types, and property definitions.
- Deleting an **EntityType** fails with 409 Conflict if any relation type references it as source or target. Its property definitions are deleted.
- Deleting a **RelationType** deletes its property definitions.
- Deleting a **PropertyDefinition** is always allowed.

### 4.2 Instance Representation (Instance DB)

The Instance DB contains the same schema node structure as the Model DB (Ontology, EntityType, RelationType, PropertyDefinition — created by the provisioning step) plus entity instance nodes and relation instance relationships.

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

#### Constraints and Indexes

```cypher
-- Entity instance uniqueness
CREATE CONSTRAINT entity_instance_id_unique
  FOR (n:_Entity) REQUIRE n._id IS UNIQUE;

-- Index on entity type key for type-scoped queries
CREATE INDEX entity_type_key_index
  FOR (n:_Entity) ON (n._entityTypeKey);

-- Schema constraints (same as Model DB, created during provision)
CREATE CONSTRAINT ontology_id_unique FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE;
CREATE CONSTRAINT entity_type_id_unique FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE;
CREATE CONSTRAINT relation_type_id_unique FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE;
CREATE CONSTRAINT property_id_unique FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE;
```

#### Reserved Label Collision

Entity type keys are converted to PascalCase labels. If an entity type key matches a schema label (e.g., `ontology` → `Ontology`), instance nodes would share a label with schema nodes. The provisioning step rejects entity type keys that would collide with reserved labels: `Ontology`, `EntityType`, `RelationType`, `PropertyDefinition`.

### 4.3 Ontology Isolation

In the **Model DB**, multiple ontologies coexist. Isolation is achieved through the graph structure — entity types belong to an ontology via `HAS_ENTITY_TYPE`, not via a property filter. All queries start from the `Ontology` node and traverse outward.

In the **Instance DB**, only one ontology exists. The `ontologyId` is still present for consistency but acts as an assertion rather than a filter.

### 4.4 JSON Transfer Format

The export/import format is a self-contained JSON document:

```json
{
  "formatVersion": "1.0",
  "ontology": {
    "ontologyId": "uuid",
    "name": "string",
    "description": "string"
  },
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
  ]
}
```

UUIDs are not included in the export for entity types, relation types, or properties — they are regenerated on import. Only `ontologyId` is preserved for identity.

## 5. API Design

### 5.1 Common Conventions

**Ontology scoping:** The modeling API nests resources under `/api/model/ontologies/{ontologyId}/...` — the ontology is explicit in the URL path. The runtime API has no ontology scoping — it always operates on the single ontology provisioned into the Instance DB.

**Runtime URL pattern:** Since the server only serves one mode at a time, the runtime API uses `/api` directly without a mode prefix. When started in runtime mode, there is no modeling API on the server, so no ambiguity exists. The modeling API retains its `/api/model` prefix.

**Error response format:**

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Entity type with key 'Person' not found in ontology 'abc-123'",
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

Base path: `/api`

The runtime API is generic and schema-driven — endpoints use type keys from the provisioned ontology as path parameters. It covers provisioning, schema introspection, entity and relation instance CRUD, and graph traversal.

**Endpoint summary:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/provision` | Reset Instance DB and import ontology |
| `GET` | `/api/schema` | Full schema introspection |
| `GET` | `/api/schema/entity-types` | List entity types |
| `GET` | `/api/schema/entity-types/{key}` | Get entity type with properties |
| `GET` | `/api/schema/relation-types` | List relation types |
| `GET` | `/api/schema/relation-types/{key}` | Get relation type with properties |
| `POST` | `/api/entities/{entityTypeKey}` | Create entity instance |
| `GET` | `/api/entities/{entityTypeKey}` | List/search entity instances |
| `GET` | `/api/entities/{entityTypeKey}/{id}` | Get entity instance |
| `PATCH` | `/api/entities/{entityTypeKey}/{id}` | Partial update entity instance |
| `DELETE` | `/api/entities/{entityTypeKey}/{id}` | Delete entity instance |
| `GET` | `/api/entities/{entityTypeKey}/{id}/neighbors` | Graph traversal |
| `POST` | `/api/relations/{relationTypeKey}` | Create relation instance |
| `GET` | `/api/relations/{relationTypeKey}` | List relation instances |
| `GET` | `/api/relations/{relationTypeKey}/{id}` | Get relation instance |
| `PATCH` | `/api/relations/{relationTypeKey}/{id}` | Partial update relation instance |
| `DELETE` | `/api/relations/{relationTypeKey}/{id}` | Delete relation instance |

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
          → Neo4j Model DB
        ← Repository returns dict
      ← Service returns domain object
    ← Pydantic schema serialization (response model)
  ← HTTP Response (JSON)
```

The runtime mode follows the same layered pattern against the Instance DB.

**Error propagation:**

Repository raises `Neo4jError` or returns `None` → Service raises domain exception (e.g., `NotFoundError`, `ConflictError`) → Exception handler in `main.py` maps to HTTP response with structured error body.

**Domain exceptions:**

| Exception | HTTP Status | Error Code |
|-----------|-------------|------------|
| `NotFoundError` | 404 | `RESOURCE_NOT_FOUND` |
| `ConflictError` | 409 | `RESOURCE_CONFLICT` |
| `ValidationError` | 422 | `VALIDATION_ERROR` |

## 8. Local Development

Dependencies are managed via Docker Compose. The backend never starts containers — it connects to pre-configured Neo4j instances.

**Docker Compose services:**
- `neo4j-model` — Model DB for schema storage (ports 7474/7687)
- `neo4j-instance` — Instance DB for runtime data (ports 7475/7688)

**Server mode:** The server runs in either `model` or `runtime` mode, determined by the `SERVER_MODE` environment variable. Each mode connects to one database.

**Configuration:** The backend reads connection settings from environment variables. Both modes use the same variable names — the values differ per mode.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SERVER_MODE` | `model` | `model` or `runtime` |
| `DB_URI` | `bolt://localhost:7687` | Neo4j Bolt endpoint |
| `DB_USER` | `neo4j` | Neo4j username |
| `DB_PASSWORD` | `ontoforge_dev` | Neo4j password |
| `PORT` | `8000` | HTTP listen port |

**Local dev with both modes:** Use two `.env` files or run with inline env vars:

```bash
# Terminal 1 — modeling server (Model DB)
DB_URI=bolt://localhost:7687 uv run ontoforge-server

# Terminal 2 — runtime server (Instance DB)
SERVER_MODE=runtime DB_URI=bolt://localhost:7688 PORT=8001 uv run ontoforge-server

# One-time provisioning (transfers ontology from Model DB → Instance DB)
uv run ontoforge-provision \
  --model-url http://localhost:8000 \
  --runtime-url http://localhost:8001 \
  --ontology <ontology-id>
```

**Database bootstrap:** On startup, the backend ensures required constraints and indexes exist. In `model` mode this creates schema constraints (ontology, entity type, etc.). In `runtime` mode this creates both schema constraints (for the provisioned ontology nodes) and instance-specific constraints (`_Entity` uniqueness on `_id`, entity type key index).
