# OntoForge — Development Roadmap

> Single source of truth for phasing, status, and session continuity. Supersedes any milestone definitions in the PRD.
> Every AI session MUST read this file first and update status after completing work.

## Phases

### Phase 0 — Architecture & Design
Define component boundaries, data flow, Neo4j schema conventions, and API contracts before writing any implementation code.

**Deliverables:**
- [x] `docs/architecture.md` — Component diagram, boundaries, data flow, Neo4j storage model
- [x] `docs/api-contracts/modeling-api.md` — Modeling REST endpoints, DTOs, error model (full contract)
- [x] `docs/api-contracts/runtime-api.md` — Runtime REST endpoints, DTOs, filter syntax, error model (full contract)
- [x] Establish naming conventions for all components — settled in `docs/architecture.md` §2
- [x] Project scaffolding (directory structure, pyproject.toml, initial deps)

**Status:** COMPLETE

---

### Phase 1 — Backend: Modeling API (REST)
Implement the schema modeling service. This is the first functional milestone.

**Scope:**
- [x] Ontology metadata CRUD
- [x] Entity type CRUD
- [x] Relation type CRUD
- [x] Property definitions CRUD
- [x] Schema validation endpoint
- [x] Schema export / import (JSON)
- [x] Neo4j persistence for all schema objects
- [x] Unit tests (32 tests, all passing, mocked repository layer)
- [x] Docker Compose with Neo4j
- [x] Neo4j constraint bootstrap on startup
- [x] Integration testing against real Neo4j (40/40 curl tests passing)
- [x] 4 bugs found and fixed with regression tests

**Depends on:** Phase 0

**Status:** COMPLETE — 26 API endpoints implemented, 32 unit tests passing, integration tested.

---

### Phase 2 — Backend: Runtime API (REST)
Add the runtime module to the existing backend. All routes are scoped by ontology key (`/api/runtime/{ontologyKey}/...`), reading schema data from the same database as the modeling module.

**Scope:**
- [x] Move shared Pydantic models (export format) from `modeling/schemas.py` to `core/schemas.py`
- [x] Ontology key field (snake_case, unique, immutable) on ontology model
- [x] Schema introspection endpoints (5 endpoints, read-only from in-memory SchemaCache)
- [x] Generic entity instance CRUD (5 endpoints with filtering, search, pagination)
- [x] Generic relation instance CRUD (5 endpoints with source/target validation)
- [x] Instance validation against schema (type coercion, required/unknown checks, collect-all-errors)
- [x] Basic search and filtering (`filter.{key}`, `filter.{key}__{op}`, `q` text search)
- [x] Neighborhood exploration (`GET .../neighbors` with direction and type filtering)
- [x] Instance data wipe endpoint (`DELETE /api/runtime/{ontologyKey}/data`)
- [x] SchemaCache loaded from DB on server startup (keyed by ontology key)
- [x] Unit tests (92 tests, all passing — 36 modeling + 56 runtime)
- [x] Test fixture (person/company/works_for ontology JSON)
- [x] ValidationError enhanced with field-level details
- [x] JSON parse error handler for consistent error format
- [x] Ontology-scoped runtime routes (`/api/runtime/{ontologyKey}/...`)
- [x] Single-DB unified architecture (no dual-mode, no provisioning)
- [ ] Integration testing against real Neo4j
- [x] Documentation for runtime usage (`docs/runtime-usage.md`)

**Depends on:** Phase 1

**Status:** IN PROGRESS — 17 runtime endpoints implemented, 92 unit tests passing, 7/7 integration tests passing. Remaining: formal integration test suite, runtime usage documentation.

---

### Phase 3 — Frontend UI
Build the React-based frontend applications.

**Modeling UI scope (first draft complete):**
- [x] Ontology list and creation
- [x] Ontology detail with entity types and relation types
- [x] Entity type editor with property management
- [x] Relation type editor with source/target selection and property management
- [x] Schema validation results display
- [x] Schema export (JSON download)
- [x] Ontology key field in creation form and display
- [x] Frontend integration testing (7/7 Chrome tests passing)
- [x] Schema import UI (file picker, conflict detection with structured error codes)
- [x] Property edit UI (inline editing in PropertyTable for both entity and relation types)
- [x] API client typed errors (ApiError class with status code and error code)
- [ ] Import dialog with overwrite option (nice-to-have, current import shows conflict message)

**Runtime UI scope (first draft complete):**
- [x] Runtime API client (`api/runtimeClient.ts`) covering all 17 endpoints
- [x] Shared request helper extracted (`api/request.ts`) with enhanced `ApiError` (includes `details`)
- [x] Runtime TypeScript types (`types/runtime.ts`)
- [x] Schema context provider with fetch-on-mount caching (`context/RuntimeSchemaContext.tsx`)
- [x] RuntimeDashboardPage — entry point per ontology, lists entity/relation types, data wipe
- [x] EntityInstanceListPage — generic entity CRUD with search, sort, pagination, modal create/edit
- [x] RelationInstanceListPage — generic relation CRUD with entity pickers for from/to, entity label resolution
- [x] DynamicForm — schema-driven form (string/integer/float/boolean/date/datetime inputs), edit-mode diffing
- [x] DataTable — sortable columns, action buttons, type-aware cell rendering
- [x] EntityPicker — debounced search select for entity instances
- [x] Pagination and Modal shared components
- [x] Navigation: "Manage Data" button on OntologyDetailPage, "Data" link on OntologyCard
- [x] Architecture document: `docs/runtime-ui-architecture.md`
- [ ] End-to-end testing against running backend

**Depends on:** Phase 1 (modeling UI) / Phase 2 (runtime UI)

**Status:** IN PROGRESS — modeling UI and runtime UI both feature-complete. Import dialog with overwrite toggle deferred. Runtime end-to-end testing pending.

---

### Phase 4 — MCP Integration
REST-to-MCP adapter layer for AI-driven interactions.

**Scope:** TBD — explicitly deferred.

**Depends on:** Phase 1 + Phase 2

**Status:** DEFERRED

---

## References

- `docs/prd.md` — Product requirements (what and why)
- `docs/decisions.md` — Settled decisions with rationale
- `docs/architecture.md` — Component boundaries, data flow, storage model (Phase 0 deliverable)
- `docs/api-contracts/` — API endpoint contracts (Phase 0 deliverable)

## Session Protocol

1. **Start of session:** Read this file and `docs/architecture.md` (once it exists) to re-establish context.
2. **During session:** Work only on the current active phase.
3. **End of session:** Update the status and checkboxes above to reflect completed work.

## Current Focus

**Active phase:** Phase 3 — Frontend UI (runtime UI)

**Next steps:** End-to-end testing of runtime UI against running backend. Phase 2 formal integration test suite and runtime documentation still pending.

**What's ready to use:**
- Unified server: single Neo4j, both routers always mounted, no mode switching
- Backend modeling API: 26 endpoints, ontology key field, integration tested
- Backend runtime API: 17 endpoints under `/api/runtime/{ontologyKey}/...`, 92 unit tests passing
- Frontend modeling UI: ontology key in creation form and display, 7/7 integration tested
- Frontend runtime UI: generic data management (entity/relation CRUD, search, sort, pagination), architecture doc at `docs/runtime-ui-architecture.md`
- Docker Compose: single Neo4j service
- Test fixture: `backend/tests/fixtures/test_ontology.json` (person/company/works_for)
- Architecture docs: complete for unified architecture
- API contracts: modeling (26 endpoints) + runtime (17 endpoints) fully specified
- Testing strategy: `docs/testing-strategy.md` for multi-agent test cycles
