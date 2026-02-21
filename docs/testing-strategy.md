# Multi-Agent Testing Strategy

> Reusable strategy for test-and-bugfix cycles using agent teams.
> Designed for sequential execution with clear role separation.

## Agent Roles

| Role | Responsibility | Tools | Does NOT |
|------|---------------|-------|----------|
| **Team Lead** | Coordinates flow, relays context between agents, spawns/assigns agents, wipes DB, restarts services | SendMessage, TaskCreate/Update, Bash (infra only) | Write code, run tests |
| **Tester** (one per layer) | Executes test plan, reports PASS/FAIL with details, stands by for re-test | curl (backend) or Chrome extension (frontend) | Fix bugs, touch code |
| **Dev Agent** | Fixes bugs reported by team lead, adds regression unit tests, runs unit test suite | Code editing, `uv run pytest` | Run integration/E2E tests, commit |

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
- **Server must reflect latest code.** After dev fixes, verify the server has reloaded (use `--reload` flag or restart manually) before re-testing.

## Fresh State Protocol

Before every test run, the team lead executes:

```bash
# 1. Wipe model DB
curl -s -X POST http://localhost:7474/db/neo4j/tx/commit \
  -H "Content-Type: application/json" \
  -u neo4j:ontoforge_dev \
  -d '{"statements":[{"statement":"MATCH (n) DETACH DELETE n"}]}'

# 2. Verify server is up and running latest code
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/docs
# Expect: 200
```

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
- Full pytest output (pass/fail count)

## Backend Test Plan (curl)

Sequential test groups — each group depends on data from previous groups:

1. **Ontology CRUD** — create, duplicate (409), list, get, get-missing (404), update, update-missing (404)
2. **Entity Type CRUD** — create, duplicate key (409), create second, list, get, update
3. **Relation Type CRUD** — create with source/target, duplicate key (409), invalid refs (422), list, get, update
4. **Entity Type Properties** — create, duplicate key (409), list, update, delete, verify empty
5. **Relation Type Properties** — create, list, update, delete
6. **Referential Integrity** — delete entity type referenced by relation type (409)
7. **Schema Validation** — validate endpoint, expect valid
8. **Export** — export JSON, verify structure
9. **Import** — import with new ID (201), duplicate without overwrite (409), with overwrite (201), name conflict with different ID (409)
10. **Cascade Delete** — delete relation type, delete entity type, delete ontology, verify gone (404)

## Frontend Test Plan (Chrome Extension)

Sequential UI flows — each step builds on the previous:

1. **Ontology list page** — loads, shows empty state or list
2. **Create ontology** — fill form, submit, appears in list
3. **Ontology detail** — click into ontology, detail page loads
4. **Create entity type** — add entity type, appears in list
5. **Entity type editor** — click in, editor loads
6. **Add property** — add to entity type, appears in table
7. **Create second entity type** — needed for relation type
8. **Create relation type** — select source/target, submit, appears
9. **Relation type editor** — click in, editor loads with properties
10. **Add relation type property** — add, verify
11. **Schema validation** — trigger, verify results display
12. **Schema export** — trigger, verify download
13. **Update ontology** — edit name/description
14. **Delete flows** — delete property, delete types, verify updates
15. **Error handling** — backend down, 409 conflicts, validation errors

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
