# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

OntoForge consists of:

- **ontoforge-server** — a Python modular monolith providing REST APIs for both modeling and runtime
- **modeling** (frontend) — React app for schema design
- **runtime** (frontend) — React app for instance management
- **MCP adapters** (deferred) — likely split into modeling-mcp and runtime-mcp, granularity TBD
- **Neo4j Model DB** — holds all ontology schemas, multiple ontologies isolated by `ontologyId`
- **Neo4j Instance DB** — holds a copied schema and instance data for one ontology

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

<!-- TODO: Neo4j label/relationship naming scheme (§4) -->

## 3. Backend

### 3.1 Module Structure

The `ontoforge-server` is a modular monolith with three core modules:

- **core** — shared infrastructure: Neo4j connections, configuration, middleware, error handling
- **modeling** — schema management, talks only to the Model DB
- **runtime** — instance management, talks only to the Instance DB

The modules are fully decoupled at the database level. Each connects to its own Neo4j instance. The only bridge between them is a deliberate provisioning step that copies a schema from Model DB to Instance DB.

<!-- TODO: Top-level Python package structure -->
<!-- TODO: Web framework choice and rationale -->

### 3.2 Modeling Module

Owns all schema operations. Standalone — no dependency on the runtime module or Instance DB.

- Ontology metadata CRUD
- Entity type and relation type CRUD
- Property definition CRUD
- Schema validation
- Export/import via a Neo4j-independent JSON transfer format

### 3.3 Runtime Module

<!-- TODO (Phase 2): Detail when runtime implementation begins -->

Owns all instance operations. Talks only to the Instance DB, which contains its own copy of the schema.

- Generic entity and relation instance CRUD
- Instance validation against the schema copy in the Instance DB
- Search, filtering, neighborhood traversal

No dependency on the modeling module or Model DB at query time.

### 3.4 MCP Layer

<!-- TODO (Phase 4): Detail when MCP implementation begins -->
<!-- - Likely separate modeling-mcp and runtime-mcp -->
<!-- - Tool-to-endpoint mapping strategy -->
<!-- - Granularity TBD -->

## 4. Neo4j Storage Model

Two separate Neo4j instances serve different purposes:

- **Model DB** — the schema library. Holds multiple ontologies, each isolated by `ontologyId`. Only the modeling module reads and writes here.
- **Instance DB** — the working database. Holds a copied schema for exactly one ontology plus all its instance data. Only the runtime module reads and writes here.

A deliberate **provisioning step** copies an ontology schema from the Model DB into the Instance DB. After provisioning, the Instance DB is fully self-contained — no cross-database references.

### 4.1 Schema Representation

<!-- TODO: How ontology schemas are stored in Neo4j -->
<!-- - Node labels for ontology, entity types, relation types -->
<!-- - Relationships between schema objects -->
<!-- - Property definitions storage strategy -->
<!-- - Same structure in both Model DB and Instance DB (copy is structural) -->

**JSON transfer format:** The schema has a canonical JSON representation independent of Neo4j. This format is used for export/import and serves as the portability layer. The provisioning step may use this same format internally.

<!-- TODO: Define the JSON transfer format structure -->

### 4.2 Instance Representation

<!-- TODO (Phase 2): How instance data is stored -->
<!-- - Node labels and relationship types for instances -->
<!-- - UUID strategy for stable identifiers -->
<!-- - How instances reference their schema types within the Instance DB -->

### 4.3 Ontology Isolation

In the **Model DB**, multiple ontologies coexist, isolated by `ontologyId`.

In the **Instance DB**, only one ontology exists. The `ontologyId` is still present for consistency but acts as an assertion rather than a filter.

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

## 8. Local Development

Dependencies are managed via Docker Compose. The backend never starts containers — it connects to pre-configured Neo4j instances.

**Docker Compose services:**
- `neo4j-model` — Model DB for schema storage
- `neo4j-instance` — Instance DB for runtime data

During Phase 1 (modeling only), only `neo4j-model` is needed.

**Configuration:** The backend uses environment variables for each database connection:

<!-- TODO: Define exact config variables (URI, credentials per DB) -->
<!-- TODO: Define database bootstrap process (constraints, indexes, initial structure) -->
<!-- TODO: Define the provisioning step (copy schema from Model DB → Instance DB) -->
