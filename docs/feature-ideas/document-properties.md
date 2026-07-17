# Document Properties

> A new `document` data type for large text content (interpreted as Markdown), with chunked embeddings for precise semantic retrieval — without ever bloating entity reads or LLM context windows.

## Purpose

Entities often need one large free-text field — a biography, a specification, meeting notes — where a complete Markdown file belongs. A plain `string` property fails for this in three ways:

1. **Embedding quality.** Today an entity gets a single `_embedding` built from all its string properties concatenated (`build_text_repr`, truncated at 30,000 chars). A large document drowns out the other properties and one vector for a long document retrieves poorly.
2. **Payload size.** Every entity read (lists, search hits, MCP tools) would carry the full document — filling up the context window of any LLM consuming the API.
3. **Retrieval granularity.** Semantic search should detect *the entity that is meant* from a passage-level match, and let the caller read exactly the matching part of the document — not force a full-document fetch.

The `document` type solves all three: the value is stored as a normal property on the entity node, but it is **excluded from the entity's own embedding**, **never returned inline in reads**, and — when semantic search is enabled — **chunked with overlap into hidden virtual chunk nodes**, each with its own embedding, so retrieval resolves passages back to the owning entity.

## Example

A `person` entity type has scalar properties (`name`, `role`) plus two document properties: `bio` and `notes`.

- Creating a person with a 40 KB Markdown bio stores the text on the node and (with embeddings enabled) writes chunk nodes labeled `PersonDocumentBio`, each ~1,500 chars with 200 chars overlap, each with its own vector.
- `GET /entities/person` returns `"bio": { "document": true, "length": 40213 }` — a stub, never the content.
- `GET /search/semantic?q=analytical engines` finds the person via a bio chunk and returns `matchedVia` with the property key, character coordinates, similarity, and a ~200-char snippet.
- `GET /entities/person/{id}/documents/bio?offset=5200&limit=1500` returns exactly the matched passage.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Type name | `document` — "large text content, interpreted as Markdown" |
| Storage | Inline on the entity node as a normal property (no size-indexing; Neo4j handles large strings) |
| Entity embedding | Document properties are excluded from `build_text_repr` |
| Chunking | Only when an embedding provider is configured; simple fixed-size character chunking with overlap; synchronous on write |
| Chunk config | Global env defaults (`DOCUMENT_CHUNK_SIZE=1500`, `DOCUMENT_CHUNK_OVERLAP=200`) — no per-property config |
| Virtual types | One hidden virtual type per (entity type, document property): label = EntityType + `Document` + PropertyName (e.g. `PersonDocumentBio`), one vector index each. The `Document` segment keeps the scheme extensible for future virtualized property types. |
| Visibility | Chunk nodes are internal: hidden from the schema API, rejected by the Cypher validator, never exported |
| Reads | Document properties appear as `{ "document": true, "length": N }` stubs in **all** entity reads (list, detail, search, Cypher results, MCP) |
| Document access | Dedicated read endpoint with character-based `offset`/`limit` slicing; no params = full document |
| Search | Single `GET /search/semantic` endpoint; chunk hits resolved to parent entities and fused with entity-embedding hits via Reciprocal Rank Fusion; `searchIn=entities|documents|all` (default `all`) |
| Match transparency | Every hit carries `matchedVia` (source, property key, `charOffset`/`charLength`, raw similarity, ~200-char snippet; `snippets=false` drops snippets) |
| Multiple document properties | Fully supported — each gets its own virtual type and index; dedupe keeps one hit per entity (best chunk wins) |
| Rebuild | The rebuild-embeddings operation always rebuilds both entity embeddings and document chunks |

## Out of Scope

- **Migration / backwards compatibility** — explicitly not required.
- **Partial writes** — documents are written whole via normal entity create/update; slicing is read-only.
- **Markdown-aware chunking** — chunking prefers paragraph/sentence boundaries near the target size but does not parse Markdown structure.
- **Rich Markdown editor** — the frontend uses a plain textarea with a rendered preview tab.

See [document-properties-technical.md](document-properties-technical.md) for the implementation design.
