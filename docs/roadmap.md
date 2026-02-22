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
- [x] Docker Compose with Neo4j Model DB + Instance DB
- [x] Neo4j constraint bootstrap on startup
- [x] Integration testing against real Neo4j (40/40 curl tests passing)
- [x] 4 bugs found and fixed with regression tests

**Depends on:** Phase 0

**Status:** COMPLETE — 26 API endpoints implemented, 32 unit tests passing, integration tested.

---

### Phase 2 — Backend: Runtime API (REST)
Add the runtime module to the existing backend. The server runs in `runtime` mode against the Instance DB, serving schema-driven instance CRUD.

**Scope:**
- [x] Server mode infrastructure (`SERVER_MODE` env var, mode-based route mounting, unified `DB_*` config)
- [x] Move shared Pydantic models (export format) from `modeling/schemas.py` to `core/schemas.py`
- [x] Runtime provision endpoint (`POST /api/provision` — resets Instance DB, imports ontology JSON)
- [x] Provisioning script (`ontoforge-provision` CLI, HTTP client calling export + provision endpoints)
- [x] Schema introspection endpoints (5 endpoints, read-only from in-memory SchemaCache)
- [x] Generic entity instance CRUD (5 endpoints with filtering, search, pagination)
- [x] Generic relation instance CRUD (5 endpoints with source/target validation)
- [x] Instance validation against schema (type coercion, required/unknown checks, collect-all-errors)
- [x] Basic search and filtering (`filter.{key}`, `filter.{key}__{op}`, `q` text search)
- [x] Neighborhood exploration (`GET .../neighbors` with direction and type filtering)
- [x] Unit tests (56 runtime tests, all passing, mocked repository layer)
- [x] Test fixture (person/company/works_for ontology JSON)
- [x] ValidationError enhanced with field-level details
- [x] JSON parse error handler for consistent error format
- [x] SchemaCache loaded from DB on server restart
- [ ] Integration testing against real Neo4j
- [ ] Documentation for runtime usage and provisioning workflow

**Depends on:** Phase 1

**Status:** IN PROGRESS — 17 endpoints implemented, 56 unit tests passing, code reviewed. Remaining: integration testing and documentation.

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

**Next steps:** Integration testing against real Neo4j (start Docker, provision test fixture, run curl tests). Then write concise runtime usage docs.

**What's ready to use:**
- Backend modeling API: 26 endpoints, 32 unit tests, integration tested (40/40)
- Backend runtime API: 17 endpoints, 56 unit tests, code reviewed (88 total tests passing)
- Provisioning script: `uv run ontoforge-provision --ontology <id>`
- Test fixture: `backend/tests/fixtures/test_ontology.json` (person/company/works_for)
- Frontend modeling UI: first draft, integration tested (15/15)
- Docker Compose: Neo4j Model DB + Instance DB configured
- Server mode infrastructure: `SERVER_MODE` env var, mode-based route mounting, unified config
- Shared Pydantic models in `core/schemas.py` (moved from modeling)
- Architecture docs: complete for runtime scope
- Runtime API contract: `docs/api-contracts/runtime-api.md` (17 endpoints fully specified)
- Testing strategy: `docs/testing-strategy.md` for multi-agent test cycles
