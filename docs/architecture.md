# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

OntoForge consists of:

- **ontoforge-server** — a Python modular monolith providing REST APIs for both modeling and runtime
- **modeling** (frontend) — React app for schema design
- **runtime** (frontend) — React app for instance management (deferred)
- **MCP adapters** (deferred) — likely split into modeling-mcp and runtime-mcp, granularity TBD
- **Neo4j Model DB** — holds all ontology schemas, multiple ontologies isolated by `ontologyId`
- **Neo4j Instance DB** — holds a copied schema and instance data for one ontology (deferred)

The backend exposes two route trees (`/api/model`, `/api/runtime`) from one application. Each module talks to its own Neo4j instance — no cross-database references at query time. Frontends communicate with the backend via REST only. The MCP layer will wrap REST endpoints for AI-driven access.

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

The `ontoforge-server` is a modular monolith with three core modules:

- **core** — shared infrastructure: Neo4j connections, configuration, error handling
- **modeling** — schema management, talks only to the Model DB
- **runtime** — instance management, talks only to the Instance DB (deferred)

The modules are fully decoupled at the database level. Each connects to its own Neo4j instance. The only bridge between them is a deliberate provisioning step that copies a schema from Model DB to Instance DB.

**Python package structure:**

```
backend/src/ontoforge_server/
├── __init__.py
├── main.py              # FastAPI app factory, lifespan, CORS
├── config.py            # Pydantic Settings from environment
├── core/
│   ├── __init__.py
│   ├── database.py      # Neo4j async driver management
│   └── exceptions.py    # Domain exceptions → HTTP mapping
└── modeling/
    ├── __init__.py
    ├── router.py         # FastAPI router, /api/model
    ├── service.py        # Business logic, validation
    ├── repository.py     # Neo4j Cypher queries
    └── schemas.py        # Pydantic request/response models
```

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

<!-- Deferred to Phase 2. -->

### 3.4 MCP Layer

<!-- Deferred to Phase 4. -->

## 4. Neo4j Storage Model

Two separate Neo4j instances serve different purposes:

- **Model DB** — the schema library. Holds multiple ontologies, each isolated by `ontologyId`. Only the modeling module reads and writes here.
- **Instance DB** — the working database. Holds a copied schema for exactly one ontology plus all its instance data. Only the runtime module reads and writes here. (Deferred.)

A deliberate **provisioning step** copies an ontology schema from the Model DB into the Instance DB. After provisioning, the Instance DB is fully self-contained — no cross-database references.

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

<!-- Deferred to Phase 2. -->

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

**Ontology scoping:** The modeling API nests resources under `/api/model/ontologies/{ontologyId}/...`. No header-based scoping is needed for modeling — the ontology is explicit in the URL path.

> Note: The `X-Ontology-Id` header approach from the PRD applies to the runtime API, where a single ontology context is assumed. For modeling, where users manage multiple ontologies, path-based scoping is more natural.

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
- `neo4j-model` — Model DB for schema storage
- `neo4j-instance` — Instance DB for runtime data (included but not needed for Phase 1)

During Phase 1 (modeling only), only `neo4j-model` is needed.

**Configuration:** The backend reads connection settings from environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `MODEL_DB_URI` | `bolt://localhost:7687` | Model DB Bolt endpoint |
| `MODEL_DB_USER` | `neo4j` | Model DB username |
| `MODEL_DB_PASSWORD` | `ontoforge_dev` | Model DB password |
| `INSTANCE_DB_URI` | `bolt://localhost:7688` | Instance DB Bolt endpoint (deferred) |
| `INSTANCE_DB_USER` | `neo4j` | Instance DB username (deferred) |
| `INSTANCE_DB_PASSWORD` | `ontoforge_dev` | Instance DB password (deferred) |

**Database bootstrap:** On startup, the backend ensures required constraints and indexes exist in the Model DB. This is idempotent — safe to run on every startup.
