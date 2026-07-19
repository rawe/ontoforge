# Database Independence — Implementation Guide

> Companion to [database-independence.md](database-independence.md) (the proposal —
> read it first; this guide does not repeat the rationale). Approved 2026-07-19 as
> decisions 008–010.
>
> **Status (2026-07-19): Phases 1–4 are implemented** on this branch. Notable
> deviations from the plan as written: the saved-query step field is `oql` (not
> `query` — that name was already taken by the semantic-search search text, see
> decision 010); the store classes wrap adapter-private query modules
> (`modeling_queries`/`runtime_queries`) instead of absorbing them, so unit tests
> patch the query modules; managed read/write transactions were deferred to keep
> the extraction behavior-preserving (today's per-statement auto-commit semantics
> are unchanged); the OQL spec document (`docs/oql-spec.md`, step 3.2) and the
> explicit Protocol classes in `core/ports.py` are still open. Phase 5
> (PostgreSQL adapter) remains future work. The integration suite could not be
> executed in the implementation environment (no database reachable) and must be
> run against a live Neo4j before release.

## Ground Rules

- **Behavior-preserving by default.** Phases 2–4 are pure refactoring: every REST/MCP
  response byte-identical except where Phase 1 renames apply. The existing test suite
  is the gate — run backend unit + integration tests after every step.
- **Deprecation aliases, not breaks.** Every renamed wire field/tool keeps its old
  name accepted (requests) or mirrored (responses) for one minor release. Mark the
  removal version in the contract docs.
- **One PR per phase step** where practical; each step below is sized to be
  independently reviewable and leaves the tree green.
- Commands: backend via `uv run` (never pip), frontend via `npm`.

## Phase 1 — Contract Neutralization (API, MCP, frontend, docs)

Cheap, user-visible, and independent of the backend refactor. Do it first so the
public surface is frozen before the internals move.

**1.1 REST query endpoint rename**
- `runtime/schemas.py`: `CypherQueryRequest` → `QueryRequest` with field
  `query: str`; accept `cypher` as a validation alias (Pydantic `AliasChoices`),
  emit a deprecation note in the OpenAPI description. `CypherQueryResponse` →
  `QueryResponse` (shape unchanged).
- `runtime/router.py`: endpoint summary/description rewritten in OQL terms.
- Update `docs/api-contracts/runtime-api.md` §7: rename, delete the
  PascalCase/UPPER_SNAKE translation note and `_Entity`/`_Chunk` label mentions
  (replace with "reserved internal names are rejected"), keep the endpoint path.

**1.2 Saved-query steps**
- `core/schemas.py` / `modeling/schemas.py`: `StepSchema.type` value `"cypher"` →
  `"query"`, field `cypher` → `query`; accept the old spelling on input and when
  reading rows persisted before the rename. Responses emit only the new field.
- Export: bump `formatVersion` to `3.0` in `modeling/service.py::export_schema`;
  `import_schema` accepts `2.x` and maps `cypher` → `query`.
- Update both API contract docs and `api-contracts/modeling-api.md` saved-query
  sections.

**1.3 AI surface**
- `runtime/schemas.py`: `AiQueryResponse.cypher` → `query` (serialization alias
  `cypher` mirrored during the deprecation window).
- `runtime/ai_service.py`: prompts stop saying "Neo4j"; they describe OQL ("a
  read-only graph query in OntoForge's query syntax using entity/relation type
  keys"). Tool-call records use the new tool name.

**1.4 MCP tools**
- `runtime/tool_names.py`: `TOOL_EXECUTE_CYPHER = "execute_query"`; register the old
  name `execute_cypher_query` as an alias tool that delegates and is marked
  deprecated in its description.
- `mcp/runtime.py` + `mcp/modeling.py`: rewrite every tool description that mentions
  Neo4j/Cypher conventions; `set_saved_query` examples use `query` steps.
- `docs/mcp-architecture.md`: update the tool catalog.

**1.5 Error message neutralization**
- `core/database.py::validate_vector_indexed_properties`: "Neo4j's semantic-index
  size limit" → "indexed property size limit"; keep the byte limit as a named
  constant the adapter reports (`MAX_VECTOR_FILTER_VALUE_BYTES` stays, but the
  message no longer names the vendor or bolt).
- Grep-audit all raised message strings for "Neo4j"/"Cypher"/"bolt":
  `grep -rn -iE "neo4j|cypher|bolt" backend/src --include='*.py'` — every hit in a
  user-facing string must be justified or fixed.

**1.6 Frontend rename**
- `api/types.ts`: `SavedQueryStep.type: 'query' | 'semantic_search'` (accept legacy
  `'cypher'` in narrowing), `cypher?` → `query?`, `AiQueryResponse.query`,
  `AGENT_TOOL_NAMES` → `execute_query`.
- `api/runtime.ts`: `cypherQuery()` → `runQuery()` posting `{ query }`.
- `components/query/`: rename `CypherEditor.tsx` → `QueryEditor.tsx` (keep the
  CodeMirror cypher mode import — the syntax is unchanged), sweep UI copy in
  `ConsoleTab`, `SaveQueryDialog`, `LibraryTab`, `snippets.ts`, `resultUtils.ts`,
  `useQueryHistory.ts`, `QueryPage.tsx` ("Run read-only queries against this
  ontology"), palette keyword, `storage.ts` comment. URL param `?cypher=` → `?query=`
  with the old param still read.
- `AskTab.tsx`: "Generated Cypher" → "Generated query".
- `useTypeCounts.ts`: replace the hardcoded `MATCH` string with the entity list
  endpoint (`pageSize=1`, read pagination `total`) — removes the only
  frontend-authored query.
- `WelcomePage.tsx` footer copy and `frontend/Dockerfile` label per approved D5.

**1.7 Docs & positioning sweep (per D5)**
- README.md, CLAUDE.md taglines; `plugins/ontoforge/skills/ontoforge-runtime-api`
  (rename "Cypher query" capability, update `references/runtime-api.md` example);
  `ontoforge-setup` skill keeps Neo4j content (it documents the *current adapter's*
  deployment — that is legitimate adapter documentation, not a leak) but stops
  presenting Neo4j as the definition of OntoForge.
- `examples/docker-compose/README.md`: keep the Neo4j service docs, label the
  section "Database (Neo4j adapter)".

**1.8 Verification gate**
- `uv run pytest` (unit + integration), `npm run build` + frontend tests.
- Manual: run a query from the workbench with the new field, run a 2.x export file
  through import, call the MCP tool by old and new name.

## Phase 2 — Port Extraction (backend internals)

Introduce the port and move Neo4j behind it. No wire changes. Order matters: each
step keeps the app running.

**2.1 Define the port (`core/ports.py`)**
- `ModelingStore` and `RuntimeStore` as `typing.Protocol` classes whose methods
  mirror today's `modeling/repository.py` / `runtime/repository.py` functions —
  minus the `session` parameter, plus lifecycle: `init()`, `close()`,
  `ensure_ready()`, `wipe()` (test-only).
- Neutral value types (dataclasses): `FilterSpec(property_key, op, value)`,
  `SortSpec(property_key, descending)`, `QueryResult(columns, rows)`.
- Rule of thumb for method granularity: one port method per existing repo function;
  where a service today runs several repo calls in one session *that must be
  atomic*, collapse them into one port method.

**2.2 Create `adapters/neo4j/` and move code**
- Move `core/database.py` (driver lifecycle, constraints, vector-index DDL) →
  `adapters/neo4j/driver.py` + `adapters/neo4j/ddl.py`. `core/database.py` becomes a
  thin re-export shim until 2.7.
- Move `modeling/repository.py` → `adapters/neo4j/modeling_store.py` as class
  `Neo4jModelingStore`; same for runtime. Session handling moves *into* the store
  methods (`async with self._driver.session() as s:`); switch multi-statement
  methods to `session.execute_read`/`execute_write` for real transactions.
- Deduplicate `_convert_neo4j_types` into one adapter-private module.

**2.3 Repatriate stray Cypher**
- The ~6 inline queries in `modeling/service.py` (`rebuild_embeddings`,
  vector-index rebuild, `elementId()` usage) become `ModelingStore` methods (e.g.
  `iter_entities_for_reembedding()`, `set_entity_embedding(id, vector)`,
  `set_saved_query_embedding(key, vector)` — replacing `elementId()` with the
  saved-query key).
- MCP `_resolve_*` helpers in `mcp/modeling.py` call store methods instead of
  opening sessions.

**2.4 Structured filters**
- Replace `runtime/service.py::_build_filter_clauses` (Cypher string fragments) with
  construction of `FilterSpec` lists; `Neo4jRuntimeStore` compiles them to `WHERE`
  clauses internally. Same for the text-search `CONTAINS` clauses and
  `SortSpec`-driven `ORDER BY`.

**2.5 Neutral temporals**
- `runtime/service.py::coerce_value` returns Python `datetime.date`/`datetime`
  instead of `neo4j.time` types; the adapter converts to driver types on write and
  back on read. Remove the `Neo4jDate`/`Neo4jDateTime` special-case from
  `_entity_matches_filters`. After this step, `import neo4j` must not appear outside
  `adapters/neo4j/` — enforce with a lint/CI grep.

**2.6 Dependency injection swap**
- `config.py`: add `DB_BACKEND: str = "neo4j"` (validated; only `neo4j` accepted for
  now). Defaults for `DB_URI`/`DB_USER`/`DB_PASSWORD` stay.
- `main.py` lifespan builds the stores from `DB_BACKEND` and puts them in app state;
  FastAPI dependencies `get_modeling_store()` / `get_runtime_store()` replace
  `get_driver()` in all routers, services, and MCP mounts. Delete `get_driver` from
  the public surface.

**2.7 Exception mapping + cleanup**
- Adapter catches `neo4j.exceptions.*` and raises domain exceptions (add
  `core/exceptions.py::StoreError` for unexpected driver failures so raw driver
  errors can no longer surface as unshielded 500s).
- Delete the `core/database.py` shim; fix imports.

**2.8 Verification gate**
- Full test suite green; grep gate: `grep -rn "import neo4j" backend/src | grep -v
  adapters/neo4j` returns nothing; manual smoke of modeling + runtime + MCP flows
  per `docs/testing-strategy.md`.

## Phase 3 — OQL Formalization

**3.1 Split `runtime/cypher.py`**
- Parser, analyzer, validator, AST, and the reserved-name checks →
  `core/oql/` (`parser.py`, `validator.py`, `ast.py`). These define the language and
  are adapter-independent.
- The rewriter (ontology keys → PascalCase labels / UPPER_SNAKE types, `SEARCH …
  VECTOR INDEX` knowledge) → `adapters/neo4j/oql_compiler.py`.
- `RuntimeStore.execute_query(ast_or_validated_query, params)` takes the validated
  AST; the Neo4j store compiles and runs it. Saved-query validation
  (`validate_and_rewrite` call sites in import/save paths) uses `core/oql` only.

**3.2 Write the OQL spec (ISO-anchored)**
- New doc `docs/oql-spec.md`. Normative reference: **GQL (ISO/IEC 39075:2024)** and
  its GPML pattern sublanguage (shared with SQL/PGQ, ISO/IEC 9075-16) — per the
  settled anchoring in proposal §4.2. Contents: supported clauses (`MATCH`,
  `OPTIONAL MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, `SKIP`, `WITH`,
  `UNWIND`), pattern forms per the GPML grammar, the variable-length/quantified-path
  decision (proposal §6), function whitelist, `$param` syntax, type coercion, result
  shape, error codes. Each construct cross-references its GQL/GPML counterpart;
  OntoForge restrictions (read-only, ontology keys, reserved names) are explicit
  deltas from the standard.
- Gap analysis first: diff the current validator's accepted grammar against GPML;
  where behavior diverges from the standard, the spec follows ISO and the validator
  is adjusted (breaking cases go through the Phase-1 deprecation policy). The
  validator then becomes the spec's reference implementation.
- `api-contracts/runtime-api.md` §7 and the MCP tool descriptions link to the spec.

**3.3 Verification gate**
- `tests/integration/test_cypher.py` splits: language tests (parse/validate,
  adapter-independent) vs compilation tests (Neo4j adapter). All existing query
  behavior unchanged.

## Phase 4 — Conformance Test Suite

- Restructure `tests/integration/conftest.py`: `wipe_neo4j()`/`check_neo4j()` become
  `store.wipe()` / `store.ensure_ready()` via a `store` fixture built from
  `DB_BACKEND` — the integration suite becomes the **adapter conformance suite**,
  runnable against any future adapter by env var alone.
- Tag the few genuinely Neo4j-specific tests (index DDL details, rewriter output)
  with a marker (`@pytest.mark.adapter_neo4j`) so the portable set is explicit.
- CI: unchanged for now (Neo4j service container); the suite structure is the
  deliverable.

## Phase 5 — PostgreSQL Adapter (future project, not now)

For sizing only; see proposal §4.5 for the mapping. When started:

1. `adapters/postgres/` with the table schema from the mapping (migrations via plain
   SQL files — no ORM), asyncpg driver, pgvector.
2. Implement `ModelingStore` (mechanical — schema CRUD is plain relational).
3. Implement `RuntimeStore` CRUD + neighbors (joins) + semantic search (pgvector
   HNSW) + chunks (chunk table).
4. OQL compiler: AST → SQL. Fixed-depth patterns as joins (optionally
   `GRAPH_TABLE` on PG19+); variable-length (if in spec) as `WITH RECURSIVE`.
   This is the largest single work item.
5. Run the Phase-4 conformance suite with `DB_BACKEND=postgres` until green; add a
   compose file with a `postgres` service.

Rough effort split observed from the audit: ~85 repo queries to port mechanically,
one OQL compiler to write, one vector-search implementation — with Phases 1–4 done,
this is an isolated, testable project; without them it is a rewrite.

## Sequencing Summary

| Phase | Scope | Risk | Depends on |
|-------|-------|------|-----------|
| 1 | Wire/UI/docs renames + aliases | Low (aliases) | Approval of D2–D5 |
| 2 | Port + adapter extraction | Medium (mechanical but broad) | D1 |
| 3 | OQL split + spec | Medium | Phase 2 |
| 4 | Conformance suite | Low | Phase 2 (3 for query tests) |
| 5 | PostgreSQL adapter | Future | Phases 1–4, D6 revisited |

The end state after Phases 1–4: Neo4j is one directory (`adapters/neo4j/`), the API,
frontend, and MCP speak only OntoForge vocabulary, and "add PostgreSQL" is a bounded
adapter project instead of a rewrite.
