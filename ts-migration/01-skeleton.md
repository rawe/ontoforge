# Session 01 — Skeleton, error model, storage foundation

**Goal:** a bootable TypeScript server with the full error contract, the persistence port,
the Neo4j adapter's foundation (lifecycle, constraints, error translation, reserved keys),
and the one lens-free route: `GET /api/runtime/features`.

**Prerequisites:** none. This is the first session.

**Normative:** `docs/architecture.md` (layers, error model, startup, configuration),
`docs/decisions.md` (storage rules), `docs/storage-adapters.md` Part 1 (port contract,
lifecycle, obligations: uniqueness, error translation) and Part 2 (index inventory,
naming transformations → reserved key sets).

**Reference (Python):** `backend/src/ontoforge_server/` — `config.py`, `main.py`,
`core/exceptions.py`, `core/ports.py`, `adapters/neo4j/__init__.py`, `driver.py`,
`errors.py`, `ddl.py` (only the unconditional constraints/indexes; vector-index DDL is
session 08), `runtime/router.py` (the `features` route only).

## Scope

**In:** project scaffold per the overview layout; config module (exact env names/defaults);
exception taxonomy (`NotFoundError`, `ConflictError`, `ValidationError` with `details`,
`CascadeRequiredError` with `affectedOntologies`, `StoreError` with generated 8-hex
`errorId`); Fastify app factory with CORS (allow-all, matching Python), OpenAPI at
`/openapi.json` + `/docs`, and error handlers producing the exact envelope
`{"error": {"code", "message", "details?"}}` for all six codes; persistence port (init /
close / wipe / ensure-semantic-indexes seam / store accessors, `DB_BACKEND` dispatch);
Neo4j adapter: driver lifecycle, the single error-translation choke point (translate
driver failures → `StoreError`, log original against `errorId`, let domain exceptions and
programming errors pass through), unconditional constraints and indexes from `ddl.py`,
`wipe`, the two reserved-key sets (derived from the naming transformations — see
`docs/storage-adapters.md` Part 2), `find_reserved_type_keys_in_use` + the startup
warning; startup ordering per `docs/architecture.md#startup` (later steps are no-op seams
this session); `GET /api/runtime/features` reporting both capabilities `false` (shape
copied from the Python route).

**Out:** everything else. No modeling routes, no MCP mounts (session 02), no embedding or
AI initialization beyond config plumbing.

## Key behaviors and traps

- **Error envelope everywhere.** Map Fastify's own request-validation failures and
  malformed-JSON bodies into the envelope: `400 INVALID_JSON` for an unparsable body,
  `422 VALIDATION_ERROR` for shape failures (approved divergence #3 in the overview —
  the Python server leaks FastAPI's `{"detail": ...}` shape there; docs win).
- **The choke point is narrow.** Over-catching is as wrong as under-catching: a domain
  exception raised inside a database scope keeps its identity; a TypeError is a bug and
  must look like one. See `docs/storage-adapters.md` ("Translating errors").
- Reserved keys are **derived, not copied**: entity-type set = keys whose PascalCase form
  is a schema node label; relation-type set = keys whose UPPER_SNAKE form is a schema
  relationship type. Write the derivation, then assert the resulting sets equal the six +
  six listed in the docs.
- Startup failure at any step prevents serving — no degraded boot.
- Temporals cross the port as JS `Date` (or ISO strings) — never `neo4j-driver` types.
  Establish the conversion helpers now; every later session uses them.

## Test plan

Port the relevant cases from `backend/tests/test_database.py`, `test_store_errors.py`,
and `tests/integration/test_store_errors.py`, plus:

- **Unit:** config defaults and env overrides; each exception maps to its exact
  status/code/envelope (drive a stub route that throws); `INVALID_JSON` on a malformed
  body; reserved-key sets match the documented twelve; `StoreError` carries an 8-hex id
  and no driver text.
- **Integration (Neo4j):** boot creates all constraints/indexes and is idempotent on
  second boot; `wipe` empties the store; `features` answers
  `{semanticSearch: false, ai: false}` (verify exact field names against the Python
  route); a stored type with a now-reserved key triggers the startup warning (seed one
  directly, boot, assert the log).

## Definition of done

`npm run dev` boots against docker-compose Neo4j and serves `/api/runtime/features`,
`/openapi.json`, `/docs`. All tests green. Overview status updated.
