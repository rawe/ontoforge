# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

OntoForge consists of:

- **ontoforge-server** — a Python modular monolith providing REST APIs for both modeling and runtime
- **modeling** (frontend) — React app for schema design
- **runtime** (frontend) — React app for instance management
- **MCP adapters** (deferred) — likely split into modeling-mcp and runtime-mcp, granularity TBD
- **Neo4j** — single database holding both schema and instance data

The backend exposes two route trees (`/api/model`, `/api/runtime`) from one application. Frontends communicate with the backend via REST only. The MCP layer will wrap REST endpoints for AI-driven access.

## 2. Naming Conventions

| Layer | Component | Name |
|-------|-----------|------|
| Backend app | Python application | `ontoforge-server` |
| Backend module | Schema CRUD, validation, export/import | `modeling` |
| Backend module | Instance CRUD, search, traversal | `runtime` |
| Backend module | Shared infrastructure | `core` |
| Store | Schema persistence | `modeling store` |
| Store | Instance persistence (depends on modeling store) | `runtime store` |
| API route | Schema modeling | `/api/model` |
| API route | Runtime operations | `/api/runtime` |
| Frontend app | Schema design UI | `modeling` |
| Frontend app | Instance management UI | `runtime` |
| MCP | Adapter layer | TBD — likely `modeling-mcp`, `runtime-mcp` |

<!-- TODO: Neo4j label/relationship naming scheme (§4) -->

## 3. Backend

### 3.1 Module Structure

The `ontoforge-server` is a modular monolith with three core modules:

- **core** — shared infrastructure: Neo4j connection, configuration, middleware, error handling
- **modeling** — schema management, depends only on `core`
- **runtime** — instance management, depends on `core` and reads schema via the modeling store

<!-- TODO: Top-level Python package structure -->
<!-- TODO: Web framework choice and rationale -->

### 3.2 Modeling Module

Owns all schema operations. Standalone — no dependency on the runtime module.

- Ontology metadata CRUD
- Entity type and relation type CRUD
- Property definition CRUD
- Schema validation
- Export/import via a Neo4j-independent JSON transfer format

The modeling store provides read access to schema data that the runtime store depends on.

### 3.3 Runtime Module

<!-- TODO (Phase 2): Detail when runtime implementation begins -->

Owns all instance operations. Depends on the modeling store for schema reads (validation, generic persistence).

- Generic entity and relation instance CRUD
- Instance validation against schema
- Search, filtering, neighborhood traversal

Dependency direction: `runtime → modeling store` (read-only). Never the reverse.

### 3.4 MCP Layer

<!-- TODO (Phase 4): Detail when MCP implementation begins -->
<!-- - Likely separate modeling-mcp and runtime-mcp -->
<!-- - Tool-to-endpoint mapping strategy -->
<!-- - Granularity TBD -->

## 4. Neo4j Storage Model

One Neo4j database holds two layers of data:

- **Schema layer** — the ontology definition (entity types, relation types, property definitions). Written and read by the modeling module.
- **Instance layer** — concrete nodes and relationships conforming to the schema. Written and read by the runtime module.

The schema layer describes the instance layer — it is a meta-schema within the same graph.

### 4.1 Schema Representation

<!-- TODO: How ontology schemas are stored in Neo4j -->
<!-- - Node labels for ontology, entity types, relation types -->
<!-- - Relationships between schema objects -->
<!-- - Property definitions storage strategy -->

**JSON transfer format:** The schema has a canonical JSON representation independent of Neo4j. This format is used for export/import and serves as the portability layer. It defines what a schema looks like regardless of storage backend.

<!-- TODO: Define the JSON transfer format structure -->

### 4.2 Instance Representation

<!-- TODO (Phase 2): How instance data is stored -->
<!-- - Node labels and relationship types for instances -->
<!-- - UUID strategy for stable identifiers -->
<!-- - How instances reference their schema types -->

### 4.3 Ontology Isolation

All schema and instance data is scoped by `ontologyId`. Both layers coexist in the same Neo4j database, isolated by this identifier.

<!-- TODO: X-Ontology-Id header extraction (middleware or dependency injection) -->
<!-- TODO: Scoping strategy for all queries -->
<!-- TODO: Behavior when header is missing or invalid -->
<!-- TODO: Index and constraint strategy -->

## 5. API Design

### 5.1 Common Conventions

<!-- TODO: Shared patterns across all API endpoints -->
<!-- - Header conventions (X-Ontology-Id) -->
<!-- - Error response format (code, message, details) -->
<!-- - Validation error shape -->
<!-- - HTTP status code usage -->
<!-- - Pagination pattern (for future use) -->

### 5.2 Modeling API

Base path: `/api/model`

Full contract: see `api-contracts/modeling-api.md`

<!-- TODO: Summary of key design decisions once contract is written -->

### 5.3 Runtime API

Base path: `/api/runtime`

Full contract: see `api-contracts/runtime-api.md`

<!-- TODO (Phase 2): Summary of key design decisions -->

## 6. Frontend

### 6.1 App Structure

<!-- TODO (Phase 3): Shared frontend patterns -->
<!-- - Tech stack (React, state management, routing) -->
<!-- - Shared component strategy -->
<!-- - How frontends consume the backend API -->

### 6.2 Modeling UI

<!-- TODO (Phase 3): Schema modeling interface -->

### 6.3 Runtime UI

<!-- TODO (Phase 3): Instance management interface -->
<!-- - Dynamic form generation from schema -->

## 7. Data Flow

<!-- TODO: End-to-end request lifecycle -->
<!-- - HTTP request → middleware (ontology extraction) → route → validation → service → repository → Neo4j → response -->
<!-- - Layer responsibilities and boundaries -->
<!-- - Error propagation strategy -->
