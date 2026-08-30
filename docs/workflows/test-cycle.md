# Multi-Agent Testing Strategy

> Reusable strategy for test-and-bugfix cycles using one coordinating session and subagents.
> Designed for sequential execution with clear role separation.

## Agent Roles

| Role | Responsibility | Tools | Does NOT |
|------|---------------|-------|----------|
| **Team Lead** | Coordinates flow, relays context between agents, spawns subagents, wipes DB, restarts services | Agent (spawn), SendMessage (continue), Bash (infra only) | Write code, run tests |
| **Tester** (one per layer) | Executes test plan, reports PASS/FAIL with details, stands by for re-test | curl (backend) or Chrome extension (frontend) | Fix bugs, touch code |
| **Dev Agent** | Fixes bugs reported by team lead, adds regression unit tests, runs unit test suite | Code editing, `npm test` | Run integration/E2E tests, commit |

The team lead is the coordinating session; testers and dev agents are its subagents.
"Standby" means the subagent has reported and finished — the team lead continues the
same subagent via SendMessage, with its context intact, for fixes and re-tests.

## Execution Flow

```
1. Team Lead wipes DB clean
2. Team Lead spawns Tester → runs full test suite
3. Tester reports results → goes on standby
4. IF failures:
   a. Team Lead relays bug details + context to Dev Agent
   b. Dev Agent fixes bugs + adds unit tests → reports back
   c. Team Lead wipes DB clean again
   d. Team Lead tells Tester to re-run full suite from scratch
   e. Repeat from step 3 until all green
5. IF all green:
   a. Move to next layer (backend → frontend)
   b. Repeat from step 1 with the next Tester
6. When all layers pass → Team Lead compiles final report
```

## Sequentiality Rules

- **Never run testers in parallel.** Backend must fully pass before frontend testing starts.
- **Never run tester and dev agent on the same layer simultaneously.** Tester stands by while dev fixes.
- **Always start from a clean state.** Wipe the DB before every test run — no leftover data, no race conditions.
- **Server must reflect latest code.** After dev fixes, verify the server has reloaded (the dev server watches for changes; restart it manually if in doubt) before re-testing.

## Fresh State Protocol

All ontology-scoped state lives inside per-ontology `ont_*` PostgreSQL namespaces; the
registry (`public.ontology`) is the only stateful server-wide table. The wipe drops
every namespace and truncates the registry — leaving a server with zero ontologies,
which is a valid state the server serves from.

Before every test run, the team lead executes:

```bash
# 1. Wipe the database (PostgreSQL, the default): drop every ontology
#    namespace, then empty the registry
docker compose exec postgres psql -U postgres -d ontoforge -c \
  "DO \$\$ DECLARE ns text; BEGIN
     FOR ns IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ont\_%' LOOP
       EXECUTE format('DROP SCHEMA %I CASCADE', ns);
     END LOOP;
   END \$\$; TRUNCATE public.ontology"

# For a run flipped to Neo4j, wipe it instead with (deleting every node
# includes the internal registry node, returning the adapter to zero
# ontologies):
# curl -s -X POST http://localhost:7474/db/neo4j/tx/commit \
#   -H "Content-Type: application/json" \
#   -u neo4j:ontoforge_dev \
#   -d '{"statements":[{"statement":"MATCH (n) DETACH DELETE n"}]}'

# 2. Verify server is up and running latest code
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/docs
# Expect: 200

# 3. Verify zero ontologies
curl -s http://localhost:8000/api/ontologies
# Expect: []
```

Test runs then create their own ontologies through `POST /api/ontologies` — nothing is
auto-created, and modeling/runtime requests 404 until the ontology (and, for runtime,
the lens) exists.

## Handover Format

### Tester → Team Lead (test report)

```
## Test Report

### Summary: X/Y PASSED

### Results by Group:
1. Group Name: PASS/FAIL (n/m)
...

### Failures:
- [Group] Test: Expected X, got Y. Response body: ...

### Root-Cause Bugs:
- BUG N: title
  - File: path
  - Issue: description
  - Reproduction: steps
  - Expected vs actual
  - Suggested fix (optional)
```

### Team Lead → Dev Agent (bug assignment)

- Bug description with file path and line context
- Reproduction details from tester report
- Fix approach suggestion (dev agent decides final implementation)
- Explicit instruction: add regression unit test, run full suite, report back
- Explicit instruction: DO NOT commit

### Dev Agent → Team Lead (fix report)

- Files changed (list)
- New tests added (count and names)
- Full unit-test output (pass/fail count)

## Backend Test Plan (curl)

Sequential test groups — each group depends on data from previous groups. Registry
routes live at `/api/ontologies`; every modeling route below is under
`/api/ontologies/{ontologyKey}/model`, every runtime route under
`/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` (see
[../interfaces.md](../interfaces.md)).

1. **Registry CRUD** — create ontology (key + optional display name), duplicate key (409), duplicate display name (409), invalid/over-long key (422), list, get, get-missing (404), rename display name, rename-missing (404)
2. **Ontology scoping** — unknown ontology key on any modeling route (404); create a second ontology and give both the same entity type key (no conflict)
3. **Entity Type CRUD** — create, duplicate key within the ontology (409), create second, list, get, update
4. **Relation Type CRUD** — create with source/target, duplicate key (409), invalid refs (422), list, get, update
5. **Entity Type Properties** — create, duplicate key (409), list, update, delete, verify empty
6. **Relation Type Properties** — create, list, update, delete
7. **Referential Integrity** — delete entity type referenced by relation type (409)
8. **Lens CRUD** — create lens, duplicate lens key within the ontology (409), same lens key in the other ontology (no conflict), validate, update, delete
9. **Schema Validation** — validate endpoint, expect valid
10. **Export** — export JSON, verify structure: `formatVersion` "4.0", `lenses[]`, no ontology identity in the payload
11. **Import** — import into a bare second ontology (201, keys preserved), key conflict against a populated target (409, all-or-fail, target unchanged), unknown target ontology (404 — import never creates its target), 3.0-shaped payload with `ontologies[]` (422 by shape)
12. **Runtime isolation** — same type key in both ontologies: create entities in each, verify list/OQL through each lens returns only its own ontology's data
13. **Cascade Delete** — delete relation type, delete entity type, then `DELETE /api/ontologies/{key}` and verify the whole ontology is gone (404) while the other ontology is untouched; recreate under the same key works

## Frontend Test Plan (Chrome Extension)

The start page at `/` manages the ontologies; schema flows live in the Studio surface
(`/o/{ontologyKey}/studio`, `.../studio/lenses`); data flows live in the Workbench
(`/o/{ontologyKey}/w/{lensKey}`). See [../product-surface.md](../product-surface.md)
for the route map and the full capability inventory.

Sequential UI flows — each step builds on the previous:

1. **Start page, empty server** — `/` shows "No ontologies yet" with a create action; no redirect
2. **Create ontology** — fill key + display name, submit, land in the new ontology's Studio
3. **Create entity type** — add entity type, appears in the schema list
4. **Entity type editor** — click in, editor loads
5. **Add property** — add to entity type, appears in table
6. **Create second entity type** — needed for relation type
7. **Create relation type** — select source/target, submit, appears
8. **Relation type editor** — click in, editor loads with properties
9. **Add relation type property** — add, verify
10. **Schema validation** — trigger, verify results display
11. **Create lens** — Studio → Lenses, create, detail page loads
12. **Workbench entry** — open the lens from the start page card or the lens detail, create an entity through the schema-driven form
13. **Schema export** — trigger, verify download
14. **Start page cards** — card shows display name + key, lens links, Open Studio; Rename changes the display name only; both switchers' "Manage…" lead to `/`
15. **Second ontology isolation** — create a second ontology with the same type and lens keys; switch between them with the ontology switcher; verify disjoint data and per-ontology client state
16. **Delete flows** — delete property, delete types, delete lens; delete an ontology behind its confirmation, verify it is gone and the other survives
17. **Error handling** — backend down, 409 conflicts, validation errors, unknown lens address shows the not-found state

## Task List Template

| # | Task | Owner | Blocked By |
|---|------|-------|------------|
| 1 | Backend curl test — full suite | backend-tester | — |
| 2 | Frontend Chrome test — full suite | frontend-tester | 1 |
| 3 | Fix backend bugs + regression tests | backend-dev | 1 |
| 4 | Fix frontend bugs | frontend-dev | 2, 3 |
| 5 | Final test report summary | team-lead | 3, 4 |

## Key Principles

- **Testers never fix.** They report and stand by.
- **Dev agents never integration-test.** They fix, add unit tests, and report.
- **Team lead never writes code.** Coordinates, relays, manages infra.
- **Always re-test from scratch** after fixes. No incremental re-tests.
- **Never commit during testing.** Commits happen only after user approval when everything passes.
- **Concise reports.** Every handover is structured, scannable, actionable.
