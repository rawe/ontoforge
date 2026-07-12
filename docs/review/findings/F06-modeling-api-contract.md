# F06 — modeling-api.md Documents an API That No Longer Exists

> **Severity: High** · **Effort: Medium** · **Type: Documentation rewrite**

## Finding

`docs/api-contracts/modeling-api.md` is the stalest document in the repo — it still specifies the
pre-lens, nested, UUID-addressed API:

| Contract says | Code (`modeling/router.py`, `modeling/schemas.py`) |
|---|---|
| `/api/model/ontologies/{id}/entity-types` (nested) | `/api/model/entity-types` (global) |
| `sourceEntityTypeId` / `targetEntityTypeId` (UUIDs) | `sourceEntityTypeKey` / `targetEntityTypeKey` |
| Per-ontology export `GET /ontologies/{id}/export`, `overwrite` param on import | Global `GET /export`, `POST /import` without `overwrite` |
| DELETE ontology cascades to its entity/relation types | Types are global; only scope edges, agents, saved queries are removed |
| SavedQuery upsert takes a single `cypher` string, format v2.1 | `steps` pipeline (cypher / semantic_search), format v2.2 |
| Type keys "unique within ontology" | Globally unique |
| — (missing) | Scope management endpoints (`/ontologies/{id}/includes/...`), `POST /schema/validate` |

The frontend (`api/client.ts`) already talks to the *real* API — so the contract is wrong for
every consumer that trusts it, most notably external integrators and AI coding sessions.

## Proposed Correction

Rewrite `modeling-api.md` from the actual router as the single authoritative modeling contract:

- Global schema resources (`/entity-types`, `/relation-types`, nested `/properties`), key-based
  relation endpoints, `cascade` query params and their semantics.
- Ontology resources incl. scope management (`includes/entity-types|relation-types`).
- Note the addressing convention honestly: ontology CRUD by `{ontologyId}`, AI agents and saved
  queries by `{ontologyKey}` — or, better, decide to unify addressing first (small API change,
  needs a user decision; if unified, prefer the key, which is what MCP and runtime use).
- Saved queries with the `steps` pipeline model; export/import with `formatVersion` 2.2.

Generating the endpoint list from the live OpenAPI spec (`/docs`) and then editing it into the
contract format is the cheapest way to guarantee completeness.

## Dependencies

- After F08 (architecture.md fixes the storage/format facts the contract references).
- The UUID-vs-key unification question is an API design decision → needs user approval before the
  rewrite settles it (CLAUDE.md rule).

## Acceptance

- Every endpoint in `modeling/router.py` appears in the contract with matching paths, params and
  DTO field names; no removed endpoint remains documented.
