# Runtime API Contract (Sketch)

> Lightweight sketch. Full contract to be detailed before Phase 2.
> Base path: TBD (currently `/api/use`, under review — see `docs/architecture.md` §1)

## 1. Route Structure

<!-- TODO: Define the generic route layout -->
<!-- - Entity instance routes: /types/{entityTypeKey}/instances -->
<!-- - Relation instance routes: /relations/{relationTypeKey} -->
<!-- - Schema introspection route (read-only) -->

## 2. Boundary to Modeling Module

<!-- TODO: Define what the runtime module can and cannot access -->
<!-- - Runtime reads schema but never writes it -->
<!-- - Shared infrastructure vs modeling-only logic -->

## 3. Open TODOs for Phase 2

<!-- The following must be fully specified before implementation begins: -->
<!-- - [ ] Entity instance CRUD: full endpoint spec, DTOs, validation rules -->
<!-- - [ ] Relation instance CRUD: full endpoint spec, DTOs, endpoint compatibility checks -->
<!-- - [ ] Search and filtering: query parameters, pagination -->
<!-- - [ ] Neighborhood exploration: traversal depth, response shape -->
<!-- - [ ] Error model: reuse from modeling or extend? -->
<!-- - [ ] Route naming decision (replace "use") -->
