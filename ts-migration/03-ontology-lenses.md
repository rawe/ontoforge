# Session 03 — Ontology lenses, inclusions, cascade protocol, validation

**Goal:** lenses become real: ontology CRUD, scope inclusions, the cascade protocol, and
the two validation operations — over REST and MCP.

**Prerequisites:** 01–02.

**Normative:** `docs/capabilities/ontology-lenses.md` (the whole document — the scoping
matrix is the most consequential table in the system),
`docs/capabilities/schema-modeling.md#the-cascade-protocol` and `#schema-validation`,
`docs/interfaces.md` (ontology + inclusion routes; note the id-vs-key asymmetry and that
inclusions are added by **key in the body** but updated/removed by **id in the path**),
`docs/storage-adapters.md` ("Scope inclusion management" — the four cascade-support ops).

**Reference (Python):** `modeling/service.py` (ontology, inclusion, cascade, validation
portions), `modeling/router.py`, `adapters/neo4j/modeling_store.py` (inclusion ops),
`mcp/modeling.py` (ontology/inclusion/validation tools).

## Scope

**In:**
- REST: ontologies CRUD by internal id (key immutable, pattern `^[a-z][a-z0-9_]*$`, key
  AND name globally unique), `POST /ontologies/{id}/validate`, `POST /schema/validate`,
  the eight inclusion routes (both dimensions).
- Inclusion semantics: at most one per (lens, type); **adding again is an upsert**, not a
  conflict; allowlist absent ≠ allowlist empty (the store must preserve the distinction);
  the four inclusion rules from `docs/capabilities/ontology-lenses.md#inclusions`,
  including the deliberately preserved ordering hazard (relation-endpoint check applies
  only "when the lens already has entity inclusions").
- Cascade protocol, complete: the three triggers, `CASCADE_REQUIRED` (409) with sorted
  lens **keys** in `details.affectedOntologies`, the four mechanical repairs (including
  property-delete allowlist cleanup, which is cleanup-not-consent — deleting a property
  never triggers the protocol). Changing an existing property is **never** checked —
  preserve that gap.
- Validation operations: always answer 200 with `{valid, errors[]}` (dotted-path +
  message shape from the Python service); unscoped lens valid by definition; global
  half checks the four conditions listed in the docs.
- Adapter: ontology management (read by id, by key, by name — all three), inclusion
  lifecycle, and the four cascade-support operations (remove-inclusions-for-type across
  lenses; lens keys including a type; lens keys whose allowlist names a property
  explicitly; add/remove a property key across all explicit allowlists).
- MCP tools: `create_ontology`, `update_ontology`, `delete_ontology`,
  `add_entity_type_to_ontology`, `remove_entity_type_from_ontology`,
  `add_relation_type_to_ontology`, `remove_relation_type_from_ontology`,
  `validate_ontology`, `validate_schema`. No update-inclusion tool — re-adding is the
  MCP way to change an allowlist. Cascade flags on the modeling tools from session 02
  now actually work.

**Out:** the runtime consumption of lenses (04); agents and saved queries (09).

## Key behaviors and traps

- **Allowlist must contain every required-no-default property** of the type — checked on
  add and update, re-checked by validation, and it is the reason cascade trigger #3
  exists.
- Only lenses **with an explicit allowlist** for the owning type appear in trigger #3;
  no-allowlist inclusions track the schema automatically and are never affected.
- Lens deletion is always permitted, cascades to nothing but its own (future) agents and
  saved queries, and needs no consent.
- MCP cascade refusals carry only the message — the structured
  `affectedOntologies` list is REST-only (`docs/capabilities/schema-modeling.md`,
  "Through the interfaces").
- The scoping matrix itself is *defined* here but *consumed* in session 04 — this session
  only stores declarations; do not build lens assembly yet.

## Test plan

Port `backend/tests/modeling/test_ontologies.py`, `test_scope_management.py`,
`test_schema_operations.py` (validation parts), and the matching MCP tests:

- **Unit:** upsert-on-re-add; absent-vs-empty allowlist round-trip; the four inclusion
  rules incl. the ordering hazard (relation inclusion accepted before any entity
  inclusions, then entity inclusions added → validation reports invalid, runtime rules
  untested here); every cascade trigger and repair; property-delete cleanup without
  refusal; `affectedOntologies` sorted keys; name-conflict vs key-conflict detection.
- **Integration:** cascade end-to-end (scoped lens + delete type without/with cascade);
  schema validation catches a relation type with a missing endpoint seeded directly in
  the store.
- **MCP:** validate tools; add-again-to-change-allowlist flow.

## Definition of done

Frontend schema studio's ontology/scope screens work against the TS server. All tests
green incl. 01–02 regression. Overview updated.
