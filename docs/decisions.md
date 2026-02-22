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

### 003 — Two databases, one binary, two run modes
Model DB (multiple ontologies, schema only) and Instance DB (one ontology, copied schema + instance data) are separate Neo4j instances managed via Docker Compose. No dynamic provisioning, no multi-database features, no label-based isolation. One Instance DB per use case is a deployment concern, not a code concern.

The server runs in either `model` or `runtime` mode (`SERVER_MODE` env var), each connecting to exactly one database via unified `DB_URI`/`DB_USER`/`DB_PASSWORD` env vars. Model mode serves `/api/model`, runtime mode serves `/api` (no mode prefix — the server only serves one mode per process, so no ambiguity). In production these are separate deployments. Locally both run simultaneously on different ports.

### 004 — Provisioning via HTTP endpoints
Provisioning uses two HTTP endpoints: the modeling server's export (`GET /api/model/ontologies/{id}/export`) and the runtime server's provision (`POST /api/provision`). The provision endpoint resets the Instance DB and imports the ontology JSON. A convenience script orchestrates the two API calls as a pure HTTP client — no direct database connections, no new low-level code. The provision endpoint is also usable directly via API/MCP.

### 005 — Shared schema models in core/
The Pydantic models for the ontology export format (`ExportPayload`, `ExportOntology`, etc.) live in `core/schemas.py`. Both modules import from `core/`. The runtime module never imports from the modeling module. This keeps the dependency graph clean: `modeling` → `core` ← `runtime`, with no cross-dependency.
