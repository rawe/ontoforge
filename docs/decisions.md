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
Use "modeling" and "runtime" consistently for backend modules, API routes, and store layers — no synonyms. The backend app is named `ontoforge-server`. This governs code and API surface only: the frontend names its schema-design surface *Studio* and its canvas *Explorer* (see `docs/runtime-ui-architecture.md`).

### 003 — Single database, unified server
One database instance holds all schema and instance data. The server always serves both modeling (`/api/model`) and runtime (`/api/runtime/{ontologyKey}`) routes from a single process. No mode switching, no separate deployments for different concerns. Schema and instance data coexist in the same database; how they are kept apart is the adapter's business (see decision 008, and 011 for the type keys an adapter may reserve). This is the simplest architecture that supports multiple ontologies with their instance data.

### 004 — Shared schema models in core/
The Pydantic models for the ontology export format (`ExportPayload`, `ExportOntology`, etc.) live in `core/schemas.py`. Both modules import from `core/`. The runtime module never imports from the modeling module. This keeps the dependency graph clean: `modeling` → `core` ← `runtime`, with no cross-dependency.

### 005 — MCP transport: streamable HTTP, embedded in existing FastAPI server
MCP endpoints are mounted inside the existing `ontoforge-server` process, not in a separate process. Three deployment shapes were evaluated: (A) embedded in FastAPI, (B) separate process wrapping the REST API, (C) separate process with own DB connection. Shape A was chosen because it avoids extra processes, enables direct service layer calls (no REST-to-REST hop), and reuses existing infrastructure (Neo4j connection, schema cache, error handling). The MCP handlers call `modeling/service.py` and `runtime/service.py` directly — same as the REST routers. Transport is streamable HTTP, stateless, with plain JSON responses rather than an SSE stream, because the user's AI framework requires HTTP-based MCP servers.

### 006 — MCP ontology scoping: hybrid resolution
The ontology key can be provided via three mechanisms (in priority order): URL path (`/mcp/model/{ontologyKey}`), `X-Ontology-Key` HTTP header, or `DEFAULT_MCP_ONTOLOGY_KEY` environment variable. URL path remains the primary and highest-priority mechanism, preserving backward compatibility. The header fallback supports orchestration frameworks that pass configuration via HTTP headers. The env var fallback supports single-ontology deployments where every MCP connection uses the same ontology. If no key is found from any source, the server returns 400. The LLM never sees multi-ontology complexity — all tools operate on the single ontology resolved at connection time. The MCP layer resolves the key to the ontology UUID internally. All type references use human-readable keys, never UUIDs.

### 007 — Two MCP servers, modeling and runtime
Two separate MCP mount points within the same process: one for modeling (`/mcp/model/{key}`) and one for runtime (`/mcp/runtime/{key}`). This mirrors the REST API separation and the PRD requirement for no cross-mode access.

### 008 — Persistence port with exchangeable database adapters
The backend accesses the database only through a persistence port (`core/ports.py`): a `ModelingStore` and a `RuntimeStore` selected via `DB_BACKEND`. Everything database-specific — driver, connections, query text, physical naming (labels, PascalCase/UPPER_SNAKE_CASE), index DDL, driver temporal types — lives in an adapter package (`adapters/neo4j/`). Services, routers, and MCP handlers speak ontology vocabulary (type keys, property keys, instance UUIDs, structured filters) and never see driver types or query fragments. Neo4j is the reference adapter and default deployment; no second adapter is built until needed (YAGNI) — a PostgreSQL mapping is documented in `feature-ideas/database-independence.md`. Approved 2026-07-19.

### 009 — OQL: OntoForge's own query language, anchored to ISO GQL
The user-facing query feature (query endpoint, saved queries, AI query generation) uses OQL — the read-only openCypher-shaped subset OntoForge already validated, now specified as OntoForge's own language over ontology type keys. Its normative reference is the ISO GQL standard (ISO/IEC 39075:2024) and its GPML pattern sublanguage (shared with SQL/PGQ, ISO/IEC 9075-16), not Neo4j Cypher; where validator behavior diverges from the standard, the spec follows ISO. Parsing/validation is database-independent; compilation to the native dialect is adapter-private. The language surface — supported clauses, blocked operations, reserved names, error codes — is specified in `api-contracts/runtime-api.md` §7; no separate spec document is maintained. Approved 2026-07-19 (ISO anchoring settled explicitly by the user).

### 010 — Contract de-leak: `query`/`oql` naming, export format 3.0
No Neo4j/Cypher vocabulary in the public surface. The query endpoint takes `query`; saved-query steps use type `oql` with field `oql` — renaming that step field to `query` was rejected, because `query` already carries the search text of a `semantic_search` step; the AI query response returns `query`; the MCP tool is `execute_query`; error messages name no vendor. Export format is 3.0. No aliases for the previous `cypher` spelling are kept on any surface: they were removed before the first release carrying this contract, since nothing outside the project consumed it. "Neo4j-native" is retired from product positioning in favor of graph-native with exchangeable storage. Approved 2026-07-19; alias removal approved 2026-07-27.

### 011 — Reserved type keys are declared by the adapter, enforced by the service
Type keys whose physical form would collide with a storage adapter's own schema objects are reserved. The adapter derives its reserved sets from its physical naming and exposes them through the persistence port as plain type keys (`reserved_entity_type_keys()` / `reserved_relation_type_keys()` on the modeling store); the modeling service rejects a colliding key on every write path with a `VALIDATION_ERROR` that names neither the vendor nor the physical name. Two alternatives were rejected: a constant in `core/` (would encode Neo4j-derived names in database-agnostic code, breaking decision 008), and rejection inside the store at write time (would deliver the error from persistence rather than the service validation pipeline, and each future adapter would reimplement it). Types created before the check existed are not migrated — renaming a type key is destructive and is the operator's decision — but the server names each one in a startup warning. Approved 2026-07-25.

### 012 — Unexpected storage failures become `StoreError`, correlated by error id
Port contract rule 4 (driver exceptions never cross the persistence port) is implemented rather than reworded: the adapter opens every database session through a single translating helper, so any driver failure surfaces as `StoreError` and is answered with a structured `500 STORAGE_ERROR` body instead of a bare `Internal Server Error`. `StoreError` carries no storage detail — the driver's message names the vendor and physical objects, which decision 010 keeps out of the public surface — so the adapter logs the original against a generated `errorId` and returns only that id in `details`. Without it a reported 500 could not be traced to its server-side stack, which is the practical difference between a structured error and a generic one. A condition taxonomy (retryable `503` for connection loss, `409` for database-raised constraint violations) was rejected as speculative: those conditions are not currently observed, and duplicate keys are already pre-checked before reaching the database — a second adapter, or a real incident, is the trigger to revisit. Expected conditions keep their existing paths and are unaffected. Approved 2026-07-25.

### 013 — Semantic-index width drift is reported at startup, repaired on rebuild
A vector index fixes its width when it is created, and the `IF NOT EXISTS` DDL that ensures indexes on startup is a no-op against one that already exists. Changing the embedding model therefore left indexes that reject every vector the new model produces, with no symptom until the first semantic search failed. Startup now reads each existing index's width, compares it against the configured provider, and warns per mismatch — naming the entity type, document property, or search scope, both widths, and the remedy. It does not repair: dropping an index destroys the vectors it holds, and doing that unasked would trade a loud failure for an empty index and a silently wrong answer. `POST /api/model/rebuild-embeddings` does repair, because there the drop is immediately followed by regeneration at the new width — the operator asked for exactly that, and its documentation already named a changed embedding model as a reason to run it. The alternatives were rejected as either destructive without consent (repair at startup) or leaving the actual defect — the invisibility — in place (document the manual recovery only). No opt-in setting was added: the two paths that exist already express the distinction. The warning is emitted inside the adapter rather than crossing the port, because index width is not a domain concept and the port would gain a return type for one log line; the no-vendor, no-physical-naming rule of decision 010 is met by phrasing the messages in API vocabulary. Approved 2026-07-26.
