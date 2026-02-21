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
