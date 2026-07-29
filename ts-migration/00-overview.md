# TypeScript Backend Migration — Overview

Port the Python backend (`backend/`) to TypeScript in a new top-level `server/` directory.
The REST API must be **drop-in identical** for the existing frontend, and both MCP servers
must expose the **same tools with the same behavior**. The Python backend stays untouched
and runnable until the port is complete.

**`docs/` is the normative specification.** It was written to hold for a reimplementation
in any language — this migration is that reimplementation. The session specs in this
folder do NOT restate semantics; they scope each session, point to the binding documents
and the Python reference code, and call out the traps. If a spec and `docs/` ever
disagree, `docs/` wins. If `docs/` and the Python implementation disagree, **stop and ask
the user** (per `CLAUDE.md` consistency rule) — one known case is already decided, see
"Approved divergences" below.

## Approved stack (user-approved 2026-07-28, do not re-litigate)

| Concern | Choice |
|---|---|
| Runtime / package manager | Node.js ≥ 22 LTS, npm |
| Language | TypeScript, strict mode, ESM |
| HTTP framework | **Fastify** (v5) |
| Validation / OpenAPI | Zod + `fastify-type-provider-zod`, `@fastify/swagger` (+ swagger-ui) serving `/openapi.json` and `/docs` |
| Database driver | `neo4j-driver` (official) |
| MCP | `@modelcontextprotocol/sdk` — Streamable HTTP transport, **stateless**, **JSON responses** (no SSE), per `docs/decisions.md` |
| OQL parsing | **ANTLR via `antlr4ng`**, parser generated at build time from a Cypher/openCypher `.g4` grammar (see session 07) |
| LLM layer | **LangChain.js / LangGraph.js** (`@langchain/openai`, `@langchain/langgraph`) — user preference (see session 11) |
| Tests | Vitest; integration tests tagged and excluded by default (mirror pytest's `-m 'not integration'`) |
| Dev runner | `tsx` |

## Approved divergences from the Python implementation

Everything else is strict behavioral parity — including documented warts (the neighbors
direction budget, the per-process schema cache, the `__` filter suffix rule, MCP clamping
limits where REST rejects them, …). These are **behavior, not bugs**; preserve them.
Exactly five divergences are approved:

1. **Import validates key patterns** (session 10). The Python import path skips the
   `^[a-z][a-z0-9_]*$` check, letting a hand-edited payload define a property named `_id`
   that overwrites entity identity. `docs/architecture.md` itself says a reimplementation
   should fix this. The TS import rejects any type/property/ontology key that the
   interactive path would reject.
2. **AI routes report `details.code: FEATURE_DISABLED`** (session 11) when no LLM
   provider is configured, matching what semantic search already does. Top-level code
   stays `VALIDATION_ERROR` / 422.
3. **Request-shape errors use the error envelope** (session 01). FastAPI's own request
   validation answers `422 {"detail": [...]}` — outside the documented envelope. `docs/`
   states the envelope applies everywhere, so the TS server maps framework-level
   validation failures to `422 VALIDATION_ERROR` in the standard envelope. (Docs-over-
   implementation; the frontend sends well-formed requests, so this is unreachable for it.
   MCP is unaffected — it reports failures as protocol-level tool errors, never this
   envelope. Confirmed 2026-07-29.)
4. **Import is validate-then-write** (session 10, approved 2026-07-29). The Python import
   writes object by object and a mid-payload conflict leaves earlier objects written,
   with manual recovery. The TS import validates the **entire** payload first — every
   key conflict and rule violation reported together, consistent with the collect-all
   rule — and writes nothing on rejection. Only a clean payload starts writing. A crash
   mid-write can still leave partial state; that residual is accepted (no transactional
   import — Neo4j cannot mix index DDL and data writes in one transaction, and embedding
   calls are external).
5. **Unknown-route 404 uses the error envelope** (session 01, approved 2026-07-29). For a
   URL matching no route, FastAPI leaks `{"detail": "Not Found"}` — outside the envelope,
   same family as divergence #3. The TS server answers
   `404 {"error": {"code": "RESOURCE_NOT_FOUND", "message": "Not Found"}}`. Docs-over-
   implementation; unreachable for the frontend.

`docs/` describes the running Python system and stays untouched during the migration.
When `backend/` is retired (the user's call, after session 11), the five divergences
above must be folded into `docs/` — session 11's parity sweep lists the exact edits.

## Repository layout

```
server/
  package.json  tsconfig.json  vitest.config.ts
  src/
    config.ts            # env-driven settings, same variable names as Python
    main.ts              # startup ordering per docs/architecture.md#startup
    app.ts               # Fastify factory: routes, error handlers, CORS, OpenAPI, MCP mounts
    core/                # exceptions, ports, data-type coercion, oql/, embedding, ai
    modeling/            # service + routes + zod schemas
    runtime/             # service + routes + schema cache + chunking + ai service
    mcp/                 # both MCP servers + ontology-key resolution
    adapters/neo4j/      # driver, ddl, error translation, both stores, oql compiler
  tests/
    modeling/  runtime/  mcp/  core/        # unit (no database)
    integration/                            # requires docker-compose Neo4j
```

Module dependency rule (binding, from `docs/architecture.md`): `modeling → core ← runtime`;
runtime never imports modeling; nothing above the port imports `adapters/`.

## Environment variables

Identical names and defaults to `backend/src/ontoforge_server/config.py`: `DB_BACKEND`,
`DB_URI`, `DB_USER`, `DB_PASSWORD`, `PORT`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`,
`EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS`,
`DOCUMENT_CHUNK_SIZE`, `DOCUMENT_CHUNK_OVERLAP`, `AI_PROVIDER`, `AI_MODEL`,
`AI_BASE_URL`, `AI_API_KEY`, `PUBLIC_URL`, plus `DEFAULT_MCP_ONTOLOGY_KEY` (read by the
runtime-MCP key resolution, see `backend/src/ontoforge_server/mcp/mount.py`).

## Sessions

Execute strictly in order; each is one AI session, one vertical slice, fully testable.
Update the Status column when a session completes.

| # | Spec | Delivers | Status |
|---|---|---|---|
| 01 | [01-skeleton.md](01-skeleton.md) | Server skeleton, config, error model, persistence port, Neo4j adapter foundation, `/features` | Done (2026-07-29) |
| 02 | [02-schema-modeling.md](02-schema-modeling.md) | Global types & properties (REST + modeling MCP server) | Done (2026-07-29) |
| 03 | [03-ontology-lenses.md](03-ontology-lenses.md) | Ontologies, inclusions, cascade protocol, validation | Done (2026-07-29) |
| 04 | [04-runtime-entities.md](04-runtime-entities.md) | Schema cache, introspection, entity CRUD & listing (+ runtime MCP server) | — |
| 05 | [05-relations-traversal.md](05-relations-traversal.md) | Relations CRUD, neighbors | — |
| 06 | [06-documents.md](06-documents.md) | Document reads, partial writes, chunker | — |
| 07 | [07-oql.md](07-oql.md) | OQL parser, validation, Neo4j compiler, `/query` | — |
| 08 | [08-semantic-search.md](08-semantic-search.md) | Embedding provider, vector indexes, semantic search, rebuild | — |
| 09 | [09-saved-queries-agents.md](09-saved-queries-agents.md) | Saved queries (define + run + search), agent configs | — |
| 10 | [10-transfer.md](10-transfer.md) | Schema export / import | — |
| 11 | [11-ai-agents.md](11-ai-agents.md) | AI query/extract/chat, A2A (LangGraph), final parity sweep | — |

Dependency notes: 07 needs 04–05 for meaningful tests; 08 needs 06 (chunk search); 09
needs 07 + 08; 10 needs 09 (transfer carries agents and saved queries); 11 needs 09.

## Rules for every implementation session

0. **The main agent is an orchestrator.** It does not implement. It reads the spec and
   the normative docs, breaks the session into work packages, and delegates coding to
   implementer subagents with precise, self-contained briefs (spec section, doc
   references, Python reference files, expected tests). It delegates test-writing and
   verification the same way, reviews the results against the spec, manages Docker and
   git itself, and only touches code directly for trivial glue the size of a rename.
   Monitoring runs via delegated verification agents — no polling loops.
1. **Read first:** this file, the session spec, every doc the spec lists under
   "Normative", and the Python files under "Reference". The Python code is the tie-breaker
   for wire-format details the docs deliberately leave to `/openapi.json`.
2. **Do not modify** `backend/`, `frontend/`, or `docs/`.
3. **Verticality:** the session ships REST routes, MCP tools, service logic, adapter
   operations, and tests for its feature — nothing stubbed that the spec lists as in scope.
4. **Test gates:** all unit tests green (`npm test`), all integration tests green against
   the docker-compose Neo4j (`docker compose up -d`), and all tests of previous sessions
   still green. Port the corresponding Python test cases (listed per spec) as the parity
   anchor — same scenarios, same expected wire shapes.
   **Environment authority:** sessions manage Docker themselves — start, stop, restart
   and refresh the compose stack at need, including `docker compose down -v` (volumes
   removed) for a clean slate. Stored data is disposable; **no backwards compatibility
   with existing database contents is required.** Ollama is running locally (default
   port) for the sessions that need embedding/LLM integration tests (08, 09, 11); pull
   the models named in `config.ts` defaults if absent.
5. **Parity spot-checks:** when a wire detail is uncertain, run the Python backend
   (`cd backend && uv run uvicorn ontoforge_server.main:app --port 8000`) and the TS
   server on another port, issue the same request to both, and diff the responses.
6. **No scope creep:** no features the Python backend doesn't have, no speculative
   abstractions (KISS/YAGNI per `CLAUDE.md`). New architectural decisions require user
   approval — same rule as the rest of the repo.
7. **Git:** all work happens on the local branch `feature/ts-backend` — session 01
   creates it from `main`; later sessions check it out and continue. Each session ends
   in **exactly one local commit** containing its work plus the Status update below
   (message: `ts-migration NN: <what the session delivered>`, following the repo's
   commit rules in `CLAUDE.md`). **Never push, never open a PR, never merge** — that
   remains the user's call.
8. Finish by updating the Status column above (included in the session's commit).
