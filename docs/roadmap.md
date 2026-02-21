# OntoForge — Development Roadmap

> Single source of truth for phasing, status, and session continuity.
> Every AI session MUST read this file first and update status after completing work.

## Phases

### Phase 0 — Architecture & Design
Define component boundaries, data flow, Neo4j schema conventions, and API contracts before writing any implementation code.

**Deliverables:**
- [ ] `docs/architecture.md` — Component diagram, boundaries, data flow, Neo4j storage model
- [ ] `docs/api-contracts/modeling-api.md` — Modeling REST endpoints, DTOs, error model
- [ ] `docs/api-contracts/runtime-api.md` — Runtime REST endpoints, DTOs, error model
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
Implement the schema-driven instance CRUD service.

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
Build the React-based studio interfaces.

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

## Session Protocol

1. **Start of session:** Read this file and `docs/architecture.md` (once it exists) to re-establish context.
2. **During session:** Work only on the current active phase.
3. **End of session:** Update the status and checkboxes above to reflect completed work.

## Current Focus

**Active phase:** Phase 0 — Architecture & Design
