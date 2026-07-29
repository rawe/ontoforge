# Session 02 — Global schema modeling + modeling MCP server

**Goal:** the global schema surface — entity types, relation types, property definitions —
over REST and over a mounted modeling MCP server.

**Prerequisites:** 01.

**Normative:** `docs/capabilities/schema-modeling.md` (all of it — keys, immutability,
data types, required/default, reserved keys, deletion rules),
`docs/interfaces.md` (modeling REST route tables; "What a path segment identifies";
modeling tool table), `docs/architecture.md#invariants`.

**Reference (Python):** `modeling/router.py`, `modeling/schemas.py`,
`modeling/service.py` (type + property portions), `adapters/neo4j/modeling_store.py`,
`modeling_queries.py`, `mcp/modeling.py`, `mcp/mount.py` (modeling mount only),
`core/schemas.py` (data-type enum, key patterns).

## Scope

**In:**
- REST under `/api/model`: entity-types CRUD, relation-types CRUD, properties CRUD on
  both owners — **addressed by internal identifier**, exactly as tabulated in
  `docs/interfaces.md`. Response shapes: mirror the Python `modeling/schemas.py` models
  (verify with parity spot-checks; ids are exposed on this surface by design).
- Service rules: key pattern `^[a-z][a-z0-9_]*$`; global uniqueness (entity-type and
  relation-type keys are separate namespaces); relation endpoints must exist and are
  immutable; an entity type referenced by any relation type is undeletable —
  **unconditional 409, cascade never overrides it**; `document` data type on entity types
  only; reserved-key rejection using the adapter's declared sets; sparse updates
  (omitted field = unchanged; a description can't be cleared); the one exception —
  explicit `default: null` clears a default (the store's update op needs the separate
  "clear default" flag, see `docs/storage-adapters.md` "Property management").
- Adapter: schema-side store ops for types and properties, plus full-schema retrieval
  (one coherent snapshot — needed by `get_schema` now and validation/export later).
- Modeling MCP server mounted at `/mcp/model` — Streamable HTTP, stateless, JSON
  responses, no ontology key (global by design; a trailing path segment is NOT a lens).
  Tools this session: `get_schema`, `create_entity_type`, `update_entity_type`,
  `delete_entity_type`, `create_relation_type`, `update_relation_type`,
  `delete_relation_type`, `add_property`, `update_property`, `delete_property`.
  MCP takes **keys** and a `type_kind` discriminator for properties; it resolves keys to
  ids internally per call (not cached). Tool errors flatten field details into the
  message text.
- Two seams for later sessions, defined now as no-ops: schema-cache invalidation
  (filled in 04) and vector-index lifecycle hooks (filled in 08). Every mutating service
  path calls them at the same points the Python service does.

**Out:** ontologies/inclusions and the cascade protocol (03 — the `cascade` parameter is
accepted on the four operations that take it, but with no scoped lenses it can never
trigger; write the parameter plumbing, not the protocol); validation routes (03);
export/import (10).

## Key behaviors and traps

- `delete_entity_type` refusal (referenced by a relation type) is `RESOURCE_CONFLICT`,
  not `CASCADE_REQUIRED` — "there is no consenting to it".
- Type deletion deletes its property definitions but **never instance data** — stranded
  entities are documented behavior.
- Defaults are stored as strings and **not validated against the data type at definition
  time** — a bad default is legal to store (its failure modes are write-path behavior,
  session 04).
- MCP `get_schema` returns the same payload shape as export
  (`docs/capabilities/transfer.md`); build it from full-schema retrieval now with an
  empty `ontologies` array — session 10 asserts it equals the export payload exactly.
- Nothing validates or coerces display names/descriptions beyond requiredness — keep it
  as thin as the Python service.

## Test plan

Port `backend/tests/modeling/test_entity_types.py`, `test_relation_types.py`,
`test_properties.py`, `test_reserved_type_keys.py`, and the type/property portions of
`backend/tests/mcp` — same scenarios:

- **Unit (mocked store):** key-pattern rejections (uppercase, leading underscore, leading
  digit); duplicate keys; endpoint-must-exist; undeletable-while-referenced; document-on-
  relation-type rejected; sparse update semantics incl. clear-default; reserved-key
  rejection message lists the reserved set and names no vendor.
- **Integration (Neo4j):** full CRUD round-trips for both type kinds and properties;
  uniqueness enforced by constraints under concurrent-ish double-create; full-schema
  retrieval snapshot correctness.
- **MCP integration:** connect with the official SDK client to `/mcp/model`; exercise
  every tool this session ships; assert stateless JSON transport works for two
  interleaved clients; assert a validation failure surfaces all offending fields in one
  message string.

## Definition of done

Schema studio operations of the frontend (types + properties tabs) work against the TS
server as a smoke test. All tests green, sessions 01 regression green. Overview updated.
