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
