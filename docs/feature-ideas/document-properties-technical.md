# Document Properties — Technical Design

> Implementation companion to [document-properties.md](document-properties.md).

## Data Type

`DataType` gains `DOCUMENT = "document"` (`core/schemas.py`, mirrored in `frontend/src/api/types.ts`). Runtime coercion treats the value as `str`. `defaultValue` behaves like `string`. Property definitions need no new fields.

Document property **values** must be excluded from:

- `build_text_repr` (`runtime/embedding.py`) — never part of the entity embedding
- `validate_vector_indexed_properties` (`core/database.py`) — the 32,766-byte limit applies to in-index metadata only; document values are not indexed
- all entity read payloads (see Read Model)

## Chunk Storage Model

Created only when an embedding provider is configured, synchronously in the entity write request.

**Node:** `(:_Chunk:{VirtualLabel})` where `VirtualLabel = Pascal(entityTypeKey) + "Document" + Pascal(propertyKey)` — e.g. `PersonDocumentBio`. Virtual type key (internal naming): `{entity_type_key}_document_{property_key}`.

| Property | Type | Notes |
|----------|------|-------|
| `_id` | String (UUID) | Chunk id |
| `_entityId` | String | Owning entity `_id` (denormalized for direct index→entity resolution) |
| `_entityTypeKey` | String | Owning entity type key |
| `_propertyKey` | String | Owning document property key |
| `_index` | Integer | Chunk ordinal (internal only — never exposed in the API) |
| `startChar` | Integer | Character offset of the chunk in the document |
| `charLength` | Integer | Character length of the chunk |
| `text` | String | The chunk content |
| `_embedding` | List of Float | Chunk vector |

**Relationship:** `(entity:_Entity)-[:_HAS_CHUNK]->(chunk:_Chunk)`.

**Lifecycle:**

- Entity create/update with a document property → delete that property's existing chunks → re-chunk → embed (batched where the provider supports it) → write chunk nodes. Updating property A never touches property B's chunks.
- Entity delete → existing `DETACH DELETE` removes chunks' relationships; chunk nodes are deleted explicitly in the same query (`OPTIONAL MATCH (n)-[:_HAS_CHUNK]->(c) DETACH DELETE c, n`).
- Property definition deleted (modeling) → drop all chunks of that virtual type and its vector index.
- Entity type deleted → same cascade for all its document properties.
- Embedding provider not configured → no chunks, no indexes; the type remains a fully functional long-text property.

## Chunking Strategy

Simple fixed-size character chunking with overlap:

- Defaults: size 1500, overlap 200. New `Settings` fields `DOCUMENT_CHUNK_SIZE`, `DOCUMENT_CHUNK_OVERLAP` (env-overridable, alongside `EMBEDDING_*`).
- Split preferentially at paragraph (`\n\n`), then sentence, then whitespace boundaries near the target size; hard split only as a last resort. No Markdown parsing.
- Each chunk records its exact `startChar`/`charLength` in the original document.

## Vector Indexes

One index per virtual type: name `{entity_type_key}_document_{property_key}_embedding`, on label `{VirtualLabel}`, property `_embedding`, cosine, provider dimensions — following the existing `{key}_embedding` per-type pattern in `core/database.py`.

- Ensured on startup (`ensure_vector_indexes`) for every existing document property, and created immediately when a document property is added via the modeling API.
- Dropped when the property (or owning entity type) is deleted.
- There is **no** cross-type chunk index (no analog to `entity_embedding` on `_Entity`); cross-type document search queries the in-scope virtual indexes and merges by score — chunk scores are mutually comparable.
- Rebuild-embeddings always rebuilds both entity embeddings and chunks (delete all chunks, re-chunk, re-embed, recreate indexes as needed).

## Read Model (Stubs)

Document properties never appear inline in entity payloads. Everywhere an entity's properties are returned — list, detail, neighbors, semantic search hits, saved-query results, Cypher query results, MCP tools — a document property is replaced by a stub:

```json
"bio": { "document": true, "length": 40213 }
```

`length` is the character count (maintained cheaply: computed at write time and stored as an internal `_doc_{key}_length` property on the entity node, or computed on read — implementer's choice; prefer stored to avoid loading the value).
The `fields` projection parameter may still request the raw value explicitly.

## Document Read Endpoint

```
GET /api/runtime/{ontologyKey}/entities/{entityType}/{entityId}/documents/{propertyKey}?offset=0&limit=5000
```

- `offset`, `limit` are character-based; both optional; no params → full document.
- Response: `{ "propertyKey": "bio", "content": "...", "offset": 0, "length": 5000, "totalLength": 40213 }` (`length` = actual returned length).
- 404 if the property is not a document property or the entity/type is unknown; scoping rules apply (property must be in the ontology lens).
- Read-only; writes remain full-value via normal entity create/update.

## Semantic Search

`GET /search/semantic` (and the MCP `semantic_search` tool):

**New parameters:** `searchIn=entities|documents|all` (default `all`), `snippets` (bool, default `true`).

**Flow (`all`):**

1. Embed the query once.
2. *Entity ranking* — existing path, unchanged.
3. *Document ranking* — query each in-scope virtual index; merge chunk hits by raw score; dedupe to parent entities (best chunk per entity wins and provides `matchedVia`).
4. *Fusion* — Reciprocal Rank Fusion over the two rankings: `score = Σ 1/(60 + rank)`; sort; apply `limit`.

`searchIn=entities` is byte-for-byte the existing behavior; `documents` skips steps 2 and 4.

**Hit shape:**

```json
{
  "entity": { "...": "properties with document stubs" },
  "score": 0.0164,
  "matchedVia": {
    "source": "document",
    "propertyKey": "bio",
    "charOffset": 5200,
    "charLength": 1500,
    "snippet": "first ~200 chars of the winning chunk…",
    "similarity": 0.87
  }
}
```

- `matchedVia` is present on every hit. Entity-embedding hits carry only `{ "source": "entity", "similarity": … }`.
- When an entity appears in **both** rankings, the document `matchedVia` wins regardless of which similarity is higher — it carries the retrieval coordinates, which are the more actionable information. The entity-side similarity is not surfaced for that hit.
- `score` is the RRF fusion score (ordering only); `similarity` is the raw cosine of the winning vector (thresholdable).
- `snippet` is truncated to ~200 chars; omitted entirely when `snippets=false`. `charOffset`/`charLength` always identify the exact chunk for retrieval via the document endpoint.
- No `chunkIndex` in the API — character coordinates are the retrieval contract.

**Scoping:** only virtual indexes whose (entity type, property) are included in the ontology lens are queried. A lens excluding `bio` from `person` never touches `PersonDocumentBio`.

## Cypher Validator

`runtime/cypher.py`: add `_Chunk` label and `_HAS_CHUNK` relationship to the explicit internal blocklist (same treatment as `_Entity`) for clean error messages; virtual labels are already rejected as unknown types. Document properties remain valid property references in queries (e.g. `WHERE p.bio IS NOT NULL`), but result post-processing replaces document values with stubs.

## MCP

**Modeling server:** `add_property` accepts `data_type="document"` (enum only — no new tool). Tool descriptions document the type: "large text, interpreted as Markdown; chunked for semantic search when embeddings are enabled."

**Runtime server:**

| Tool | Change |
|------|--------|
| `get_document` | **New.** Args `entity_type`, `entity_id`, `property_key`, optional `offset`, `limit`. Mirrors the REST endpoint. |
| `semantic_search` | Gains `search_in`, `snippets`; returns the new hit shape. |
| `list_entities` / `get_entity` / `get_neighbors` / `cypher_query` / saved queries | Return document stubs automatically via the shared service layer. |

## Export / Import

- Document property **definitions** export like any property (dataType `document`); document **values** export with entity instance data as plain strings.
- Chunk nodes are derived data: **never exported**. After import, chunks are regenerated the same way the importer already handles entity embeddings (or via rebuild-embeddings).

## Frontend

- `DATA_TYPES` (`studio/lib.ts`): add **Document** with the description above.
- Tables (`CellValue`): document stubs render as a compact badge (e.g. `📄 47 KB`), never content.
- Entity detail (`PropertiesCard`): document properties get a collapsed section; expanding fetches via the document endpoint and renders Markdown (**react-markdown + remark-gfm**, no raw HTML).
- Editing (`PropertyField`/`TypedValueInput`): large editor with Write (monospace textarea) and Preview tabs; opening loads the full document; saving sends the full value through the normal update.
- Search UI: hits show a "matched in {property}" badge plus the snippet; opening jumps to the entity's document section.

## Config Summary

| Env var | Default | Purpose |
|---------|---------|---------|
| `DOCUMENT_CHUNK_SIZE` | `1500` | Target chunk size (characters) |
| `DOCUMENT_CHUNK_OVERLAP` | `200` | Overlap between consecutive chunks (characters) |
