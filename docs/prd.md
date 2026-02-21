# PRD — OntoForge

## 1. Overview

OntoForge is a system for designing graph-based ontologies and using them through schema-driven, generic APIs. It separates the concerns of **schema modeling** and **knowledge runtime usage**, while keeping both schema and data portable and self-contained. The system enables users to define entity and relation types, persist them, and then create and manage instance data based strictly on that schema.

The product supports export and import of ontologies in a JSON-based format and is designed to evolve toward managing multiple ontologies within a single installation.

---

## 2. Vision

Enable structured knowledge modeling without hardcoding domain-specific APIs.  
Users define an ontology once and immediately gain a generic, schema-driven interface for creating and managing knowledge graphs.  
The system abstracts the underlying graph database while remaining portable and self-contained.

---

## 3. Core Concepts

### 3.1 Ontology
An ontology represents a self-contained schema definition and its associated metadata.

Each ontology has:
- `ontologyId` (stable identifier)
- `name`
- `description`
- Metadata fields (e.g., timestamps)
- A collection of entity types
- A collection of relation types

Multiple ontologies may be supported in the future.

---

### 3.2 Entity Type
Defines a category of nodes in the graph.

Attributes:
- `key` (unique within ontology)
- `displayName`
- `description`
- A set of property definitions

---

### 3.3 Relation Type
Defines a typed connection between two entity types.

Attributes:
- `key` (unique within ontology)
- `displayName`
- `description`
- `fromEntityTypeKey`
- `toEntityTypeKey`
- A set of property definitions

---

### 3.4 Property Definition
Defines an attribute of either an entity type or relation type.

Attributes (MVP):
- `key`
- `displayName`
- `description`
- `required` (boolean)
- `type` (string in MVP; extensible later)
- `defaultValue` (optional)

---

### 3.5 Instance
An instance represents a concrete node or relationship created according to the schema.

Each instance:
- Belongs to exactly one ontology
- References exactly one entity or relation type
- Has a stable unique identifier
- Contains property values conforming to its type definition

---

## 4. Product Scope

The system consists of two clearly separated modes:

### 4.1 Modeling Mode (Schema Builder)

Purpose: Define and manage ontology schemas.

Capabilities:
- Create, update, delete ontology metadata
- Create, update, delete entity types
- Create, update, delete relation types
- Define and edit property definitions
- Validate schema consistency
- Export ontology schema
- Import ontology schema

Modeling mode does not handle instance data.

---

### 4.2 Runtime Mode (Schema-Driven Knowledge Usage)

Purpose: Create and manage instance data based on a defined schema.

Capabilities:
- Retrieve schema for introspection
- Create, read, update, delete entity instances
- Create, read, update, delete relation instances
- Validate instance data against schema
- Provide generic, schema-driven CRUD operations
- Provide basic querying and search capabilities
- Explore local graph neighborhoods

Runtime mode cannot modify the schema.

---

## 5. Separation of Concerns

The system enforces strict separation between:

- **Schema definition (Modeling Mode)**
- **Instance usage (Runtime Mode)**

Each mode:
- Has its own API surface
- Can be deployed independently
- Exposes its own MCP interface
- Operates on a single ontology per request

The active ontology is provided through a request header and is not part of the URL structure.

---

## 6. Export and Import

### 6.1 Export
The system allows exporting an ontology schema to a JSON-based file.

The export includes:
- Format version
- Ontology metadata
- Entity type definitions
- Relation type definitions
- Property definitions

Export enables:
- Backup
- Versioning
- Portability between environments
- Initialization of new installations

---

### 6.2 Import
The system allows importing a JSON schema file.

Import behavior:
- Creates a new ontology or overwrites an existing one (explicit flag required)
- Validates schema consistency before persistence
- Does not attempt migration of existing instance data

---

## 7. Functional Requirements

### 7.1 Modeling Requirements
- Entity type keys must be unique within an ontology.
- Relation type keys must be unique within an ontology.
- Relation endpoints must reference existing entity types.
- Property keys must be unique within their owning type.
- Schema validation endpoint must return structured error messages.
- Schema must be persistable and reloadable.

---

### 7.2 Runtime Requirements
- Instance creation must validate entity type existence.
- Relationship creation must validate:
  - Relation type existence
  - Endpoint compatibility
  - Instance existence
- Instance identifiers must be stable and independent of database internals.
- Generic endpoints must be used (no domain-specific routes).
- All operations must be scoped to a single ontology.

---

### 7.3 MCP Requirements
- Modeling mode exposes tools mirroring its API.
- Runtime mode exposes tools mirroring its API.
- Each MCP instance operates on one ontology defined via header.
- MCP tools must not allow cross-mode access.

---

## 8. Non-Functional Requirements

- The system must be portable.
- Schema and data must be self-contained.
- APIs must return structured error responses.
- The system must be deployable as:
  - Combined modeling + runtime
  - Runtime-only
- The design must allow future addition of authentication and authorization.
- Multi-ontology support must be considered from the beginning.

---

## 9. Milestones

### M1 — Modeling Mode
- Ontology metadata CRUD
- Entity and relation type CRUD
- Property definitions
- Schema validation
- Schema export/import

### M2 — Runtime Mode
- Schema introspection endpoint
- Generic entity instance CRUD
- Generic relation instance CRUD
- Basic search and filtering
- UI for dynamic forms

### M3 — Usability Enhancements
- Graph visualization
- Neighborhood exploration
- Improved search and navigation

---

## 10. Technical Architecture

## 10.1 Repository Structure (Monorepo)

Monorepo with a Python backend and React frontends. The exact package/module split will be defined in the architecture document and may evolve as the project grows.

**High-level layout:**

```
/backend          — Python (uv-managed)
/frontend
  /model-ui       — React app for schema modeling
  /runtime-ui     — React app for instance management
/docs
```

**Open decisions** (to be resolved during architecture phase):
- Whether the runtime API is a separate backend application or a module within the same backend.
- Which shared code (if any) gets extracted into internal packages.
- Frontend app naming (TBD — "studio" rejected).

---

## 10.2 Data Storage

- A graph database is used as the persistence layer.
- Schema and instance data may coexist in the same database.
- Each node and relationship includes an `ontologyId` for isolation.
- Stable UUIDs are used for instance identifiers.
- Internal database IDs are never exposed externally.

---

## 10.3 API Design

Two base paths:

- `/api/model` — Schema modeling
- `/api/use` — Schema-driven runtime

Ontology is provided via header:

```
X-Ontology-Id: <uuid>
```

Runtime API uses generic routes such as:

```
/types/{entityTypeKey}/instances
/relations/{relationTypeKey}
```

No domain-specific endpoints are allowed.

---

## 10.4 Deployment Modes

- Development: All services and UIs run together.
- Production (Full): Modeling + Runtime.
- Production (Runtime Only): Runtime service and UI only.
- MCP servers are bundled with their respective services.

---

## 10.5 Technology Stack

- Backend: Python (managed with uv)
- Frontend: React (managed with npm)
- Database: Neo4j
- Communication: REST (JSON)
- MCP integration: Tool layer mapped 1:1 to REST endpoints

---

## 10.6 Future Extensions

- Authentication and authorization
- Property type system expansion
- Cardinality constraints
- Versioned schema migrations
- Multi-database strategy
- Advanced graph visualization
- Query builder and analytics layer
