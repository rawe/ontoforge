# PRD — OntoForge

## 1. Overview

OntoForge is a development tool for designing graph-based ontologies and enforcing them through schema-driven APIs. It serves as a companion tool when building applications that depend on structured domain knowledge — you design your ontology, test it with real data, and then integrate the runtime API into your application's backend as the schema-enforced persistence layer.

The system separates **schema modeling** (defining entity types, relation types, and their properties) from **runtime usage** (creating and querying instance data). Both schema and data live in a single Neo4j database for simplicity and portability. The runtime API validates every write against the ontology, ensuring that no data enters the graph without conforming to the schema.

OntoForge supports export and import of ontologies in a JSON-based format and manages multiple ontologies within a single installation.

---

## 2. Vision

Applications that work with domain knowledge need a way to define and enforce the structure of that knowledge. Without schema enforcement, knowledge graphs drift into inconsistency — especially when multiple systems or AI agents write to them.

OntoForge addresses this by providing:

- **A modeling layer** where you define an ontology once — entity types, relation types, property constraints — through a UI or API.
- **A runtime layer** that gives you a generic, schema-driven API for all CRUD operations, with validation on every write. No domain-specific endpoints needed.
- **MCP integration** (planned) that gives AI coding assistants controlled access: one MCP server for modeling the ontology, one for structured read/write operations against it. Write access is always schema-enforced; read access can be broader.

The intended workflow: design your ontology → test it with instance data → wire the runtime API into your app → optionally connect AI tools via MCP for schema-aware knowledge graph interaction.

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
- Has its own API surface (separate route prefix)
- Exposes its own MCP interface (planned)
- Operates on a single ontology per request

Both modes are served by a single server process. The modeling API addresses ontologies by UUID in the URL path. The runtime API addresses ontologies by their unique key in the URL path.

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

## 9. Technical Architecture

## 9.1 Repository Structure (Monorepo)

Monorepo with a single Python backend (modular monolith) and a React frontend. The backend exposes both modeling and runtime capabilities as separate route modules within one application.

**High-level layout:**

```
/backend          — Python (uv-managed), modular monolith
/frontend         — React app (modeling UI complete, runtime UI planned)
/docs
```

**Naming:** "modeling" and "runtime" used consistently across all layers. See `docs/architecture.md` §2 for the full naming table.

---

## 9.2 Data Storage

- Neo4j is used as the persistence layer.
- A single Neo4j database holds both schema and instance data, separated by label conventions. See `docs/architecture.md` §4 for details.
- Multiple ontologies coexist in the same database, isolated through graph structure.
- Stable UUIDs are used for instance identifiers.
- Internal database IDs are never exposed externally.

---

## 9.3 API Design

Two base paths:

- `/api/model` — Schema modeling
- `/api/runtime` — Schema-driven runtime

The modeling API nests resources under `/api/model/ontologies/{ontologyId}/...`. The runtime API scopes all routes under `/api/runtime/{ontologyKey}/...` using the ontology's unique key.

Runtime API uses generic routes such as:

```
/entities/{entityTypeKey}
/relations/{relationTypeKey}
```

No domain-specific endpoints are allowed.

---

## 9.4 Deployment

- A single server process serves both modeling and runtime routes.
- MCP servers (planned) will be separate processes wrapping the REST API.

---

## 9.5 Technology Stack

- Backend: Python (managed with uv)
- Frontend: React (managed with npm)
- Database: Neo4j
- Communication: REST (JSON)
- MCP integration: Tool layer mapped 1:1 to REST endpoints

---

## 9.6 Future Extensions

- Authentication and authorization
- Property type system expansion
- Cardinality constraints
- Versioned schema migrations
- Multi-database strategy
- Advanced graph visualization
- Query builder and analytics layer
