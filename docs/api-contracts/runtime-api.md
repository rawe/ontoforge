# Runtime API Contract

> Full contract for the runtime REST API.
> Base path: `/api/runtime/{ontologyKey}`
>
> All runtime endpoints are scoped to a specific ontology via the `ontologyKey` path parameter.
> The ontology key is the ontology's unique `key` field (snake_case, pattern: `^[a-z][a-z0-9_]*$`).
> The runtime module reads schema data from the same database as the modeling module.
>
> For the logical data model, see `architecture.md` §4.

---

## 2. Schema Introspection

Read-only access to the ontology schema. Served from the in-memory schema cache.

### GET /api/runtime/{ontologyKey}/schema

Return the full schema for the specified ontology.

**Response:** `200 OK`
```json
{
  "ontology": {
    "ontologyId": "abc-123",
    "name": "My Ontology",
    "key": "my_ontology",
    "description": "An example ontology"
  },
  "entityTypes": [
    {
      "key": "person",
      "displayName": "Person",
      "description": "A human being",
      "properties": [
        {
          "key": "name",
          "displayName": "Name",
          "description": null,
          "dataType": "string",
          "required": true,
          "defaultValue": null
        }
      ]
    }
  ],
  "relationTypes": [
    {
      "key": "works_for",
      "displayName": "Works For",
      "description": null,
      "fromEntityTypeKey": "person",
      "toEntityTypeKey": "company",
      "properties": []
    }
  ]
}
```

**Errors:** 404 if ontology key not found.

### GET /api/runtime/{ontologyKey}/schema/entity-types

Return the `entityTypes` array. Useful for MCP tools that need to enumerate available types.

**Response:** `200 OK` — array of entity type objects.

### GET /api/runtime/{ontologyKey}/schema/entity-types/{entityTypeKey}

Return a single entity type with its property definitions.

**Response:** `200 OK` — single entity type object.

**Errors:** 404 if entity type key not found.

### GET /api/runtime/{ontologyKey}/schema/relation-types

Return the `relationTypes` array.

**Response:** `200 OK` — array of relation type objects.

### GET /api/runtime/{ontologyKey}/schema/relation-types/{relationTypeKey}

Return a single relation type with its property definitions, including `fromEntityTypeKey` and `toEntityTypeKey`.

**Response:** `200 OK` — single relation type object.

**Errors:** 404 if relation type key not found.

---

## 3. Entity Instance CRUD

### POST /api/runtime/{ontologyKey}/entities/{entityTypeKey}

Create an entity instance.

**Request body:**
```json
{
  "name": "Alice",
  "age": 30
}
```

Properties are provided as a flat JSON object. Keys must match property definitions in the schema.

**Response:** `201 Created`
```json
{
  "_id": "b7e3f1a2-...",
  "_entityTypeKey": "person",
  "_createdAt": "2026-02-22T10:00:00Z",
  "_updatedAt": "2026-02-22T10:00:00Z",
  "name": "Alice",
  "age": 30
}
```

**Validation:**
- `entityTypeKey` must exist in the schema cache. → 404 if not found.
- All `required` properties must be present (or have a `defaultValue` in the schema). → 422 if missing.
- No unknown property keys (not defined in the schema). → 422 if unknown.
- Each value must be coercible to its schema `dataType`. → 422 if type mismatch.
- When semantic search is enabled, any string value that would exceed the indexed property size limit is rejected with 422 before the entity is written. Document properties are exempt — their values are never part of the semantic-index metadata.
- Default values are injected for required properties not in the request but with a `defaultValue` in the schema.
- Schema/type validation errors are collected and returned together where practical; semantic-index size validation may still reject the request with 422 before persistence.

### GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}

List entity instances of a type, with optional filtering, search, sorting, and pagination.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 50 | Page size (max 200) |
| `offset` | integer | 0 | Pagination offset |
| `sort` | string | `_createdAt` | Property key to sort by |
| `order` | string | `asc` | `asc` or `desc` |
| `q` | string | — | Text search across all string properties |
| `filter.{key}` | any | — | Exact match on property |
| `filter.{key}__{op}` | any | — | Operator match on property |
| `fields` | string[] | — | Property keys to include in response entities (repeatable). When provided, only `_id` plus listed fields are returned. When omitted, all properties are returned. Unknown keys are silently ignored. |

**Filter syntax:** All property filters use the `filter.` prefix to avoid namespace collisions with reserved parameters. Operator suffixes use double-underscore:

| Suffix | Meaning | Example |
|--------|---------|---------|
| (none) | equals | `filter.name=Alice` |
| `__gt` | greater than | `filter.age__gt=25` |
| `__gte` | greater than or equal | `filter.age__gte=25` |
| `__lt` | less than | `filter.age__lt=40` |
| `__lte` | less than or equal | `filter.age__lte=40` |
| `__contains` | substring match (case-insensitive) | `filter.name__contains=ali` |

**Text search (`q`):** Searches all `string` properties of the entity type using case-insensitive substring matching. `document` properties are not searched — use semantic search for document content. Simple substring matching, not full-text indexing. Sufficient for the MVP; full-text indexes can be added later without API changes.

**Sorting:** The `sort` parameter accepts any property key defined in the schema. System fields `createdAt` and `updatedAt` are also valid sort values (mapped to `_createdAt` and `_updatedAt` internally).

**Response:** `200 OK`
```json
{
  "items": [
    {
      "_id": "b7e3f1a2-...",
      "_entityTypeKey": "person",
      "_createdAt": "2026-02-22T10:00:00Z",
      "_updatedAt": "2026-02-22T10:00:00Z",
      "name": "Alice",
      "age": 30
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**Pagination:** Offset-based with `limit` and `offset`. The response includes `total` (count of all matching entities, ignoring pagination). Two queries are executed: count first, data second. If total is 0, the data query is skipped.

**Errors:** 404 if entity type key not found. 400 if filter parameter is neither a reserved name nor a schema property key.

### GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}

Get a single entity instance.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fields` | string[] | — | Property keys to include (repeatable). When provided, only `_id` plus listed fields are returned. When omitted, all properties are returned. Unknown keys are silently ignored. |

**Response:** `200 OK` — entity instance object (same shape as creation response).

**Errors:** 404 if entity type key or instance ID not found.

### PATCH /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}

Partial update of an entity instance. Only provided properties are updated; omitted properties are unchanged.

**Request body:**
```json
{
  "age": 31
}
```

**Null removal:** Setting a property to `null` unsets the property. This is the only way to unset an optional property. Setting a `required` property to `null` is rejected with 422.

**Response:** `200 OK` — full entity instance after update.

**Validation:** Same type and unknown-property checks as creation, applied only to the provided properties. When semantic search is enabled, the merged post-update entity must still fit the indexed property size limit for indexed string properties (document properties are exempt), or the update is rejected with 422.

**Errors:** 404 if not found. 422 if validation fails.

### DELETE /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}

Delete an entity instance. All relations connected to this entity are deleted with it, as is the entity's document chunk data.

**Response:** `204 No Content`

**Errors:** 404 if not found.

### Document Properties in Entity Reads

Properties with data type `document` (large Markdown text — see `architecture.md` §4.2) are never returned inline. In **every** entity payload — create/update responses, list, detail, neighbors, semantic search hits, query results, saved-query results, and the MCP tools — a set document property is replaced by a stub:

```json
"bio": { "document": true, "length": 40213 }
```

`length` is the character count of the full document. Unset document properties are simply absent, like any other unset property.

Two ways to get the content:

- The dedicated document read endpoint below (preferred — supports slicing).
- The `fields` projection parameter: explicitly listing a document property key in `fields` returns its raw value instead of the stub.

Document values can be **written** whole through normal entity create/update, or partially through the document edit endpoint below.

### GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}

Read a document property's content, optionally sliced by character range.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | integer | 0 | Character offset to start reading from (min 0) |
| `limit` | integer | — | Maximum number of characters to return (min 1). When omitted, reads to the end of the document |

Without parameters, the full document is returned. Slicing is plain character indexing — `offset` past the end yields empty content.

**Response:** `200 OK`
```json
{
  "propertyKey": "bio",
  "content": "…the requested slice…",
  "offset": 5200,
  "length": 1500,
  "totalLength": 40213
}
```

`length` is the actual number of characters returned (may be shorter than `limit` at the end of the document); `totalLength` is the full document's character count.

**Errors:** 404 if the entity type, entity ID, or property is not found, or if the property is not a `document` property. Ontology scoping applies — the property must be visible through the ontology lens.

### PATCH /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}

Apply one partial-write operation to a document property. The request body carries exactly one operation, selected by `op`:

**`str_replace`** — exact string replacement, the preferred operation for agents:

```json
{ "op": "str_replace", "oldString": "the old passage", "newString": "the new passage", "replaceAll": false }
```

`oldString` must occur in the document exactly once; if it occurs multiple times the edit is rejected (use a longer string with surrounding context, or set `replaceAll: true` to replace every occurrence). `oldString` must be non-empty and differ from `newString`.

**`replace_range`** — character-range overwrite:

```json
{ "op": "replace_range", "offset": 5200, "length": 1500, "content": "replacement text", "expect": "the text currently in the range" }
```

Replaces the characters `[offset, offset + length)` with `content`. Insert with `length: 0`; append with `offset` = `totalLength`. Offsets pair with the read endpoint and with the `charOffset`/`charLength` of semantic search hits. The optional `expect` field is a guard against stale offsets: when provided, the text currently in the range must equal it or the edit is rejected with 409.

**Response:** `200 OK`
```json
{
  "propertyKey": "bio",
  "totalLength": 40196,
  "editedRange": { "offset": 5200, "length": 1483 },
  "replacements": 1,
  "context": "…~200 chars before and after the edited range…",
  "contextOffset": 5000
}
```

`editedRange` locates the inserted text in the **new** document (for `replaceAll`, the first replacement). `context` returns the edited range plus up to 200 surrounding characters on each side, starting at `contextOffset` — enough to verify the edit without a follow-up read.

After a partial write the property's chunks are re-synced. Chunks whose text is unchanged keep their stored embeddings (content-hash reuse), so a small edit only re-embeds the chunks it touches — partial writes stay cheap even for large documents. The entity's own embedding is unaffected (document values are never part of it).

**Errors:** 404 as for the read endpoint. 422 if the operation is malformed, `oldString` is not found or not unique, or the range exceeds the document bounds. 409 if `expect` does not match the current range content.

---

## 4. Relation Instance CRUD

### POST /api/runtime/{ontologyKey}/relations/{relationTypeKey}

Create a relation instance between two entity instances.

**Request body:**
```json
{
  "fromEntityId": "b7e3f1a2-...",
  "toEntityId": "a1b2c3d4-...",
  "since": "2024-03-15"
}
```

`fromEntityId` and `toEntityId` are required. Properties are provided as additional flat fields.

**Response:** `201 Created`
```json
{
  "_id": "c4d5e6f7-...",
  "_relationTypeKey": "works_for",
  "_createdAt": "2026-02-22T10:00:00Z",
  "_updatedAt": "2026-02-22T10:00:00Z",
  "fromEntityId": "b7e3f1a2-...",
  "toEntityId": "a1b2c3d4-...",
  "since": "2024-03-15"
}
```

**Validation:**
- `relationTypeKey` must exist in the schema cache. → 404 if not found.
- `fromEntityId` must reference an existing entity instance whose `_entityTypeKey` matches the relation type's `fromEntityTypeKey`. → 422 if mismatch or not found.
- `toEntityId` must reference an existing entity instance whose `_entityTypeKey` matches the relation type's `toEntityTypeKey`. → 422 if mismatch or not found.
- Property validation identical to entity instances (required, unknown, type coercion).

### GET /api/runtime/{ontologyKey}/relations/{relationTypeKey}

List relation instances of a type, with optional filtering and pagination.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 50 | Page size (max 200) |
| `offset` | integer | 0 | Pagination offset |
| `sort` | string | `_createdAt` | Property key to sort by |
| `order` | string | `asc` | `asc` or `desc` |
| `fromEntityId` | string | — | Filter by source entity |
| `toEntityId` | string | — | Filter by target entity |
| `filter.{key}` | any | — | Property filter (same syntax as entities) |

**Response:** `200 OK`
```json
{
  "items": [
    {
      "_id": "c4d5e6f7-...",
      "_relationTypeKey": "works_for",
      "_createdAt": "2026-02-22T10:00:00Z",
      "_updatedAt": "2026-02-22T10:00:00Z",
      "fromEntityId": "b7e3f1a2-...",
      "toEntityId": "a1b2c3d4-...",
      "since": "2024-03-15"
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

### GET /api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}

Get a single relation instance.

**Response:** `200 OK` — relation instance object (same shape as creation response).

**Errors:** 404 if relation type key or instance ID not found.

### PATCH /api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}

Partial update of a relation instance. Same semantics as entity update (partial, null removal). Cannot change `fromEntityId` or `toEntityId` — delete and recreate instead.

**Request body:**
```json
{
  "since": "2025-06-01"
}
```

**Response:** `200 OK` — full relation instance after update.

### DELETE /api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}

Delete a relation instance. Only the relationship is removed; the connected entity instances are unaffected.

**Response:** `204 No Content`

**Errors:** 404 if not found.

---

## 5. Graph Traversal

### GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/neighbors

Get an entity's neighborhood — the connected entities and the relations between them.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `relationTypeKey` | string | — | Filter by relation type |
| `direction` | string | `both` | `outgoing`, `incoming`, or `both` |
| `limit` | integer | 50 | Max neighbors to return |
| `fields` | string[] | — | Property keys to include in entities (repeatable). Center entity gets `_id` plus listed fields. Neighbor entities get `_id`, `_entityTypeKey`, plus listed fields. When omitted, all properties are returned. |
| `relationFields` | string[] | — | Property keys to include in relations (repeatable). Relations always include `_id`, `_relationTypeKey`, and `direction`. When omitted, all properties are returned. |

**Response:** `200 OK`
```json
{
  "entity": {
    "_id": "b7e3f1a2-...",
    "_entityTypeKey": "person",
    "_createdAt": "2026-02-22T10:00:00Z",
    "_updatedAt": "2026-02-22T10:00:00Z",
    "name": "Alice",
    "age": 30
  },
  "neighbors": [
    {
      "relation": {
        "_id": "c4d5e6f7-...",
        "_relationTypeKey": "works_for",
        "direction": "outgoing",
        "since": "2024-03-15"
      },
      "entity": {
        "_id": "a1b2c3d4-...",
        "_entityTypeKey": "company",
        "name": "Acme Corp"
      }
    }
  ]
}
```

This is the primary exploration endpoint for MCP clients. Given an entity, discover what it is connected to. The `direction` parameter controls whether to follow outgoing, incoming, or all relationships.

**Errors:** 404 if entity type key or instance ID not found.

---

## 6. Semantic Search

### GET /api/runtime/{ontologyKey}/search/semantic

Search entity instances by natural language meaning using vector embeddings. Two rankings feed the results: **entity embeddings** (one vector per entity, built from its string properties) and **document chunks** (passage-level vectors of `document` properties — see `architecture.md` §4.2). By default both are searched and fused.

Requires `EMBEDDING_PROVIDER` to be configured. When embedding is disabled, returns a `422` error with code `FEATURE_DISABLED`.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string (required, min 1 char) | — | Natural language search query |
| `type` | string (optional) | — | Entity type key to search. When omitted, the search runs across all entity types in the ontology scope |
| `limit` | integer | 10 | Max results (1–100) |
| `min_score` | float | — | Minimum cosine similarity threshold (0.0–1.0), applied to the raw similarity of each ranking (see `matchedVia.similarity`), not to the fused `score` |
| `searchIn` | string | `all` | Which rankings to search: `entities` (entity embeddings only — the pre-document behavior), `documents` (document chunks only), or `all` (both, fused) |
| `snippets` | boolean | `true` | Whether document hits include a text snippet in `matchedVia` |
| `filter.{key}` | any | — | Exact match on property |
| `filter.{key}__{op}` | any | — | Operator match on property (same syntax as entity list filters) |
| `fields` | string[] | — | Property keys to include in result entities (repeatable). When provided, only `_id` plus listed fields are returned per entity (cross-type search additionally keeps `_entityTypeKey`). The `score` and `matchedVia` fields on the result wrapper are always present. When omitted, all properties are returned. |

**Response:** `200 OK`
```json
{
  "results": [
    {
      "entity": {
        "_id": "b7e3f1a2-...",
        "_entityTypeKey": "person",
        "_createdAt": "2026-02-22T10:00:00Z",
        "_updatedAt": "2026-02-22T10:00:00Z",
        "name": "Alice Chen",
        "role": "Distributed Systems Engineer",
        "bio": { "document": true, "length": 40213 }
      },
      "score": 0.0164,
      "matchedVia": {
        "source": "document",
        "propertyKey": "bio",
        "charOffset": 5200,
        "charLength": 1500,
        "similarity": 0.87,
        "snippet": "first ~200 chars of the matching chunk…"
      }
    }
  ],
  "query": "distributed systems engineers",
  "total": 3
}
```

**The `matchedVia` contract:** every hit carries `matchedVia`, identifying what matched:

- Entity-embedding hits carry `{ "source": "entity", "similarity": <cosine> }`.
- Document hits carry `source: "document"`, the `propertyKey`, the matching chunk's character coordinates (`charOffset`, `charLength`) — pass them as `offset`/`limit` to the document read endpoint to fetch exactly the matching passage — the raw cosine `similarity`, and a ~200-char `snippet` (omitted when `snippets=false`).
- When an entity matches in **both** rankings, the document `matchedVia` wins regardless of which similarity is higher — it carries the retrieval coordinates, which are the more actionable information. The entity-side similarity is not surfaced for that hit.

**Score semantics:** with `searchIn=all`, `score` is the Reciprocal Rank Fusion value (`Σ 1/(60 + rank)` over the rankings an entity appears in) — useful **only for ordering**, not as a similarity measure. Threshold on `matchedVia.similarity` instead; `min_score` does exactly that, filtering each ranking by raw similarity before fusion. With `searchIn=entities` or `documents`, `score` equals the raw cosine similarity.

**Behavior:**
- With `type`: searches only the vector indexes for the specified entity type. Returns 404 if the type key is not found in the ontology schema.
- Without `type`: the entity ranking searches a shared cross-type semantic index over all entity types visible through the ontology scope. Each result entity carries `_entityTypeKey`. For scoped ontologies the candidate pool is over-fetched and filtered to scoped types in the application, so a heavily restricted scope may return fewer than `limit` results even when more matches exist.
- The document ranking queries each in-scope (entity type, document property) chunk index, merges chunk hits by score, and dedupes to parent entities — the best chunk per entity wins and provides `matchedVia`. Only properties visible through the ontology lens are searched: a lens excluding `bio` from `person` never touches that chunk index.
- When `filter.{key}` parameters are provided, the entity ranking over-fetches candidates from the semantic index and applies the property filters before the final limit; document-chunk hits are filtered against the parent entity's properties after resolution. Filter syntax matches the entity list endpoint except that `__contains` is not supported here and is rejected with 422 (use equality or the range operators `__gt`, `__gte`, `__lt`, `__lte`). Filters require `type` — cross-type search rejects them with 422, since property definitions are per entity type.
- The `_embedding` property is never included in response entities. Document properties appear as stubs.

**Embedding generation:** Embeddings are generated automatically when entities are created or updated (if string properties change). The entity's text representation concatenates all non-null string property values in schema-defined order, prefixed with the entity type key — document property values are excluded (they are chunked and embedded separately). If the embedding provider is unavailable at write time, the entity is created normally but without an embedding — it will not appear in semantic search results until re-embedded.

**Errors:**
- 404 if ontology key or entity type key not found.
- 422 with code `FEATURE_DISABLED` if `EMBEDDING_PROVIDER` is not configured.
- 422 if the query embedding fails to generate.

---

## 7. OQL Query

### POST /api/runtime/{ontologyKey}/query

Execute a read-only OQL query against the ontology's scoped schema. OQL — the OntoForge Query Language — is a read-only, openCypher-shaped graph pattern language anchored to the ISO GQL standard and its GPML pattern sublanguage (see decision 009 in `decisions.md`). The query is parsed and validated before execution.

**Request body:**
```json
{
  "query": "MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, c LIMIT 10"
}
```

The legacy field name `cypher` is accepted as a deprecated input alias for `query` for one minor release.

Queries are written entirely in schema type keys: entity type keys (snake_case) as node labels and relation type keys as relationship types.

**Response:** `200 OK`
```json
{
  "columns": ["p", "c"],
  "results": [
    {
      "p": {
        "_id": "b7e3f1a2-...",
        "_entityTypeKey": "person",
        "_createdAt": "2026-02-22T10:00:00Z",
        "_updatedAt": "2026-02-22T10:00:00Z",
        "name": "Alice"
      },
      "c": {
        "_id": "a1b2c3d4-...",
        "_entityTypeKey": "company",
        "_createdAt": "2026-02-22T10:00:00Z",
        "_updatedAt": "2026-02-22T10:00:00Z",
        "name": "Acme Corp"
      }
    }
  ]
}
```

**Supported OQL clauses:** `MATCH`, `OPTIONAL MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, `SKIP`, `WITH`, `UNWIND`.

**Blocked operations (422):**
- Write clauses: `CREATE`, `DELETE`, `DETACH DELETE`, `SET`, `MERGE`, `REMOVE`
- Procedure calls: `CALL`
- Labelless node patterns (e.g., `MATCH (n)`)
- Reserved internal names are rejected as labels or relationship types

**Validation (422):**
- Node labels must be entity type keys in the ontology scope.
- Relationship types must be relation type keys in the ontology scope.
- Properties in `WHERE`, `RETURN`, and `ORDER BY` must exist on the referenced type's scoped property set.
- System properties (`_id`, `_entityTypeKey`, `_relationTypeKey`, `_createdAt`, `_updatedAt`) are always allowed.
- Error messages include the available types and properties to support self-correction by LLMs.

**Result filtering:** Returned nodes and relationships are post-processed to strip properties that fall outside the scoped ontology, preventing leakage of out-of-scope properties. Document property values are replaced with stubs in results — although document properties remain valid references in the query itself (e.g., `WHERE p.bio IS NOT NULL`).

**Errors:**
- 404 if ontology key not found.
- 422 if the query syntax is invalid, contains blocked operations, or references unknown types/properties. The error `details.errors` array lists all violations.

---

## 8. Error Responses

The runtime API reuses the same error format as the modeling API (see `architecture.md` §5.1).

**Validation errors** (422) collect all field errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Instance validation failed",
    "details": {
      "fields": {
        "age": "Expected integer, got string",
        "email": "Unknown property: not defined in entity type 'person'",
        "name": "Required property missing"
      }
    }
  }
}
```

---

## 9. Feature Discovery

### GET /api/runtime/features

Return feature availability flags for the runtime API. This endpoint is not scoped to an ontology — it reports global runtime capabilities based on server configuration.

**Response:** `200 OK`
```json
{
  "semanticSearch": true,
  "ai": true
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `semanticSearch` | boolean | `true` when `EMBEDDING_PROVIDER` is configured |
| `ai` | boolean | `true` when `AI_PROVIDER` is configured |

This endpoint is useful for frontend feature detection — clients can check which optional features are available before rendering related UI.

---

## 10. AI Endpoints

LLM-powered endpoints for natural language interaction with the knowledge graph. Requires `AI_PROVIDER` to be configured. When disabled, all AI endpoints return `422` with code `VALIDATION_ERROR`.

### POST /api/runtime/{ontologyKey}/ai/query

Translate a natural language question into an OQL query, execute it, and return a summarized answer.

**Request body:**
```json
{
  "question": "How many companies are in Berlin?"
}
```

**Response:** `200 OK`
```json
{
  "answer": "There are 3 companies in Berlin.",
  "query": "MATCH (c:company) WHERE c.location = 'Berlin' RETURN count(c) AS total",
  "cypher": "MATCH (c:company) WHERE c.location = 'Berlin' RETURN count(c) AS total",
  "results": {
    "columns": ["total"],
    "results": [{"total": 3}]
  }
}
```

The `query` and `results` fields may be `null` if the LLM answered without using the query tool. `cypher` is a deprecated mirror of `query`, kept for one minor release and then removed.

### POST /api/runtime/{ontologyKey}/ai/extract

Extract structured entities and relations from unstructured text, guided by the ontology schema.

**Request body:**
```json
{
  "text": "John Smith works at Acme Corp. He is 30 years old.",
  "entityTypes": ["person", "company"],
  "create": false
}
```

- `entityTypes` (optional): filter extraction to specific types.
- `create` (optional, default `false`): when `true`, persist extracted entities and relations with full validation.

**Response:** `200 OK`
```json
{
  "entities": [
    {"entityTypeKey": "person", "properties": {"name": "John Smith", "age": 30}},
    {"entityTypeKey": "company", "properties": {"name": "Acme Corp"}}
  ],
  "relations": [
    {
      "relationTypeKey": "works_for",
      "source": {"entityTypeKey": "person", "match": {"name": "John Smith"}},
      "target": {"entityTypeKey": "company", "match": {"name": "Acme Corp"}},
      "properties": {}
    }
  ],
  "created": false
}
```

### POST /api/runtime/{ontologyKey}/ai/chat

Conversational Q&A with tool use against the knowledge graph.

**Request body:**
```json
{
  "message": "How many people work at Acme Corp?",
  "history": [
    {"role": "user", "content": "Tell me about Acme"},
    {"role": "assistant", "content": "Acme Corp is a technology company."}
  ],
  "includeToolCalls": true
}
```

- `history` (optional): prior conversation turns for multi-turn context. Stateless — client sends full history.
- `includeToolCalls` (optional, default `false`): include tool usage details in response for debugging.

**Response:** `200 OK`
```json
{
  "reply": "There are 12 people who work at Acme Corp.",
  "toolCalls": [
    {
      "tool": "execute_query",
      "args": {"query": "MATCH (p:person)-[:works_for]->(c:company {name: 'Acme Corp'}) RETURN count(p)"}
    }
  ]
}
```

`toolCalls` is only present when `includeToolCalls` is `true`.

### GET /api/runtime/{ontologyKey}/ai/agents

List available AI agents for this ontology. Returns the default agent plus any agents configured via the modeling API.

**Response:** `200 OK`
```json
[
  {
    "key": "default",
    "name": "Default Assistant",
    "description": "Schema-aware conversational agent"
  },
  {
    "key": "analyst",
    "name": "Data Analyst",
    "description": "Specialized agent for data analysis"
  }
]
```

### POST /api/runtime/{ontologyKey}/ai/agents/{agentKey}/chat

Agent-scoped conversational Q&A. Behaves like the `/ai/chat` endpoint but uses the agent's configured system prompt and tool set.

**Request body:** Same as `/ai/chat`.

**Response:** `200 OK` — same shape as `/ai/chat`.

**Errors:** 404 if agent key not found.

### GET /api/runtime/{ontologyKey}/ai/.well-known/agent.json

Return the A2A agent card for the default agent. Describes the agent's capabilities, skills, and endpoint URL following the Agent-to-Agent (A2A) protocol.

**Response:** `200 OK` — A2A agent card JSON.

### POST /api/runtime/{ontologyKey}/ai/a2a

A2A task endpoint for the default agent. Accepts and processes tasks following the A2A protocol.

**Request body:** A2A task request.

**Response:** `200 OK` — A2A task response.

### GET /api/runtime/{ontologyKey}/ai/agents/{agentKey}/.well-known/agent.json

Return the A2A agent card for a specific configured agent.

**Response:** `200 OK` — A2A agent card JSON.

**Errors:** 404 if agent key not found.

### POST /api/runtime/{ontologyKey}/ai/agents/{agentKey}/a2a

A2A task endpoint for a specific configured agent.

**Request body:** A2A task request.

**Response:** `200 OK` — A2A task response.

**Errors:** 404 if agent key not found.

---

## 11. Saved Queries

### GET /api/runtime/{ontologyKey}/saved-queries

List all saved queries available for this ontology. Returns query metadata, the step pipeline, and parameter definitions.

**Response:** `200 OK`
```json
[
  {
    "key": "string",
    "name": "string",
    "description": "string",
    "steps": [
      {
        "name": "string",
        "type": "oql | semantic_search",
        "oql": "string (oql steps only)",
        "entityTypeKey": "string (semantic_search steps only)",
        "query": "string (semantic_search steps only — the search text)",
        "limit": 10,
        "minScore": 0.7,
        "bindings": { "param": "{{stepName.field}}" }
      }
    ],
    "parameters": [
      {
        "name": "string",
        "description": "string",
        "dataType": "string"
      }
    ]
  }
]
```

Step fields are included only when set; `steps` reflects the multi-step pipeline defined in the modeling API. Responses always emit the current field names; the legacy step type `cypher` and its `cypher` field are accepted on input paths only (modeling API, import).

**Errors:** 404 if ontology key not found.

### GET /api/runtime/{ontologyKey}/saved-queries/search

Search saved queries by semantic similarity to a natural language description. Returns queries ranked by how well their description matches.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string (required) | — | Natural language search query |
| `limit` | integer | 3 | Maximum results (1–20) |
| `min_score` | float | 0.7 | Minimum cosine similarity (0.0–1.0) |

**Response:** `200 OK`
```json
[
  {
    "key": "string",
    "name": "string",
    "description": "string",
    "parameters": [
      {
        "name": "string",
        "description": "string",
        "dataType": "string"
      }
    ],
    "score": 0.87
  }
]
```

**Errors:**
- 404 if ontology key not found.
- 422 if embedding provider is not configured (`FEATURE_DISABLED`).

### POST /api/runtime/{ontologyKey}/saved-queries/{queryKey}/run

Execute a saved query with the provided parameter values. Parameters are validated, type-coerced, and passed as typed parameters. The query is re-validated against the current schema before execution.

**Request body:**
```json
{
  "params": {
    "name": "Alice",
    "min_age": 25
  }
}
```

All declared parameters are required. Parameter values are coerced to their declared data types.

**Response:** `200 OK`
```json
{
  "columns": ["p", "c"],
  "results": [
    {
      "p": {
        "_id": "b7e3f1a2-...",
        "_entityTypeKey": "person",
        "name": "Alice"
      },
      "c": {
        "_id": "a1b2c3d4-...",
        "_entityTypeKey": "company",
        "name": "Acme Corp"
      }
    }
  ]
}
```

**Errors:**
- 404 if ontology key or query key not found.
- 422 if parameters are missing, extra, or fail type coercion. Also 422 if the query fails schema re-validation (e.g., a referenced type was removed since the query was created).

---

## 12. Endpoint Summary

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/runtime/features` | Feature availability flags |
| `GET` | `/api/runtime/{ontologyKey}/schema` | Full schema introspection |
| `GET` | `/api/runtime/{ontologyKey}/schema/entity-types` | List entity types |
| `GET` | `/api/runtime/{ontologyKey}/schema/entity-types/{key}` | Get entity type with properties |
| `GET` | `/api/runtime/{ontologyKey}/schema/relation-types` | List relation types |
| `GET` | `/api/runtime/{ontologyKey}/schema/relation-types/{key}` | Get relation type with properties |
| `POST` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}` | Create entity instance |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}` | List/search entity instances |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}` | Get entity instance |
| `PATCH` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}` | Partial update entity instance |
| `DELETE` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}` | Delete entity instance |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/neighbors` | Graph traversal |
| `GET` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}` | Read (a slice of) a document property |
| `PATCH` | `/api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}` | Partial write to a document property |
| `GET` | `/api/runtime/{ontologyKey}/search/semantic` | Semantic search over entity instances and documents |
| `POST` | `/api/runtime/{ontologyKey}/query` | Read-only OQL query |
| `POST` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | Create relation instance |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | List relation instances |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Get relation instance |
| `PATCH` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Partial update relation instance |
| `DELETE` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Delete relation instance |
| `POST` | `/api/runtime/{ontologyKey}/ai/query` | NL → OQL query with answer |
| `POST` | `/api/runtime/{ontologyKey}/ai/extract` | Extract entities/relations from text |
| `POST` | `/api/runtime/{ontologyKey}/ai/chat` | Schema-aware conversational Q&A |
| `GET` | `/api/runtime/{ontologyKey}/ai/agents` | List agents (default + configured) |
| `POST` | `/api/runtime/{ontologyKey}/ai/agents/{agentKey}/chat` | Agent-scoped conversational Q&A |
| `GET` | `/api/runtime/{ontologyKey}/ai/.well-known/agent.json` | Default agent A2A card |
| `POST` | `/api/runtime/{ontologyKey}/ai/a2a` | Default agent A2A task |
| `GET` | `/api/runtime/{ontologyKey}/ai/agents/{agentKey}/.well-known/agent.json` | Agent-specific A2A card |
| `POST` | `/api/runtime/{ontologyKey}/ai/agents/{agentKey}/a2a` | Agent-specific A2A task |
| `GET` | `/api/runtime/{ontologyKey}/saved-queries` | List saved queries |
| `GET` | `/api/runtime/{ontologyKey}/saved-queries/search` | Semantic search over saved queries |
| `POST` | `/api/runtime/{ontologyKey}/saved-queries/{queryKey}/run` | Execute a saved query |
