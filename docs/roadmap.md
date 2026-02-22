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
- [ ] Ontology key field (snake_case, unique, immutable) on ontology model
- [x] Schema introspection endpoints (5 endpoints, read-only from in-memory SchemaCache)
- [x] Generic entity instance CRUD (5 endpoints with filtering, search, pagination)
- [x] Generic relation instance CRUD (5 endpoints with source/target validation)
- [x] Instance validation against schema (type coercion, required/unknown checks, collect-all-errors)
- [x] Basic search and filtering (`filter.{key}`, `filter.{key}__{op}`, `q` text search)
- [x] Neighborhood exploration (`GET .../neighbors` with direction and type filtering)
- [ ] Instance data wipe endpoint (`DELETE /api/runtime/{ontologyKey}/data`)
- [x] SchemaCache loaded from DB on server startup
- [x] Unit tests (56 runtime tests, all passing, mocked repository layer)
- [x] Test fixture (person/company/works_for ontology JSON)
- [x] ValidationError enhanced with field-level details
- [x] JSON parse error handler for consistent error format
- [ ] Ontology-scoped runtime routes (`/api/runtime/{ontologyKey}/...`)
- [ ] Integration testing against real Neo4j
- [ ] Documentation for runtime usage

**Depends on:** Phase 1

**Status:** IN PROGRESS — Core runtime logic implemented (16 endpoints, 56 unit tests). Remaining: ontology key support, ontology-scoped route prefix, instance data wipe endpoint, integration testing, documentation.

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
- [x] Frontend integration testing (15/15 Chrome tests passing)
- [ ] Schema import UI (API client ready, no UI yet)
- [ ] Property edit UI (currently create/delete only)

**Runtime UI scope:** TBD — deferred until Phase 2 backend complete.

**Depends on:** Phase 1 (modeling UI) / Phase 2 (runtime UI)

**Status:** IN PROGRESS — modeling UI first draft complete, builds and integration tested. Runtime UI deferred.

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

**Active phase:** Phase 2 — Backend: Runtime API

**Next steps:** Add ontology key to the modeling module, refactor runtime routes to use ontology-scoped prefix (`/api/runtime/{ontologyKey}/...`), replace provision endpoint with data wipe endpoint. Then integration testing against real Neo4j.

**What's ready to use:**
- Backend modeling API: 26 endpoints, 32 unit tests, integration tested (40/40)
- Backend runtime API: 16 endpoints, 56 unit tests, code reviewed (88 total tests passing)
- Test fixture: `backend/tests/fixtures/test_ontology.json` (person/company/works_for)
- Frontend modeling UI: first draft, integration tested (15/15)
- Docker Compose: Neo4j configured
- Shared Pydantic models in `core/schemas.py`
- Architecture docs: complete for current scope
- Runtime API contract: `docs/api-contracts/runtime-api.md` (16 endpoints fully specified)
- Testing strategy: `docs/testing-strategy.md` for multi-agent test cycles
