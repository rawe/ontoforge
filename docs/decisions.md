# OntoForge — Decision Log

> Settled architectural and project decisions.
> Each entry records what was decided and why.

## How to use this file

- **Every architectural decision must be approved by the user.** AI sessions must use the AskUserQuestion tool before settling any decision — never decide silently.
- **One entry per decision.** Keep entries concise. Merge related decisions rather than chaining supersedence.

## Guiding Principles

- **KISS** — Keep it simple. Prefer the simplest solution that meets the requirement.
- **YAGNI** — You ain't gonna need it. Don't build for hypothetical future requirements.

---

## Decisions

### 001 — Single backend, modular monolith
One Python backend application with separate code modules for `modeling`, `runtime`, and shared `core`. Not two separate services. Modules can be separated later if needed.

### 002 — Consistent naming across all layers
Use "modeling" and "runtime" consistently for backend modules, API routes, frontend apps, and store layers. No synonyms (explorer, studio, use). The backend app is named `ontoforge-server`. "Studio" is rejected as a product or component name.

### 003 — Single database, unified server
One Neo4j instance holds all schema and instance data. The server always serves both modeling (`/api/model`) and runtime (`/api/runtime/{ontologyKey}`) routes from a single process. No mode switching, no separate deployments for different concerns. Schema and instance nodes coexist in the same database, separated by label conventions (`_Entity` marker label, reserved label collision check). This is the simplest architecture that supports multiple ontologies with their instance data.

### 004 — Shared schema models in core/
The Pydantic models for the ontology export format (`ExportPayload`, `ExportOntology`, etc.) live in `core/schemas.py`. Both modules import from `core/`. The runtime module never imports from the modeling module. This keeps the dependency graph clean: `modeling` → `core` ← `runtime`, with no cross-dependency.

### 005 — MCP transport: HTTP/SSE, embedded in existing FastAPI server
MCP endpoints are mounted inside the existing `ontoforge-server` process, not in a separate process. Three deployment shapes were evaluated: (A) embedded in FastAPI, (B) separate process wrapping the REST API, (C) separate process with own DB connection. Shape A was chosen because it avoids extra processes, enables direct service layer calls (no REST-to-REST hop), and reuses existing infrastructure (Neo4j connection, schema cache, error handling). The MCP handlers call `modeling/service.py` and `runtime/service.py` directly — same as the REST routers. HTTP/SSE transport is used because the user's AI framework requires HTTP-based MCP servers.

### 006 — MCP ontology scoping via URL path
The ontology key is embedded in the MCP endpoint URL (`/mcp/model/{ontologyKey}`, `/mcp/runtime/{ontologyKey}`). The LLM never sees multi-ontology complexity — all tools operate on the single ontology bound by the connection URL. The MCP layer resolves the key to the ontology UUID internally. All type references use human-readable keys, never UUIDs. This keeps the tool surface simple and avoids overwhelming the LLM with ontology selection.

### 007 — Two MCP servers, modeling first
Two separate MCP mount points within the same process: one for modeling (`/mcp/model/{key}`) and one for runtime (`/mcp/runtime/{key}`). This mirrors the REST API separation and the PRD requirement for no cross-mode access. Modeling MCP is implemented first (Phase 4a) because it depends only on the completed Phase 1. Runtime MCP is deferred to Phase 4b.
