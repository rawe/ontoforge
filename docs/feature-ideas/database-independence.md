# Database Independence — Proposal

> **Status: PROPOSAL — not approved.** Per the project rules, every architectural
> decision requires user approval. Section 7 lists the decisions to settle before
> implementation starts. The companion document
> [database-independence-implementation.md](database-independence-implementation.md)
> contains the concrete implementation steps.

## 1. Motivation and Goal

OntoForge is currently positioned as "Neo4j-native". The goal of this proposal is to
make Neo4j an **exchangeable storage adapter** behind a stable abstraction layer, so
that a future backend — specifically PostgreSQL with its new graph features — can be
added without changing the API contract, the frontend, or the MCP interface.

Explicit goals:

1. A **stable persistence port** in the backend: services talk to an interface, not to
   the Neo4j driver.
2. **No Neo4j-specific concepts in the public surface**: REST API contracts, MCP tool
   catalog, frontend, export format, and error messages must be expressed in
   OntoForge's own vocabulary (entity types, relation types, ontologies, queries).
3. **PostgreSQL readiness**: the abstraction must be implementable on PostgreSQL
   (relational tables + pgvector, optionally SQL/PGQ), verified by a written mapping —
   not by building the adapter now (YAGNI).

Non-goal: building the PostgreSQL adapter itself. This proposal creates the boundary;
the second backend is a future project that becomes *possible and cheap* instead of a
rewrite.

## 2. Current State — Coupling Inventory

Audit performed on the full repository (2026-07). Headline numbers: ~215 Neo4j/Cypher
references across 18 backend source files, 103 across 19 frontend files, 253 across 22
docs files, 5 docker-compose files plus `dev.sh`.

### 2.1 What is already clean

The situation is better than the raw counts suggest. These parts are already
database-agnostic and must simply be preserved:

- **Instance identity**: every public `_id` is an application-generated UUID. Neo4j
  internal element IDs never appear in any API payload. (The single internal use of
  `elementId()` is in `rebuild_embeddings` in `modeling/service.py` and never leaves
  the backend.)
- **Error envelope**: the REST error format uses app-defined codes
  (`RESOURCE_NOT_FOUND`, `VALIDATION_ERROR`, …), not driver errors.
- **Export format**: the JSON transfer format is schema-semantic (keys, data types,
  scoping) — with one exception, the saved-query `cypher` field (see below).
- **Unit tests**: mock at the service↔repository boundary and never assert on Cypher
  text; they would survive an adapter swap almost unchanged.
- **Existing seam patterns**: `core/embedding.py` (`get_embedding_provider()`) and
  `core/ai.py` (`get_ai_model()`) are exactly the provider-abstraction shape the
  database port should follow.
- **Frontend graph internals**: no labels, bolt URIs, or element IDs anywhere in the
  frontend. The entire frontend leak is Cypher-as-a-language plus one line of UI copy.

### 2.2 Leaks in the public API contract

These are promises to clients that only Neo4j can keep, ordered by severity:

| # | Leak | Where |
|---|------|-------|
| L1 | Query endpoint takes a `cypher` field; contract documents "translated to Neo4j conventions (PascalCase / UPPER_SNAKE_CASE)" and forbids internal labels `_Entity`, `_Chunk`, `_HAS_CHUNK` | `POST /api/runtime/{key}/query`, `CypherQueryRequest` in `runtime/schemas.py`, `api-contracts/runtime-api.md` §7 |
| L2 | Saved queries store and transport raw Cypher: step `type: "cypher"` with a `cypher` string — in the modeling API, in the runtime API, and in the **export format** (`ExportSavedQueryStep.cypher`, formatVersion 2.2) | `core/schemas.py`, `modeling/schemas.py`, both API contracts |
| L3 | AI endpoints return generated Cypher: `AiQueryResponse.cypher`, chat `tool_calls` naming `execute_cypher_query` | `runtime/schemas.py`, `runtime/ai_router.py` |
| L4 | MCP runtime tool `execute_cypher_query`; its description instructs the LLM about *Neo4j* conventions; modeling MCP `set_saved_query` embeds Cypher examples | `mcp/runtime.py`, `mcp/modeling.py`, `runtime/tool_names.py` |
| L5 | Error messages name the vendor: "Neo4j's semantic-index size limit", the 32766-byte bolt limit; contract says saved-query parameters are "passed natively to Neo4j" | `core/database.py::validate_vector_indexed_properties`, `api-contracts/runtime-api.md` |
| L6 | Contract documents the physical index name `entity_embedding` on the `_Entity` label and Cypher `REMOVE` semantics for null properties | `api-contracts/runtime-api.md` |

### 2.3 Leaks in the frontend

- The Query workbench is Cypher-branded end to end: `pages/workbench/QueryPage.tsx`,
  `components/query/*` (`CypherEditor`, `ConsoleTab`, `snippets.ts`, `SaveQueryDialog`,
  `LibraryTab`), Studio `SavedQueriesTab.tsx`, AI `AskTab.tsx` ("Generated Cypher").
- Wire types mirror the leak: `SavedQueryStep.type: 'cypher'`, `AiQueryResponse.cypher`,
  `AGENT_TOOL_NAMES` containing `'execute_cypher_query'` (`api/types.ts`,
  `api/runtime.ts`).
- `components/home/useTypeCounts.ts` builds **raw Cypher in the frontend**
  (`MATCH (n:${t.key}) RETURN count(n)`) — the only place a UI component authors a
  query itself.
- UI copy: `WelcomePage.tsx` footer "Schema and data live together in Neo4j";
  `frontend/Dockerfile` image description "Neo4j-native".

### 2.4 Backend-internal coupling (behind the API)

- **No port**: `core/database.py` owns a global `neo4j.AsyncDriver` singleton;
  `get_driver()` is injected into every router, service, and MCP helper. Repository
  functions receive an open `AsyncSession`.
- **Session/transaction ownership is in the service layer**: ~50 `async with
  driver.session()` sites across `runtime/service.py`, `modeling/service.py`, and MCP
  helpers. All access is auto-commit `session.run` — no managed transactions.
- **Driver types escape the repository**: `runtime/service.py::coerce_value` *produces*
  `neo4j.time.Date`/`DateTime` values for `date`/`datetime` properties;
  `_entity_matches_filters` special-cases them; `Node`/`Relationship` appear in
  `runtime/repository.py::_convert_record_value`. `_convert_neo4j_types` is duplicated
  in both repositories.
- **Query construction straddles layers**: `runtime/service.py::_build_filter_clauses`
  builds Cypher `WHERE` fragments as strings and passes them into repository functions;
  `list_entities` builds `toLower(...) CONTAINS` clauses; `modeling/service.py`
  contains ~6 inline Cypher queries (`rebuild_embeddings`, vector-index rebuild) that
  bypass the repository entirely.
- **Cypher inventory**: ~50 queries in `modeling/repository.py`, ~35 in
  `runtime/repository.py`, ~26 DDL/index statements in `core/database.py`. Dynamic
  label/relationship-type interpolation is pervasive (safe — values come from the
  schema cache — but Neo4j-shaped).
- **Cypher dialect machinery**: `runtime/cypher.py` parses, validates, and rewrites
  user queries via ANTLR (snake_case keys → PascalCase labels / UPPER_SNAKE_CASE
  types). This is the one place query handling is *already centralized* — the seed of
  the portable query layer.
- **Integration tests** hard-code Neo4j: real driver fixture, `wipe_neo4j()` via
  `MATCH (n) DETACH DELETE n`, direct imports of the Cypher rewriter.

### 2.5 Deployment and positioning

Five docker-compose files, `dev.sh`, the `ontoforge-setup` plugin skill, README, and
CLAUDE.md all treat Neo4j as fixed infrastructure; "Neo4j-native" is the product
tagline in README.md, CLAUDE.md, and both Dockerfile image descriptions.

## 3. Research — PostgreSQL Graph Landscape (July 2026)

Facts gathered for this proposal, with confidence labels. Sources: postgresql.org
announcements and docs, commitfest, InfoQ, CYBERTEC, Apache AGE release notes.

- **PostgreSQL 19 ships SQL/PGQ** (SQL:2023 Part 16, Property Graph Queries).
  *Confirmed:* the patch was committed 2026-03-16 and is in Beta 1 (2026-06-04) and
  Beta 2 (2026-07-16); GA expected Sept/Oct 2026. PG19 provides
  `CREATE PROPERTY GRAPH` (a metadata layer over existing relational tables) and
  `GRAPH_TABLE` pattern matching that is **rewritten into joins** — there is no new
  storage engine.
- **SQL/PGQ in PG19 is read-only and fixed-depth.** *Confirmed by multiple sources:*
  no variable-length paths (`*`, `+`, `{m,n}`), no shortest path. Every hop must be
  written explicitly; recursive traversal still requires `WITH RECURSIVE`.
  Variable-length paths are expected in a later release (PG20 is *speculative*).
  Minor caveat: a pgsql-hackers thread discussed gating the feature behind an
  experimental GUC; the beta docs show it enabled, but beta features can change before
  GA — re-verify at PG19 GA.
- **Apache AGE** (openCypher-on-Postgres extension) is an active Apache TLP with
  2025/2026 releases and PG 11–18 + 19beta support. However: it implements a *subset*
  of openCypher (no `MERGE ... ON CREATE SET`, no `datetime()`, thin function
  library), uses a foreign call convention (`SELECT * FROM cypher('graph', $$…$$)`
  returning `agtype`), and practitioner reports show variable-length paths bypassing
  indexes. *Confirmed:* "write Cypher once, run on Neo4j and AGE" is **not** realistic
  without a compatibility layer.
- **Consequence for OntoForge:** the portable abstraction belongs at the
  **repository/port layer, not the query-language layer**. A PostgreSQL adapter would
  be built on plain relational tables + `WITH RECURSIVE` + pgvector, and may use
  `GRAPH_TABLE` as an *optimization* for fixed-depth reads — never as the foundation,
  because all writes and variable-depth traversals need plain SQL regardless.

## 4. Target Architecture

### 4.1 Principle: ports and adapters

Introduce a persistence port in `core/`, following the same shape as the existing
embedding-provider seam. Services depend on the port; one adapter package implements
it per database. No ORM, no generic query-builder framework — the Neo4j adapter is
today's repository code moved behind an interface (KISS).

```
backend/src/ontoforge_server/
├── core/
│   ├── ports.py            # ModelingStore + RuntimeStore Protocols, neutral value types
│   └── oql/                # portable query dialect: parser, validator, AST (from runtime/cypher.py)
├── adapters/
│   └── neo4j/              # driver lifecycle, both store implementations,
│                           # OQL→Cypher compiler, DDL/constraints/vector indexes
├── modeling/               # router + service only (repository.py moves to adapters/neo4j)
└── runtime/                # router + service only
```

**Port granularity** — two store interfaces mirroring the existing repository split,
plus neutral value types:

- `ModelingStore` — schema CRUD: ontologies, entity/relation types, properties,
  scoping, agents, saved queries, export reads.
- `RuntimeStore` — instance CRUD, neighbors traversal, semantic search, document
  chunks, OQL query execution, saved-query execution.
- Lifecycle owned by the adapter: `init()`, `close()`, `ensure_ready()` (constraints +
  indexes), and `wipe()` (test support only).
- Neutral value types replace ad-hoc dicts where driver types currently leak:
  `FilterSpec` (property, operator, value), `SortSpec`, `QueryResult(columns, rows)`
  with JSON-safe scalars, Python `datetime.date`/`datetime.datetime` for temporals.

**Contract rules for the port** (what makes it stable):

1. The port speaks **ontology vocabulary only**: type keys, property keys, ontology
   keys, instance UUIDs. Labels, PascalCase conversion, relationship-type naming, and
   index names are private to the Neo4j adapter.
2. The port **owns connections and transactions**. Services never see a session. Each
   port method is atomic; multi-step operations that must be atomic become single port
   methods.
3. The port accepts **structured inputs, never query fragments**. Filtering/sorting
   parameters replace the Cypher `WHERE`-clause strings that services build today.
4. The port returns **plain Python/JSON-safe types**. Adapter converts driver
   temporals at the boundary, both directions.
5. Adapter maps driver exceptions to the existing domain exceptions; driver exception
   types never cross the port.

### 4.2 The query language: OQL

The hardest leak is the user-facing query feature (console, saved queries, AI query
generation). Three options were considered:

| Option | Assessment |
|--------|------------|
| **A. Define the existing validated subset as OntoForge's own query language ("OQL")** | The endpoint already accepts only a parsed, validated, rewritten read-only subset (`MATCH`, `OPTIONAL MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, `SKIP`, `WITH`, `UNWIND`) expressed in ontology keys, not Neo4j labels. Formalize exactly that as OQL: openCypher-shaped syntax, OntoForge semantics, spec'd independently of Neo4j. Adapters compile the validated AST to their native form. **Recommended.** |
| B. Replace with a structured JSON query DSL | Loses expressiveness, is worse for humans, and materially worse for LLM query generation (models write Cypher-style patterns well, bespoke JSON DSLs poorly). More work for less capability. |
| C. Drop the generic query endpoint | Feature regression (Query workbench, saved queries, AI query) — not acceptable. |

Option A is honest about the trade-off: OQL *syntax* stays openCypher-shaped (which is
also the direction of the ISO GQL standard and of SQL/PGQ's pattern sublanguage, so
the syntax family is an industry standard, not a Neo4j private dialect). What changes
is the contract: the API promises **OQL semantics defined by OntoForge's spec**, not
"whatever Neo4j does". Concretely:

- `runtime/cypher.py` splits: parser + validator + AST become `core/oql/`
  (database-independent, defines the language); the label/type rewriter becomes the
  Neo4j adapter's OQL compiler.
- The wire field renames from `cypher` to `query` everywhere (with a deprecation
  window, see 4.3).
- A short OQL spec document defines: supported clauses, pattern forms (including
  whether variable-length patterns are in scope — they must be either specified and
  implemented by every adapter, e.g. via `WITH RECURSIVE` on PostgreSQL, or rejected
  by the validator), functions, parameter syntax, and result shape.
- Adapter-specific error strings are replaced by OQL validator messages (already
  mostly true today).

### 4.3 Public contract changes (de-leak)

All renames keep a **one-minor-release deprecation alias** so existing clients and
saved data keep working. Mapping of the leaks from §2.2/§2.3:

| Leak | Change |
|------|--------|
| L1 | `POST …/query` body field `cypher` → `query` (alias accepted). Contract §7 rewritten in OQL terms: "queries use entity/relation type keys"; the PascalCase/label translation note and `_Entity`/`_Chunk` mentions are deleted (reserved names stay enforced, described as "reserved internal names"). |
| L2 | Saved-query step `type: "cypher"` → `"query"`, field `cypher` → `query`. Export `formatVersion` bumps to **3.0**; import continues to accept 2.x and maps the old field names. |
| L3 | `AiQueryResponse.cypher` → `query`; chat `tool_calls` show the new tool name. |
| L4 | MCP tool `execute_cypher_query` → `execute_query` (old name kept as hidden alias for one release); all MCP tool descriptions rewritten to describe OQL and ontology vocabulary — no "Neo4j conventions" phrasing. Same for the agent-restrictable tool name list. |
| L5 | Error messages neutralized: "Neo4j's semantic-index size limit" → "indexed property size limit" (the numeric limit stays, as an adapter-reported constant); "passed natively to Neo4j" → "passed as typed parameters". |
| L6 | Physical index names and Cypher `REMOVE` phrasing removed from contracts; behavior described observationally ("setting a property to null unsets it"). |
| Frontend | Query surface rebrands Cypher → "Query (OQL)" in copy and component names; the CodeMirror Cypher mode stays (the syntax is the same). `useTypeCounts` stops authoring queries and uses the list endpoint's pagination `total` (no new endpoint needed). `WelcomePage` footer and Dockerfile descriptions lose "Neo4j". |

### 4.4 Storage model becomes adapter documentation

`architecture.md` §4 ("Neo4j Storage Model") splits into:

- a **logical data model** in `architecture.md`: entity/relation/property/ontology
  semantics, system property names (`_id`, `_entityTypeKey`, …), scoping, document
  stubs — everything the API promises;
- a **Neo4j adapter mapping** doc: labels, PascalCase conventions, native
  relationships, constraints, vector indexes, chunk nodes — everything only the
  adapter knows.

### 4.5 PostgreSQL adapter feasibility (mapping sketch, not built now)

Verification that the port is implementable on PostgreSQL ≥ 17, refined by PG19:

| Concern | PostgreSQL mapping |
|---------|--------------------|
| Schema objects | Plain relational tables: `ontology`, `entity_type`, `relation_type`, `property_def`, `ontology_includes` (the `INCLUDES_TYPE` edge becomes a join table with a nullable `properties text[]`). |
| Entity instances | `entity(id uuid PK, type_key text, props jsonb, created_at, updated_at, embedding vector)` — GIN index on `props`, btree on `type_key`. |
| Relation instances | `relation(id uuid PK, type_key text, from_id uuid FK, to_id uuid FK, props jsonb, …)` — fixes Neo4j CE's un-indexable relationship lookup as a bonus. |
| Neighbors / fixed-depth OQL | Joins; optionally PG19 `GRAPH_TABLE` over a `CREATE PROPERTY GRAPH` defined on the two instance tables (read-only is exactly what the query endpoint needs). |
| Variable-depth traversal | `WITH RECURSIVE` (required regardless of SQL/PGQ). |
| Semantic search + document chunks | pgvector (HNSW) on `entity.embedding` and a `chunk` table replacing chunk nodes. Per-type "indexes" become partial indexes or plain filtered queries. |
| Typed property values | Values inside `jsonb` with the schema cache driving coercion — same validation pipeline as today; filter pushdown via jsonb operators, with expression indexes if needed later. |
| Transactions | Native — strictly better than today's auto-commit `session.run`. |

Apache AGE is **not** recommended as the basis: its openCypher subset and `agtype`
call convention would couple OntoForge to a second vendor dialect — the port + OQL
compiler approach makes AGE unnecessary.

## 5. What This Proposal Does *Not* Do

- No PostgreSQL adapter is built now (YAGNI — the mapping above proves feasibility).
- No change to the logical data model, endpoints' shapes beyond the renames, the
  schema cache design, or the validation pipeline.
- No ORM / SQLAlchemy / query-builder dependency.
- Neo4j remains the reference adapter and the default deployment.

## 6. Risks and Open Points

- **OQL variable-length patterns**: must be explicitly ruled in or out of the spec
  (§4.2). Ruling them in commits every future adapter to recursive traversal.
- **Semantic search parity**: vector search scoring/behavior will differ slightly
  across adapters; the conformance suite pins observable behavior, not scores.
- **Deprecation window**: one minor release for `cypher`→`query` aliases; saved
  queries stored in the DB are migrated by the import/read path, not by hand.
- **PG19 GA**: re-verify SQL/PGQ shipping state at GA (beta features can change);
  nothing in the port depends on it.

## 7. Decisions Requiring User Approval

1. **D1 — Introduce the persistence port** (`ModelingStore`/`RuntimeStore` protocols in
   `core/ports.py`, Neo4j code moves to `adapters/neo4j/`), adapter owns sessions,
   transactions, DDL, and type conversion.
2. **D2 — OQL**: adopt option A — the existing validated read-only openCypher-shaped
   subset becomes OntoForge's own specified query language; parser/validator move to
   `core/oql/`; compilation is adapter-private.
3. **D3 — Contract renames with deprecation**: `cypher` → `query` across REST, MCP
   (`execute_query`), AI responses, and frontend types; one-minor-release aliases.
4. **D4 — Export format 3.0**: saved-query steps use `query`; import keeps accepting
   2.x.
5. **D5 — Positioning**: retire "Neo4j-native" from README/CLAUDE.md/Dockerfiles in
   favor of e.g. "graph-native ontology studio (Neo4j today, PostgreSQL-ready)".
6. **D6 — Scope**: no PostgreSQL adapter implementation now; conformance test suite is
   built against the port so a second adapter can be validated later.

Once approved, these become entries in `docs/decisions.md`, `architecture.md` is
restructured per §4.4, and implementation follows the phases in
[database-independence-implementation.md](database-independence-implementation.md).
