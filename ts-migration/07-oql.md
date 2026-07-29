# Session 07 — OQL: parser, validation, compiler, `/query`

**Goal:** the query language, end to end: ANTLR-based parsing and lens validation above
the port, token-rewrite compilation inside the Neo4j adapter, and the runtime query
route/tool with full result post-processing. **This is the riskiest session** — the
approved approach is ANTLR via `antlr4ng` (user-approved; do not substitute).

**Prerequisites:** 01–06 (documents needed for stub post-processing tests).

**Normative:** `docs/capabilities/oql.md` (entire document),
`docs/storage-adapters.md#the-validated-query` (what the adapter may/must-not assume),
`docs/capabilities/ontology-lenses.md#what-scoping-cuts` (per-column stripping),
`docs/decisions.md#behaviour` (ISO GQL anchor).

**Reference (Python):** `core/oql/__init__.py` (parse → analyze → validate → the
`ValidatedQuery` object; `get_return_variables`), `adapters/neo4j/oql_compiler.py`
(token rewriting), `runtime/service.py` (query execution + result post-processing),
`adapters/neo4j/runtime_queries.py` (read-only execution, value conversion),
`backend/tests/runtime/test_cypher.py` (the parity anchor — 44 tests).

## Scope

**In:**
- **Grammar/build:** vendor a Cypher-shaped `.g4` grammar (openCypher's published ANTLR
  grammar or equivalent) and generate the `antlr4ng` lexer/parser/listener in a build
  step (`npm run generate:oql`), committed or generated-on-install — pick the simpler,
  reproducible option and note it. The Python `antlr4-cypher` grammar's rule names
  (`nodePattern`, `relationDetail`, `propertyExpression`, `createSt`…) will differ from
  the new grammar's — **port the collector's semantics, not its rule names.**
- **Analysis (collector):** node variables → label sets; rel variables → type; property
  accesses (variable.property); label/rel-type tokens with token indexes and a
  node-vs-relationship flag; write clauses; CALL; unlabeled-variable tracking where a
  variable bound to a label elsewhere is OK.
- **Validation** against the SchemaCache, collecting all violations into
  `details.errors`, with self-correction hints listing the valid candidates (match the
  Python wording — LLM callers depend on the hints, and the ported tests assert them):
  write clauses; CALL; labelless variable-binding node patterns (anonymous nodes and
  untyped relationships pass); internal labels `_Entity`/`_Chunk` and internal type
  `_HAS_CHUNK` get their own message; unknown/out-of-scope labels, rel types, and
  properties (pattern-local type inference only; system properties always allowed;
  unknown-variable accesses unchecked).
- **`ValidatedQuery`:** text + token stream + analysis; opaque across the port; the
  adapter compiles by rewriting exactly the type-key tokens (snake_case → PascalCase /
  UPPER_SNAKE_CASE) via token positions — never textual find-replace — executes
  read-only, and converts every value recursively (nodes/relationships → plain property
  maps, temporals converted, vectors stripped, lists/maps deep-converted).
- **Result post-processing** above the port: per-column lens stripping of entity/relation
  values (via `get_return_variables`), document stubbing including the
  `variable.property` scalar rule and its documented exception — an **aliased**
  projection of a document property returns the full text; relation values carry no
  endpoint ids. Columnar response: ordered column names + rows.
- Ad-hoc queries run with **no parameter values** (placeholders parse; binding is
  saved-queries-only, session 09 — but the adapter's execute takes a parameter map now).
- No server-imposed limit — unbounded queries return every row.
- REST `POST /query`; MCP `execute_query` (tool description tells the model: type keys,
  reads only, labels required — copy from `mcp/runtime.py`).

**Out:** saved queries (09), natural-language querying (11).

## Grammar-fidelity risk control

The one real risk is grammar drift: `antlr4-cypher` and the chosen TS grammar may accept
slightly different surfaces. Mitigate, in order: (1) port every query string in
`test_cypher.py` first and make them the acceptance gate; (2) run the Python backend
side-by-side and diff `/query` responses for each; (3) any query the old backend accepted
that the new grammar rejects (or vice versa) is a finding to surface to the user, not to
silently absorb.

## Test plan

Port **all** of `backend/tests/runtime/test_cypher.py`, plus:

- **Unit:** each rejection category with its exact hint list; collect-all (a query with a
  bad label AND a bad property reports both); labelless-variable edge cases
  (re-reference OK, anonymous OK); backtick-quoted names; token rewrite leaves
  everything but type keys intact (assert on compiled text).
- **Integration:** multi-hop traversal, aggregation, ORDER BY/SKIP/LIMIT, OPTIONAL
  MATCH, UNWIND against seeded data; per-column stripping through a scoped lens;
  document stub vs aliased-projection full text; scoped lens rejects a globally valid
  type identically to a nonexistent one.
- **MCP:** `execute_query` round-trip incl. a validation failure carrying hints.

## Definition of done

Frontend query console works against the TS server (table + graph result views). All
tests + regression green. Overview updated.
