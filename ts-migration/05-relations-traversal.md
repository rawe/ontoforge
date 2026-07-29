# Session 05 — Relations and traversal

**Goal:** relation lifecycle and the neighbors operation, completing the instance-data
capability — REST and MCP.

**Prerequisites:** 01–04.

**Normative:** `docs/capabilities/instance-data.md` (relations, traversal, listing —
re-read the whole document), `docs/interfaces.md` (relation + neighbours route tables;
field-projection table rows for neighbours), `docs/architecture.md#instance-level`
(the endpoint-id naming exception), `docs/storage-adapters.md` ("Relation lifecycle",
"Traversal").

**Reference (Python):** `runtime/service.py` (relation + neighbor portions),
`runtime/router.py`, `adapters/neo4j/runtime_store.py`, `runtime_queries.py`,
`mcp/runtime.py` (relation + neighbor tools).

## Scope

**In:**
- REST: relations create/list/read/patch/delete. Creation validates both endpoints exist
  and their entity types equal the relation type's declared source/target — **checked
  against the full schema, not the lens** — with endpoint errors collected alongside
  property errors in one response. Same validation pipeline as entities otherwise.
- Endpoint immutability: update payloads carrying endpoint ids **silently ignore** them;
  properties in the same payload still apply.
- Reads return `fromEntityId` / `toEntityId` (no underscore — the documented exception);
  relation list/read take **no** `q` and **no** `fields`.
- Listing: same machinery as entities plus `fromEntityId` / `toEntityId` endpoint
  filters (either or both) — this is the only way to count/page one entity's relations.
- Neighbors: `direction` in/out/both (default both), optional `relationTypeKey`
  (unknown or out-of-scope key yields no neighbours, **not** an error), `limit` 1–200
  default 50 as a **single shared budget — outgoing first, incoming get the remainder**
  (preserve this trap exactly), no total, no offset. Relations whose type the lens does
  not expose are dropped with their neighbour. `fields` shapes centre and neighbour
  entities, `relationFields` the relations; always-returned system fields per the
  interfaces table (`direction` on each relation is computed, not stored). Preserve the
  documented leak: a neighbour whose own entity type is out of scope escapes property
  stripping (documents still stubbed).
- Entity delete now provably removes attached relations in both directions, including
  ones the lens cannot see.
- MCP tools: `create_relation`, `list_relations`, `get_relation`, `update_relation`,
  `delete_relation`, `get_neighbors`.

**Out:** OQL (07), search (08).

## Test plan

Port `backend/tests/runtime/test_relations.py`, `test_neighbors.py`, and relation/MCP
counterparts:

- **Unit:** endpoint type mismatch vs full schema through a narrow lens; collected
  endpoint + property errors; silent endpoint-ignore on update; endpoint filters;
  direction budget — entity with ≥limit outgoing edges returns zero incoming.
- **Integration:** relation CRUD round-trip; neighbors with mixed directions, type
  filter, both projections; lens-dropping of out-of-scope relation types; entity delete
  cascades relations cross-lens.
- **MCP:** neighbor and relation tool round-trips.

## Definition of done

Frontend graph explorer and relation editing work against the TS server. All tests +
regression green. Overview updated.
