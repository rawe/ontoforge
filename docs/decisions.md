# OntoForge — Decision Log

> Append-only log of settled architectural and project decisions.
> Each entry records what was decided, why, and when.

## How to use this file

- **Append only.** Never edit or remove existing entries. If a decision is reversed, add a new entry that supersedes the old one.
- **Every architectural decision must be approved by the user.** AI sessions must use the AskUserQuestion tool before settling any decision — never decide silently.
- **One entry per decision.** Keep entries concise: what, why, date.
- **Newest entries at the bottom.**

## Guiding Principles

- **KISS** — Keep it simple. Prefer the simplest solution that meets the requirement.
- **YAGNI** — You ain't gonna need it. Don't build for hypothetical future requirements.

---

## Decisions

### 001 — Single backend, modular monolith
**Date:** 2026-02-21
**Decision:** One Python backend application with separate route modules for modeling and runtime. Not two separate services.
**Reason:** Simplicity. Avoids premature distribution overhead. Modules can be separated later if needed.

### 002 — "Studio" rejected as product/component name
**Date:** 2026-02-21
**Decision:** Do not use "studio" for naming frontend apps or the product. Alternative TBD in Phase 0.
**Reason:** User preference.

### 003 — "Use" replaced by "runtime" as route name
**Date:** 2026-02-21
**Decision:** Runtime API route changed from `/api/use` to `/api/runtime`.
**Reason:** "Use" was ambiguous. "Runtime" is consistent with the module and frontend naming.

### 004 — Consistent naming: "modeling" and "runtime" across all layers
**Date:** 2026-02-21
**Decision:** Use "modeling" and "runtime" consistently for backend modules, API routes, frontend apps, and store layers. No synonyms (explorer, studio, use).
**Reason:** Consistency reduces cognitive overhead. One name per concept across the entire project.

### 005 — Store layer split with one-directional dependency
**Date:** 2026-02-21
**Decision:** Separate modeling store and runtime store. Runtime store depends on modeling store (read-only for schema access). Modeling store has no dependency on runtime.
**Reason:** Clean separation of concerns. Runtime needs schema for validation and generic persistence but must never modify it.

### 006 — Backend app named "ontoforge-server"
**Date:** 2026-02-21
**Decision:** The Python backend application is named `ontoforge-server`.
**Reason:** Clear product identity. Distinguishes the server from frontend apps.

### 007 — Supersedes 005: Two separate Neo4j instances, fully decoupled stores
**Date:** 2026-02-21
**Decision:** Model DB (multiple ontologies, schema only) and Instance DB (one ontology, copied schema + instance data) as separate Neo4j instances. Modeling store talks only to Model DB, runtime store talks only to Instance DB. No cross-database references. A deliberate provisioning step copies schema from Model DB to Instance DB.
**Reason:** Full decoupling. Each module is self-contained at the database level. The Instance DB is portable and independent once provisioned.

### 008 — Docker Compose for local infrastructure
**Date:** 2026-02-21
**Decision:** Neo4j instances managed via Docker Compose. The backend never starts containers — it connects to pre-configured instances and can bootstrap their schema (constraints, indexes). Phase 1 only needs `neo4j-model`.
**Reason:** Explicit infrastructure control. The user decides what runs.

### 009 — No dynamic database provisioning; keep two static Neo4j containers
**Date:** 2026-02-22
**Decision:** Stay with the current docker-compose setup: one Model DB, one Instance DB. No multi-database features, no dynamic container provisioning, no label-based isolation. Locally, only one runtime ontology at a time. In production, one Instance DB per use case (a deployment concern, not a code concern).
**Reason:** KISS. The research into multi-database (Enterprise-only), DozerDB, Docker SDK provisioning, and label isolation all add complexity disproportionate to the need. A single static Instance DB is sufficient for development and the immediate product scope.

### 010 — Superseded by 013.

### 013 — Supersedes 010: Provisioning via HTTP endpoints, not direct DB access
**Date:** 2026-02-22
**Decision:** Provisioning uses two HTTP endpoints: the modeling server's existing export endpoint and a new runtime provision endpoint (`POST /api/runtime/provision`). The provision endpoint resets the Instance DB and imports the ontology JSON. A convenience script orchestrates the two API calls — it is purely an HTTP client with no database dependencies. No CLI command with direct DB connections.
**Reason:** Full decoupling. Each server only knows its own database. The provisioning script introduces no new low-level code — it reuses the existing API surface. The provision endpoint is also usable directly via API/MCP, not just through the script.

### 011 — Supersedes 007: One server binary, two run modes (not two simultaneous connections)
**Date:** 2026-02-22
**Decision:** The server runs in either `model` or `runtime` mode (`SERVER_MODE` env var). Each mode connects to exactly one Neo4j database using unified `DB_URI`/`DB_USER`/`DB_PASSWORD` env vars. Model mode mounts `/api/model`, runtime mode mounts `/api/runtime`. No dual-driver code. In production these are separate deployments. Locally both run simultaneously on different ports.
**Reason:** Clean separation of concerns. Each process has one DB connection, one responsibility. Avoids the complexity of managing two simultaneous database connections. Shared code lives in `core/`, not through cross-module imports.

### 012 — Shared schema models in core/, runtime depends only on core/
**Date:** 2026-02-22
**Decision:** The Pydantic models for the ontology export format (ExportPayload, ExportOntology, etc.) move from `modeling/schemas.py` to `core/schemas.py`. The runtime module imports from `core/` to read its embedded ontology. The runtime module never imports from the modeling module.
**Reason:** The runtime needs to read schema data (entity types, relation types, properties) to validate instances and serve schema introspection. This is shared domain knowledge, not modeling-specific logic. Placing it in `core/` keeps the dependency graph clean: both `modeling` and `runtime` depend on `core/`, neither depends on the other.
