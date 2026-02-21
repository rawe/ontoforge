# OntoForge — Development Roadmap

> Single source of truth for phasing, status, and session continuity. Supersedes any milestone definitions in the PRD.
> Every AI session MUST read this file first and update status after completing work.

## Phases

### Phase 0 — Architecture & Design
Define component boundaries, data flow, Neo4j schema conventions, and API contracts before writing any implementation code.

**Deliverables:**
- [ ] `docs/architecture.md` — Component diagram, boundaries, data flow, Neo4j storage model
- [ ] `docs/api-contracts/modeling-api.md` — Modeling REST endpoints, DTOs, error model (full contract)
- [ ] `docs/api-contracts/runtime-api.md` — Lightweight sketch: route structure, boundary to modeling module, explicit TODOs for what must be detailed before Phase 2
- [ ] Establish naming conventions for all components (frontend app names TBD — "studio" rejected; runtime route naming TBD — "use" under review)
- [ ] Project scaffolding (directory structure, pyproject.toml, initial deps)

**Status:** NOT STARTED

---

### Phase 1 — Backend: Modeling API (REST)
Implement the schema modeling service. This is the first functional milestone.

**Scope:**
- Ontology metadata CRUD
- Entity type CRUD
- Relation type CRUD
- Property definitions CRUD
- Schema validation endpoint
- Schema export / import (JSON)
- Neo4j persistence for all schema objects

**Depends on:** Phase 0

**Status:** NOT STARTED

---

### Phase 2 — Backend: Runtime API (REST)
Add the runtime module to the existing backend. Implements schema-driven instance CRUD as a separate route module within the modular monolith.

**Scope:**
- Schema introspection endpoint (read-only)
- Generic entity instance CRUD
- Generic relation instance CRUD
- Instance validation against schema
- Basic search and filtering
- Neighborhood exploration

**Depends on:** Phase 1

**Status:** NOT STARTED

---

### Phase 3 — Frontend UI
Build the React-based frontend applications.

**Scope:** TBD — will be scoped after backend phases complete.

**Depends on:** Phase 1 (modeling UI) / Phase 2 (runtime UI)

**Status:** DEFERRED

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

**Active phase:** Phase 0 — Architecture & Design
