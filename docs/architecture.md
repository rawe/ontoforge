# OntoForge — Architecture

> System-wide architecture for the OntoForge project.
> For detailed endpoint specs, see `api-contracts/`.

## 1. System Overview

<!-- TODO: High-level component map and their relationships -->
<!-- - One Python backend (modular monolith) -->
<!-- - Two React frontend apps (modeling, runtime) -->
<!-- - MCP adapter layer (deferred) -->
<!-- - Neo4j as single persistence layer -->
<!-- - How these components communicate -->

## 2. Naming Conventions

<!-- TODO: Settle naming for all components -->
<!-- - Frontend app names (rejected: "studio") -->
<!-- - Runtime API route name (under review: "use") -->
<!-- - Internal module/package naming scheme -->
<!-- - Neo4j label/relationship naming scheme -->

## 3. Backend

### 3.1 Module Structure

<!-- TODO: Internal package layout of the modular monolith -->
<!-- - Top-level Python package structure -->
<!-- - Shared infrastructure (Neo4j connection, error handling, middleware) -->
<!-- - Web framework choice and rationale -->

### 3.2 Modeling Module

<!-- TODO: Boundaries and responsibilities of the modeling module -->
<!-- - What it owns: schema CRUD, validation, export/import -->
<!-- - What it exposes to other modules (if anything) -->

### 3.3 Runtime Module

<!-- TODO (Phase 2): Boundaries and responsibilities of the runtime module -->
<!-- - What it owns: instance CRUD, search, neighborhood traversal -->
<!-- - How it reads schema without writing it -->

### 3.4 MCP Layer

<!-- TODO (Phase 4): REST-to-MCP adapter -->
<!-- - One MCP interface per mode (modeling, runtime) -->
<!-- - Tool-to-endpoint mapping strategy -->

## 4. Neo4j Storage Model

### 4.1 Schema Representation

<!-- TODO: How ontology schemas are stored in Neo4j -->
<!-- - Node labels for ontology, entity types, relation types -->
<!-- - Relationships between schema objects -->
<!-- - Property definitions storage strategy -->

### 4.2 Instance Representation

<!-- TODO (Phase 2): How instance data is stored -->
<!-- - Node labels and relationship types for instances -->
<!-- - UUID strategy for stable identifiers -->
<!-- - How instances reference their schema types -->

### 4.3 Ontology Isolation

<!-- TODO: How ontologyId scopes all data -->
<!-- - X-Ontology-Id header extraction (middleware or dependency injection) -->
<!-- - Scoping all queries to the active ontology -->
<!-- - Behavior when header is missing or invalid -->
<!-- - Index and constraint strategy for isolation -->

## 5. API Design

### 5.1 Common Conventions

<!-- TODO: Shared patterns across all API endpoints -->
<!-- - Header conventions (X-Ontology-Id) -->
<!-- - Error response format (code, message, details) -->
<!-- - Validation error shape -->
<!-- - HTTP status code usage -->
<!-- - Pagination pattern (for future use) -->

### 5.2 Modeling API

<!-- TODO: Summary of modeling API design decisions -->
<!-- - Base path and route structure -->
<!-- - Full contract: see api-contracts/modeling-api.md -->

### 5.3 Runtime API

<!-- TODO (Phase 2): Summary of runtime API design decisions -->
<!-- - Base path and route structure -->
<!-- - Full contract: see api-contracts/runtime-api.md -->

## 6. Frontend

### 6.1 App Structure

<!-- TODO (Phase 3): Shared frontend patterns -->
<!-- - Tech stack (React, state management, routing) -->
<!-- - Shared component strategy -->
<!-- - How frontends consume the backend API -->

### 6.2 Modeling UI

<!-- TODO (Phase 3): Schema modeling interface -->
<!-- - Key screens and workflows -->

### 6.3 Runtime UI

<!-- TODO (Phase 3): Instance management interface -->
<!-- - Key screens and workflows -->
<!-- - Dynamic form generation from schema -->

## 7. Data Flow

<!-- TODO: End-to-end request lifecycle -->
<!-- - HTTP request → middleware (ontology extraction) → route → validation → service → repository → Neo4j → response -->
<!-- - Layer responsibilities and boundaries -->
<!-- - Error propagation strategy -->
