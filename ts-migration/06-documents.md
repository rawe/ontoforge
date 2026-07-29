# Session 06 — Documents

**Goal:** the document capability: slice reads, the two partial-write operations, and the
chunker — fully working without an embedding provider (chunk *embedding* activates in 08).

**Prerequisites:** 01–05.

**Normative:** `docs/capabilities/documents.md` (entire document — stub model, slice
read, both partial writes, chunking algorithm, chunk lifecycle),
`docs/interfaces.md` (document routes; `edit_document` / `write_document` tool split),
`docs/storage-adapters.md` ("Document chunk management", "Document-property cleanup").

**Reference (Python):** `runtime/chunking.py` (the algorithm — port it faithfully),
`runtime/service.py` (document read/edit portions and chunk sync),
`runtime/router.py`, `runtime/schemas.py` (operation discriminator),
`adapters/neo4j/runtime_queries.py` (chunk ops), `mcp/runtime.py` (three document tools).

## Scope

**In:**
- `GET .../documents/{propertyKey}`: character-based `offset`/`limit` slicing with the
  forgiving rules (past-end offset → empty content; over-long limit truncated; unset
  value reads as empty document); response reports propertyKey, content, offset,
  returned length, and total length. Not-found conditions: missing entity/type,
  property hidden by the lens, property not a `document`.
- `PATCH .../documents/{propertyKey}` with the operation discriminator in the body
  (copy the discriminator field name and both operation shapes from
  `runtime/schemas.py`):
  - **Exact string replacement** — fails on empty old string, missing/identical new
    string, zero occurrences, and **more than one occurrence unless replace-all is
    opted into**. Ambiguity is a failure, not a coin flip.
  - **Range overwrite** — length 0 inserts, offset == total appends; negative numbers,
    offset past end, or range past end fail; the optional expected-string guard mismatch
    is a **409 conflict** (the only compare-and-swap in the runtime).
  - Both answer with new total length, written region (first occurrence when
    replace-all), replacement count, and ~200 chars of context with its offset.
  - Both persist the whole new value, update length bookkeeping, and re-synchronize
    chunks (gated on provider — a no-op this session, live in 08).
- **Chunker** as a pure, exhaustively unit-tested module: walk from the start; boundary
  searched backwards from target end — paragraph break, then sentence end
  (./?/! + space or newline), then any whitespace, then hard cut; cut after the
  separator; backwards search never passes the chunk midpoint; next chunk starts
  `overlap` before the previous end, always advancing ≥1 char; empty text → no chunks;
  short text → one chunk. Config: `DOCUMENT_CHUNK_SIZE` / `DOCUMENT_CHUNK_OVERLAP`
  (overlap < size enforced).
- Chunk store ops: read text→vector map, delete-all for one (entity, property), batch
  create, per-property isolation. Chunk deletion wiring: value nulled/emptied, entity
  deleted (04's delete already reserves this), property definition deleted, entity type
  deleted (wire into the modeling deletion paths from 02).
- MCP tools: `get_document`, `edit_document`, `write_document` (REST folds both writes
  into one route; MCP splits them — same service functions).

**Out:** chunk vectors, the chunk vector index, passage search (08).

## Key behaviors and traps

- Stubs everywhere an entity is returned; unset document property is **absent**, not a
  zero stub. `fields` naming the property returns raw content (already built in 04 —
  extend tests here).
- Offsets and lengths are **character** counts, not bytes. Use code-unit semantics
  identical to Python's `str` indexing — beware: Python counts Unicode code points,
  JS strings are UTF-16 code units. Astral-plane characters (emoji) would diverge.
  Match Python (code points) — document reads/writes must slice by code point; add an
  explicit test with an emoji-bearing document.
- Whole-value writes through ordinary entity create/update remain valid and also re-sync
  chunks and bookkeeping.

## Test plan

Port `backend/tests/runtime/test_chunking.py`, `test_documents.py`,
`test_document_edits.py`, `backend/tests/modeling/test_document_properties.py`:

- **Unit (chunker):** every boundary class, midpoint rule, overlap advance, empty/short
  inputs, determinism; property-based test comparing reassembled offsets/lengths against
  the source text.
- **Unit (edits):** every failure mode of both operations; context window shape;
  replace-all region reporting; code-point slicing with emoji.
- **Integration:** slice paging round-trip; edit → read-back; guard conflict; chunk rows
  created/deleted per lifecycle event (verify directly in the store; vectors absent).
- **MCP:** all three tools.

## Definition of done

Frontend document badge/expand/edit flows work against the TS server. All tests +
regression green. Overview updated.
