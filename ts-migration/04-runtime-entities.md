# Session 04 — Runtime foundation: schema cache, introspection, entities, runtime MCP

**Goal:** the runtime comes alive through one lens: schema cache, scoped introspection,
the full entity lifecycle with the validating write pipeline and the listing machinery,
and the runtime MCP server with its entity tools.

**Prerequisites:** 01–03.

**Normative:** `docs/architecture.md#schema-cache`, `#request-lifecycle`,
`#ontology-scoping`; `docs/capabilities/ontology-lenses.md#the-scoping-matrix`,
`#what-scoping-cuts`, `#the-lensfull-schema-asymmetry`;
`docs/capabilities/instance-data.md` (entities, validation, partial updates, system
properties, listing, field projection); `docs/capabilities/schema-modeling.md#data-types`
and `#required-and-default` (coercion + default failure modes);
`docs/interfaces.md` (runtime conventions: listing/sorting/filtering vocabulary, field
projection table, naming irregularities); `docs/capabilities/documents.md#the-stub-read-model`
(stubs only — the rest of documents is session 06); `docs/decisions.md#behaviour`.

**Reference (Python):** `runtime/service.py` (SchemaCache, validation pipeline, entity
portions), `runtime/router.py`, `runtime/schemas.py`, `adapters/neo4j/runtime_store.py`,
`runtime_queries.py`, `adapters/neo4j/filters.py` (predicate builder),
`mcp/runtime.py` (entity tools), `mcp/mount.py` (`OntologyKeyMiddleware`).

## Scope

**In:**
- **SchemaCache:** per-lens value assembled lazily from the runtime store's own schema
  reads (runtime never calls modeling — port rule), holding the scoped schema, the full
  schema, and (empty until 09) agents and saved queries. Implements the four-row scoping
  matrix including inferred relation types, silent skipping of dead inclusion keys, and
  wholesale invalidation — wire the seam left in sessions 02/03 so **every** modeling
  mutation clears the whole cache. Unknown ontology key → not found.
- **Schema introspection REST:** the five `/schema*` routes, filtered to the lens;
  out-of-scope type reads answer not-found indistinguishably from nonexistent.
- **Entities REST:** create, list, read, patch, delete. The full validation pipeline:
  unknown-property rejection (system properties rejected as unknown too), required check,
  defaults from the **full** schema (with both documented bad-default failure modes),
  strict coercion per the seven-type table, **all errors collected** into
  `details.fields`. Partial-update semantics: null removes optional / rejected on
  required; no-change update returns current state without advancing `_updatedAt`.
  Delete removes attached relations (DETACH-style) and chunks.
- **Listing machinery:** paging bounds (reject out of range), sort incl. underscore-less
  aliases, `q` over in-scope string props (silently ignored when none), `filter.*` with
  operator = segment after the **last** `__`, coercion per declared type
  (`__contains` textual), unknown property/operator/uncoercible → collected validation
  errors; `items/total/limit/offset` shape. Adapter predicate builder: values always
  bound parameters; keys interpolated only from stored schema.
- **Field projection** incl. the always-returned system fields per the interfaces table,
  and document-property stubbing (`{document: true, length}`) with length bookkeeping on
  writes + measure-on-read fallback; naming a document property in `fields` returns raw
  content. (Document routes themselves are session 06.)
- **Runtime MCP server** at `/mcp/runtime` with lens resolution in priority order: first
  path segment → `X-Ontology-Key` header → `DEFAULT_MCP_ONTOLOGY_KEY` env var → 400.
  Tools: `get_schema`, `create_entity`, `list_entities`, `get_entity`, `update_entity`,
  `delete_entity`. MCP **clamps** limit/offset into range where REST rejects.
- Entity `_id` generation: match the Python format exactly (check `runtime/service.py`).

**Out:** relations and neighbors (05 — entity delete's relation cascade is written but
only provable then), document routes/chunking (06), `q`/search beyond literal listing.

## Key behaviors and traps

- **Writes validate against the lens; defaults come from the full schema** — the central
  asymmetry, stated in `docs/decisions.md`. A hidden property with a default is applied;
  a hidden property in the payload is an unknown property.
- Timestamps and system props are adapter-maintained on every write; embedding vectors
  and length bookkeeping never appear in any response.
- Coercion: booleans are rejected for integer/float **before** numeric conversion; date
  and datetime are stored as temporals, returned as ISO; naive datetimes are UTC.
- Cache is per process, cleared wholesale — do not build selective invalidation.
- The cache stores the lens as a **value**; request handling must not re-read the schema
  mid-request.

## Test plan

Port `backend/tests/runtime/test_schema_cache.py`, `test_entities.py`,
`test_schema_introspection.py`, `backend/tests/modeling/test_runtime_cache_invalidation.py`,
and the entity portion of the MCP tests. Fixture: `backend/tests/fixtures/test_ontology.json`
(recreate its shape via the modeling API until import exists).

- **Unit:** scoping matrix — all four rows, plus the inferred-relations rule and the
  first-explicit-relation cliff edge; every coercion accept/reject cell of the data-type
  table; collect-all (one write, several bad fields, one response); default-from-hidden-
  property; both bad-default failure modes; null-removal semantics; filter suffix and
  sort-alias parsing; stub + projection interplay.
- **Integration:** entity CRUD through scoped and unscoped lenses; listing with combined
  q + filters + sort + paging returning correct `total`; cache invalidation across a
  modeling change (create type → visible through unscoped lens without restart).
- **MCP:** all three lens-resolution sources and the 400; clamping; entity tool round-trip.

## Definition of done

Frontend data workbench (entity tables, detail view, editing) works against the TS server
for a schema without relations. All tests + regression green. Overview updated.
