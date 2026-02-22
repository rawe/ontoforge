# OntoForge — Development Roadmap

> Single source of truth for phasing, status, and session continuity. Supersedes any milestone definitions in the PRD.
> Every AI session MUST read this file first and update status after completing work.

## Phases

### Phase 0 — Architecture & Design
Define component boundaries, data flow, Neo4j schema conventions, and API contracts before writing any implementation code.

**Deliverables:**
- [x] `docs/architecture.md` — Component diagram, boundaries, data flow, Neo4j storage model
- [x] `docs/api-contracts/modeling-api.md` — Modeling REST endpoints, DTOs, error model (full contract)
- [ ] `docs/api-contracts/runtime-api.md` — Lightweight sketch: route structure, boundary to modeling module, explicit TODOs for what must be detailed before Phase 2
- [x] Establish naming conventions for all components — settled in `docs/architecture.md` §2
- [x] Project scaffolding (directory structure, pyproject.toml, initial deps)

**Status:** COMPLETE (modeling scope). Runtime API sketch deferred to Phase 2 prep.

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
- [ ] Runtime provision endpoint (`POST /api/provision` — resets Instance DB, imports ontology JSON)
- [ ] Provisioning script (HTTP client calling export + provision endpoints)
- [ ] Schema introspection endpoints (read-only, reads embedded ontology)
- [ ] Generic entity instance CRUD
- [ ] Generic relation instance CRUD
- [ ] Instance validation against schema
- [ ] Basic search and filtering
- [ ] Neighborhood exploration

**Depends on:** Phase 1

**Status:** IN PROGRESS — server mode infrastructure and shared models complete. Runtime design settled (decision 015).

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
- `docs/decisions.md` — Settled decisions with rationale (append-only)
- `docs/architecture.md` — Component boundaries, data flow, storage model (Phase 0 deliverable)
- `docs/api-contracts/` — API endpoint contracts (Phase 0 deliverable)

## Session Protocol

1. **Start of session:** Read this file and `docs/architecture.md` (once it exists) to re-establish context.
2. **During session:** Work only on the current active phase.
3. **End of session:** Update the status and checkboxes above to reflect completed work.

## Current Focus

**Active phase:** Phase 2 — Backend: Runtime API

**Next steps:** Implement runtime provision endpoint, then schema introspection, then entity/relation CRUD.

**What's ready to use:**
- Backend modeling API: 26 endpoints, 32 unit tests, integration tested (40/40)
- Frontend modeling UI: first draft, integration tested (15/15)
- Docker Compose: Neo4j Model DB + Instance DB configured
- Server mode infrastructure: `SERVER_MODE` env var, mode-based route mounting, unified config (refactored and tested)
- Shared Pydantic models in `core/schemas.py` (moved from modeling)
- Architecture docs: complete for runtime scope (instance representation, API design, provisioning workflow)
- Runtime API contract: `docs/api-contracts/runtime-api.md` (17 endpoints fully specified)
- Testing strategy: `docs/testing-strategy.md` for multi-agent test cycles
