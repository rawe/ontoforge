# F10 — Frontend Doc Drift and Two Small Frontend Gaps

> **Severity: Medium** · **Effort: Small–Medium** · **Type: Documentation update + small code fixes**

## Finding

**Doc drift.** `runtime-ui-architecture.md` describes an early three-route design; the shipped UI
is a strict superset (type index pages, data graph, three AI pages, agents page, saved-queries
page — 8 of 17 routes are undocumented). It also prescribes a hand-rolled context provider and a
hardcoded `http://localhost:8000` base URL, while the implementation uses TanStack React Query
and relative base paths. `architecture.md` §6.2 still says the runtime UI is deferred entirely.

**Code gaps found along the way:**

1. **`RuntimeSchema.ontology` type drops `ontologyId`** (`frontend/src/types/runtime.ts`). The
   API returns it, and `runtime-ui-architecture.md` §7 explicitly names it as required for
   runtime→modeling cross-linking. The narrowed type silently blocks that feature.
2. **The `/neighbors` endpoint is unused.** `DataGraphPage` reconstructs neighborhoods
   client-side via `listRelations` + `getEntity` fan-out. The backend's neighbor traversal —
   which also enforces scope filtering server-side — is dead surface for the UI, and the
   client-side reconstruction is O(relations) request fan-out on every expansion.
3. Documented-but-unused client surface: no frontend caller for `POST /{key}/query` (Cypher) or
   saved-query semantic search — fine as such, but worth an explicit "API-only surface" note so
   nobody assumes UI parity.

## Proposed Correction

- Update `runtime-ui-architecture.md` to the shipped route map, React Query data layer, and
  relative-URL client (or fold a condensed version into architecture.md §6 and retire the file —
  structure decision for the user, same discussion as F09).
- Add `ontologyId` to the `RuntimeSchema` type and wire the dashboard's cross-link to the
  modeling ontology page (small, self-contained).
- Switch `DataGraphPage` expansion to `GET .../entities/{type}/{id}/neighbors` — fewer requests,
  and scope filtering happens where it is enforced.

## Dependencies

- Doc part after F08. Code parts independent and small.

## Acceptance

- Route table in the doc matches `main.tsx`; data-graph expansion issues one request per node.
