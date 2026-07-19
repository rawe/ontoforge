# Frontend Architecture (UI v3)

Architecture of the OntoForge frontend in `frontend/`. Stack and dev commands: see `frontend/README.md`. API details: see `docs/api-contracts/`.

## 1. Surfaces

The app has two surfaces, each with its own shell (`WorkbenchLayout`, `StudioLayout`):

- **Workbench** — everything you do *through one ontology lens* against the runtime API. The sidebar carries an ontology switcher, fixed areas (Home, Explore, Query, AI), and a "Data" section listing the entity types of the active ontology's runtime schema.
- **Studio** — everything global: schema design (entity types, relation types, properties), ontology definitions and scoping, agents, saved queries, transfer (export/import, rebuild embeddings). Studio talks to the modeling API.

A global command palette (Cmd+K, `SearchPalette`) provides cross-type entity search (semantic when available), type-scoped search, saved-query search, and navigation actions. A global Quick Add dialog (shortcut `c`) creates entities from anywhere.

## 2. Route Map

Defined in `router.tsx`:

```
/                              → redirect: last-used ontology → /w/{key}, else /welcome
/welcome                       → ontology picker
/w/:ontologyKey                → Workbench Home (per-type counts, recent entities, quick actions)
/w/:ontologyKey/t/:typeKey     → type table (server-side pagination/sort/filter)
/w/:ontologyKey/e/:typeKey/:id → entity detail (inline property edit, relations)
/w/:ontologyKey/explore        → Explorer canvas (supports ?focus={typeKey}:{id})
/w/:ontologyKey/query          → query workbench (OQL console + saved-query library)
/w/:ontologyKey/ai             → AI assistant (Chat | Ask | Extract)
/studio                        → schema overview (type lists + diagram)
/studio/entity-types/:id       → entity type editor
/studio/relation-types/:id     → relation type editor
/studio/ontologies             → ontology list
/studio/ontologies/:id         → ontology detail (Scope | Agents | Saved Queries | Connect)
/studio/transfer               → export / import / rebuild embeddings
```

Workbench routes address everything by *key* (ontology key, type key) to mirror the runtime API paths; Studio routes use modeling UUIDs.

## 3. Schema-Driven Rendering

The Workbench renders no hand-written per-type UI. Everything derives from the runtime `/schema` response of the active ontology:

- `PropertyField` (`components/schema/`) renders one input per property `dataType` (string, integer, float, boolean, date, datetime) with required marker and field-error slot.
- `EntityForm` (`components/quickadd/`) composes `PropertyField`s from a type's property definitions: required-first ordering, per-dataType coercion, create mode skips empty optionals, edit mode sends only changed fields (explicit `null` clears an optional), and maps `ApiError` field details onto the form.
- `displayLabel` (`lib/displayLabel.ts`) picks a human label for an entity (`name` → `title` → `label` → `display_name` → first string property → truncated id). Used everywhere entities are shown.
- `typeColors` (`lib/typeColors.ts`) assigns each type a deterministic color from a curated palette (hash of the type key). Type chips, sidebar dots, table badges, and canvas nodes all use it — it is the app's visual signature.

Type tables, entity detail, quick add, extract review, and the Explorer node panels are all instances of these primitives, so any schema change is reflected without frontend changes.

## 4. Explorer: Working Set Instead of a Full Graph

The Explorer (`components/explore/`, React Flow + dagre) deliberately does not render "the whole graph". It maintains a **working set**: entities the user explicitly added (from the palette, tables, entity detail, or query results) plus neighbors expanded per relation type and direction. Layout is incremental — new batches are laid out near their source node, user drag positions are preserved, and re-layout is an explicit action. Nodes can be pinned, filtered by type, and connected by dragging (creating schema-valid relations). The working set (node ids, types, positions, pins) persists per ontology and is rehydrated on load, dropping entities that no longer exist. Caps guard against runaway growth (warn at 150 nodes, hard cap at 300).

## 5. API Layer and Server State

`src/api/` is the only place that talks to the backend:

- `http.ts` — fetch wrapper: JSON handling, the structured error envelope mapped to `ApiError` (status, code, message, details, plus helpers for field errors and cascade-affected ontologies), query-string builders for filters/field projection.
- `model.ts` / `runtime.ts` — one function per modeling / runtime endpoint.
- `types.ts` — wire types matching the API contract exactly.

**TanStack Query everywhere** — no ad-hoc effect fetching. The key scheme lives in `queryKeys.ts` (features, ontologies, per-ontology schema, entities/entity/neighbors/relations with params in the key, saved queries, agents, modeling sub-keys). Mutations invalidate precisely; schema and scope mutations invalidate all `['schema', …]` keys so every Workbench view refreshes. `['features']` is fetched once (staleTime Infinity).

**Feature gating** — `useFeatures()` exposes the backend's optional-feature flags (`semanticSearch`, `ai`). Gated areas (semantic search in the palette and pickers, the AI page) render explanatory placeholders rather than disappearing when a feature is off.

**Errors** — mutation errors surface as toasts with the API message; validation errors map to per-field form errors; `CASCADE_REQUIRED` conflicts open a confirm dialog listing affected ontologies and retry with cascade.

## 6. Client-Side Persistence

All persisted UI state lives in localStorage under `of.*` keys (`lib/storage.ts`):

| Key | Purpose |
|-----|---------|
| `of.lastOntology` | last-used ontology (drives the `/` redirect) |
| `of.theme` | theme (light/dark/system) |
| `of.sidebar` | sidebar expanded/collapsed |
| `of.explore.{ontologyKey}` | Explorer working set |
| `of.chat.{ontologyKey}` | AI chat history (capped) |
| `of.recents.{ontologyKey}` | recently opened entities (palette) |
| `of.queryHistory.{ontologyKey}` | recent OQL queries |

Everything else is server state (TanStack Query) or URL state — there is no global state library.
