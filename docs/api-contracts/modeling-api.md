# Modeling API Contract

> Full contract for the schema modeling REST API.
> Base path: `/api/model` (subject to naming review, see `docs/architecture.md` §1)

## 1. Ontology Endpoints

<!-- TODO: CRUD endpoints for ontology metadata -->
<!-- - Create ontology -->
<!-- - Get ontology -->
<!-- - Update ontology -->
<!-- - Delete ontology -->
<!-- - List ontologies -->

## 2. Entity Type Endpoints

<!-- TODO: CRUD endpoints for entity types within an ontology -->
<!-- - Create entity type -->
<!-- - Get entity type -->
<!-- - Update entity type -->
<!-- - Delete entity type -->
<!-- - List entity types -->

## 3. Relation Type Endpoints

<!-- TODO: CRUD endpoints for relation types within an ontology -->
<!-- - Create relation type -->
<!-- - Get relation type -->
<!-- - Update relation type -->
<!-- - Delete relation type -->
<!-- - List relation types -->

## 4. Property Definition Endpoints

<!-- TODO: CRUD for property definitions on entity and relation types -->
<!-- - Add property to type -->
<!-- - Update property -->
<!-- - Remove property -->
<!-- - Decide: nested under type endpoints or standalone? -->

## 5. Schema Validation

<!-- TODO: Endpoint to validate the current schema for consistency -->
<!-- - Request/response shape -->
<!-- - Structured error messages -->

## 6. Export / Import

<!-- TODO: Endpoints for JSON-based schema export and import -->
<!-- - Export: response format, versioning -->
<!-- - Import: overwrite flag, validation before persistence -->

## 7. Common DTOs

<!-- TODO: Define shared request/response shapes -->
<!-- - Ontology DTO -->
<!-- - Entity type DTO -->
<!-- - Relation type DTO -->
<!-- - Property definition DTO -->

## 8. Error Model

<!-- TODO: Define structured error response format -->
<!-- - Error shape (code, message, details) -->
<!-- - Validation error shape -->
<!-- - Standard HTTP status code usage -->
