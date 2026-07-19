# OKF Knowledge-Base Sync

> Move knowledge between Google's Open Knowledge Format (OKF) — Markdown files with YAML frontmatter — and OntoForge entities with a single `document` property. Built modularly: a pure md↔entity codec, a per-document push/pull primitive that needs no backend changes, and bundle-level sync composed on top. The generic core stays OKF-unaware.

**Status: Layers 1–2 implemented** as the `ontoforge-okf` plugin skill (see its [SKILL.md](../../plugins/ontoforge/skills/ontoforge-okf/SKILL.md) for usage). Layer 3 (bundle sync, link extraction) and the backend phases remain proposals; their open decisions below still require approval.

## Purpose

The [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) (OKF v0.1, Google Cloud, June 2026) represents knowledge as a bundle: a directory tree of Markdown files with YAML frontmatter, distributed via git. Coding agents such as Claude Code read and write these files natively in the filesystem.

The target workflow uses OntoForge as the graph-backed store for such a knowledge base and Claude Code as the editor/consumer:

1. **Push**: a locally maintained OKF bundle is imported into OntoForge in bulk.
2. **Pull**: the OntoForge data of an ontology is materialized as an OKF bundle on disk.
3. **Interactive work** continues through the existing runtime MCP tools.

The core inefficiency of doing this via MCP is not call count — it is that the **document content itself flows through the LLM**. To push an md file, the agent must read it and re-emit the full text as a tool-call argument; to write one, it must re-emit the property payload as file content. Even for a single document that is token-expensive and error-prone. The fundamental primitive needed is therefore a *per-document* transfer the agent triggers by path or ID — `push file.md`, `pull <conceptId>` — where the content moves directly between filesystem and API, bypassing the model's context. Bundle-level sync is then just composition over that primitive. The MCP interface remains the primary interactive surface; the file transfer path is a complementary mechanical tool, following the same pattern as the existing `ontoforge-sync` skill.

## OKF in one paragraph

Every non-reserved `.md` file in a bundle is a **concept**: a YAML frontmatter block plus a Markdown body. The only required frontmatter field is `type`; recommended fields are `title`, `description`, `resource`, `tags`, `timestamp`, and producers may add arbitrary extension keys (consumers should preserve unknown keys on round-trip). The **concept ID** is the file path without the `.md` suffix (e.g. `tables/users.md` → `tables/users`). Ordinary Markdown links between concepts assert untyped relationships; consumers must tolerate broken links. `index.md` (directory listing) and `log.md` (change history) are reserved filenames, not concepts.

## Mapping OKF ↔ OntoForge

| OKF | OntoForge |
|-----|-----------|
| Concept document (one `.md` file) | One entity |
| Frontmatter `type` | Entity type key (via a configurable mapping) |
| Markdown body | The entity type's single `document` property |
| Concept ID (path without `.md`) | A required string property acting as the **natural key** (e.g. `conceptId`) — also encodes the directory placement for export |
| Frontmatter `title`, `description`, `resource`, extension keys | Scalar properties on the entity type |
| Frontmatter `timestamp` | `datetime` property |
| Frontmatter `tags` (YAML list) | No list data type exists — open decision below |
| Markdown links between concepts | Relations, resolved by concept ID (see open decision on cross-type links) |
| `index.md`, `log.md` | Skipped on import; optionally generated on export |
| Bundle in git | The change history — OntoForge does not need to store sync state |

The `document` data type ([document-properties.md](document-properties.md)) is a near-perfect fit for the body: Markdown semantics, stub reads, chunked embeddings for passage-level semantic search. Exporters must request document values explicitly via `fields` projection, as `export-data.mjs` already does.

## Gap Analysis

What the generic core is missing for this to be efficient and idempotent:

1. **No bulk operations.** Runtime CRUD is per-entity/per-relation; importing a bundle of N concepts means N+ HTTP calls with no transactional grouping.
2. **No upsert / natural keys.** `POST /entities/{type}` always creates. Re-importing a bundle duplicates every entity. Idempotent sync requires create-or-update keyed on a caller-chosen property (the concept ID).
3. **Schema import requires a fresh database.** `POST /api/model/import` returns 409 if any key exists, so a bundle's types cannot be bootstrapped into an existing schema.
4. **No list data type.** `tags` has no faithful representation.
5. **Relation types have fixed endpoint types.** OKF links connect concepts of *any* two types; representing them needs either one relation type per encountered type pair or a schema-level escape hatch.
6. **Two existing, incompatible instance-data file formats** (the `ontoforge-sync` skill's `data.json` v1.0 and the `scripts/export_ontology.py` folder format). OKF would be a third; consolidation is worth considering.

## Proposed Architecture

**Recommendation: keep the core generic.** OKF interpretation ("entity = markdown document, frontmatter = properties") is a *convention*, not a core concept. The split:

- **Backend** gains small, generic enhancements only where scale demands them (bulk upsert, additive schema import). Nothing in the backend mentions OKF. The single-document primitive needs **no backend changes**.
- **A new plugin skill `ontoforge-okf`** (sibling of `ontoforge-sync`, zero-dependency Node scripts) implements the OKF mapping against the REST API. Claude Code invokes it as a single command; document content moves filesystem ↔ API without touching the model's context. MCP stays the interface for interactive queries and in-place edits.

An alternative — native `POST /api/runtime/{key}/okf/import` accepting an uploaded archive, plus a Studio Transfer-page UI — is heavier, bakes a third-party convention into the core, and doesn't fit the filesystem-centric workflow (the files live next to the agent, not next to the server). Rejected under KISS unless a no-local-tooling path becomes a requirement.

### Modular design — three layers

The skill is layered so each concern is usable and testable on its own:

**Layer 1 — Codec (pure mapping, no I/O).** A module that converts between the two representations of one concept:
- *decode*: md text → `{ frontmatter fields, body }` → an entity property payload (frontmatter keys → scalar properties per the mapping config, body → the document property, file path → `conceptId`).
- *encode*: entity payload → md text (properties → frontmatter in stable key order, document property → body, `conceptId` → file path).
- Owns all convention knowledge: reserved filenames, type mapping, unknown-key preservation, tag serialization. No HTTP, no filesystem — both directions are pure functions, which is what makes round-tripping verifiable.

**Layer 2 — Single-document transfer (the core primitive).** Two commands over the existing API, no backend changes:
- `okf-push.mjs <file.md> --ontology <key>` — decode the file, look up the entity by `conceptId` (one filtered `GET /entities/{type}` call), then `POST` (new) or `PATCH` (existing) the scalar properties and write the body through the entity payload's document property. Idempotent per file.
- `okf-pull.mjs <conceptId> --ontology <key>` (or `--all-into <dir>`) — fetch the entity with the document value via `fields` projection, encode, write the file.

This is the efficiency fix for the Claude Code workflow: the agent edits a file with its normal file tools, then runs one command; or materializes an entity as a file to read/edit it natively. Content never round-trips through tool-call arguments.

**Layer 3 — Bundle sync (composition).** `okf-import.mjs` / `okf-export.mjs` walk a tree and apply Layer 2 per file, adding the cross-document concerns: link extraction → relations, schema bootstrap, `index.md` generation, `--prune`. Phase 1 runs on per-item calls (O(N) requests — fine for hundreds of concepts); the Phase 2 bulk endpoints slot in under Layer 3 without touching Layers 1–2.

### Processes (Layer 3 detail)

**Import (bundle → OntoForge)** — `okf-import.mjs <bundle-dir> --ontology <key>`
1. Walk the tree, parse frontmatter, skip reserved files; derive concept IDs.
2. Optional schema bootstrap (`--bootstrap-schema`): for each unmapped `type` value and unknown frontmatter key, create entity types / properties via the modeling API (requires the additive schema import or per-item modeling calls).
3. Bulk-upsert entities keyed on `conceptId`: body → document property, frontmatter → properties.
4. Extract Markdown links from bodies, resolve targets by concept ID, bulk-upsert relations. Broken links are reported, never fatal (per spec).
5. `--prune` (default off) deletes entities whose concept ID is absent from the bundle.

**Export (OntoForge → bundle)** — `okf-export.mjs <out-dir> --ontology <key>`
1. Paginate entities (document values via `fields` projection); write each to `<conceptId>.md` with frontmatter serialized from properties (stable key order → clean git diffs).
2. Body links already round-trip inside the document text; relations without a body-link counterpart are the representation-gap decision below.
3. Optionally generate `index.md` per directory from `title`/`description`.

**Round-trip** is idempotency, not a sync engine: import is safe to repeat (upsert), export is deterministic, git is the history and conflict mechanism. No bidirectional merge logic — one direction per operation, chosen by the user.

### Backend enhancements (generic, ordered)

1. **Bulk upsert entities** — e.g. `POST /api/runtime/{key}/entities/{type}/bulk` with `{ items: [...], mergeOn: "<propertyKey>" }`; validates like `create_entity`, matches on `mergeOn`, creates or patches, returns per-item `{id, created|updated}`. Batched writes, embedding generation reusing the existing content-hash reuse path.
2. **Bulk upsert relations** — endpoints referenced by `{entityTypeKey, mergeOn value}` instead of internal IDs, with its own `mergeOn` (or from/type/to identity) for idempotency.
3. **Additive schema import** — `POST /api/model/import?mode=merge`: create missing types/properties, leave identical existing ones untouched, conflict only on genuine divergence. Independently valuable (removes the fresh-DB restriction that already constrains `ontoforge-sync`).

Phase 1 can ship without any backend change: the skill lists existing entities, builds a conceptId→id map client-side, and issues per-item POST/PATCH. Correct and idempotent, just O(N) requests — acceptable for hundreds of concepts, painful beyond. Phase 2 adds the bulk endpoints.

## Decisions

Settled (approved with the Layer 1–2 implementation):

1. **Architecture split** — generic backend + `ontoforge-okf` client skill. The backend stays OKF-unaware.
2. **Tags representation** — delimited string property (skill config `listProperties`/`listDelimiter`); a list `DataType` remains a possible follow-up if list querying becomes a need.

Open (gate Layer 3 / backend phases):
1. **Cross-type links** — (a) auto-created per-type-pair relation types (e.g. `references__note__table`; works today, clutters the schema), (b) relation types with unconstrained endpoints (schema-level feature, one clean `references` type), (c) store links only inside the document body and skip relation extraction entirely (KISS baseline; the graph loses link structure). Recommendation: (a) now, (b) as a follow-up feature if wanted — (c) forfeits the link graph, which is the point of a graph tool.
2. **Export of native relations** — relations created inside OntoForge have no source line in any document body. Append a generated section to the body on export, emit frontmatter extension keys, or leave them out of the bundle? Recommendation: leave out in v1; the bundle is a document-centric lens.
3. **Format consolidation** — should OKF supersede the `export_ontology.py` folder format (which it strongly resembles: one file per entity, slug filenames, relations by reference)? Recommendation: yes, deprecate the Python script once the skill exists.
4. **Bulk endpoint scope** — runtime-level generic bulk upsert as specified, or a narrower internal-only batch for the skill? Recommendation: generic — it also benefits `ontoforge-sync` and any future integration.

## Out of Scope

- Bidirectional merge/conflict resolution — git owns history and conflicts.
- Watching the filesystem / live sync.
- `log.md` generation and OKF citation conventions — pass-through only.
- Serving OntoForge data *as* an OKF HTTP endpoint.
