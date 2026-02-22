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

Each server process connects to exactly one Neo4j database. In `model` mode it serves `/api/model` against the Model DB. In `runtime` mode it serves `/api/runtime` against the Instance DB. The two modes never share a database connection. Frontends communicate with the backend via REST only. The MCP layer will wrap REST endpoints for AI-driven access.

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
| API route | Runtime operations | `/api/runtime` |
| Frontend app | Schema design UI | `modeling` |
| Frontend app | Instance management UI | `runtime` |
| MCP | Adapter layer | TBD — likely `modeling-mcp`, `runtime-mcp` |
| Infrastructure | Schema library database | `neo4j-model` |
| Infrastructure | Runtime instance database | `neo4j-instance` |

### Neo4j Label and Relationship Naming

All Neo4j labels use PascalCase. Relationships use UPPER_SNAKE_CASE.

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
    ├── router.py         # FastAPI router, /api/runtime
    ├── service.py        # Instance CRUD, schema introspection
    ├── repository.py     # Neo4j Cypher queries (instance CRUD)
    └── schemas.py        # Runtime-specific request/response models
```

**Shared code boundary:** The export/import Pydantic models (`ExportPayload`, `ExportOntology`, `ExportEntityType`, etc.) will move from `modeling/schemas.py` to `core/schemas.py` when the runtime module is implemented. Both modules use these models: the modeling module for its export/import endpoints, the runtime module for its provision endpoint and schema introspection.

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
- Entity instance CRUD
- Relation instance CRUD
- Instance validation against the schema
- Reset (wipe all data and schema from Instance DB)

The runtime module reads schema data using the same Pydantic models and Neo4j query patterns as the modeling module's import/export. These shared models live in `core/schemas.py`. The runtime module has **no dependency** on the modeling module — it only depends on `core/`.

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
| `POST /api/runtime/provision` | Runtime server | Resets Instance DB, imports the JSON |

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
2. `POST http://localhost:8001/api/runtime/provision` with that JSON → runtime resets and imports

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

The Instance DB contains the same schema node structure as the Model DB (Ontology, EntityType, RelationType, PropertyDefinition — created by the import step) plus instance data nodes and relationships. Instance representation details are defined in Phase 2.

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

Base path: `/api/runtime`

Full contract: see `api-contracts/runtime-api.md` (deferred sketch)

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
uv run ontoforge-server provision \
  --model-db bolt://localhost:7687 \
  --instance-db bolt://localhost:7688 \
  --ontology <ontology-id>
```

**Database bootstrap:** On startup, the backend ensures required constraints and indexes exist. In `model` mode this creates schema constraints (ontology, entity type, etc.). In `runtime` mode this creates instance-specific constraints (TBD in Phase 2).
