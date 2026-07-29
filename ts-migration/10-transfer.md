# Session 10 — Schema transfer (export / import)

**Goal:** the complete transfer format — now that everything it carries exists — with
export, import, and the modeling MCP pair.

**Prerequisites:** 01–09.

**Normative:** `docs/capabilities/transfer.md` (entire document — format contents,
version semantics, all-or-fail conflicts, id regeneration, import validations, side
effects; its non-atomicity section is **superseded** by approved divergence #4 below),
`docs/capabilities/schema-modeling.md#schema-validation`
(why import's gaps make the validation pass earn its place).

**Reference (Python):** `modeling/service.py` (export/import), `core/schemas.py`
(transfer payload models — the field names ARE the format; copy them exactly),
`adapters/neo4j/modeling_store.py` (list-for-export variants), `mcp/modeling.py`
(`export_schema`, `import_schema`), `backend/tests/fixtures/test_ontology.json`
(a real payload — use as a fixture and parity check).

## Scope

**In:**
- `GET /api/model/export`: one payload — format version (current value from the Python
  models), entity types with properties, relation types with properties + endpoint keys,
  ontologies with inclusions (inclusions key absent for unscoped lenses), agents and
  saved queries nested in their lens. No timestamps, no internal ids, no instance data.
- Align modeling MCP `get_schema` (session 02) to return exactly this payload; assert
  equality with export in a test.
- `POST /api/model/import`:
  - **Validate-then-write (approved divergence #4 — replaces Python's behavior):** the
    entire payload is validated before anything is written. All failures — key
    conflicts, reserved keys, pattern violations, structural rules — are collected and
    reported together, and a rejected import leaves the database untouched. Only a clean
    payload starts writing. (Python writes sequentially and a mid-payload conflict
    strands the earlier objects; do NOT port that. A crash mid-write can still leave
    partial state — accepted residual, no transactional import.)
  - **Conflicts:** any already-present entity-type/relation-type/ontology key fails the
    import, naming every conflicting key (409 `RESOURCE_CONFLICT`). No merge, no skip.
  - **Validations** (write-path rules): reserved keys; `document` on entity types only;
    agent allowlists against the grantable ten; saved-query structural validation
    identical to definition time (but **no** OQL lens check — imported pipelines may
    fail at first run); saved-query parameters never `document`.
  - **Approved divergence #1 (the fix):** validate every imported key against the same
    patterns the interactive paths enforce — type keys, property keys, ontology keys
    (`^[a-z][a-z0-9_]*$`), agent and saved-query keys (`^[a-z][a-z0-9_-]*$`). This
    closes the documented `_id`-property hole. Reject with the standard validation
    envelope naming each offending key (collected).
  - **Version is informational:** old, unknown, or missing versions process identically.
  - **Preserved gap:** import does NOT check property data types against the enum — the
    schema-validation operation is what catches that; keep it so (only the key-pattern
    fix was approved).
  - **Side effects:** per imported entity type, vector index with filterables + one per
    document property; saved-query index ensured once at the end; saved-query
    descriptions embedded as written; all of it skipped without a provider; cache
    invalidated; response lists created lenses.
  - Inclusions are written **without** the four inclusion rules (documented; lens
    validation reports the damage) — preserve.
- MCP: `export_schema`, `import_schema`.

**Out:** instance data (never part of the format).

## Test plan

Port `backend/tests/modeling/test_schema_operations.py` (transfer parts) and the MCP
transfer tests:

- **Unit:** payload field-level snapshot against a fixture exported from the Python
  backend (byte-shape parity — this is the strongest cross-implementation check in the
  whole migration); conflict on each key kind; **validate-then-write** — a payload with
  a mid-payload conflict writes nothing, and a payload with several problems reports
  them all in one response; version indifference; each import validation; the new
  key-pattern rejections incl. a property named `_id` and an underscore-leading
  ontology key; unscoped lens has no inclusions key in export.
- **Integration:** export → wipe → import → export again is a fixed point (identical
  payloads); import with Ollama configured creates the vector indexes and embeds
  saved-query descriptions (searchable immediately); `get_schema` ≡ export.
- **Round-trip against Python:** import a payload exported by the running Python backend
  and re-export; diff. Do the reverse if convenient.

## Definition of done

Frontend transfer surface (download/upload, conflict reporting) works against the TS
server. All tests + regression green. Overview updated.
