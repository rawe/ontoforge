# Runtime API Contract

> Full contract for the runtime REST API.
> Base path: `/api/runtime/{ontologyKey}`
>
> All runtime endpoints are scoped to a specific ontology via the `ontologyKey` path parameter.
> The ontology key is the ontology's unique `key` field (snake_case, pattern: `^[a-z][a-z0-9_]*$`).
> The runtime module reads schema data from the same database as the modeling module.
>
> For storage model details, see `architecture.md` §4.2.

## 1. Instance Data Management

### DELETE /api/runtime/{ontologyKey}/data

Wipe all instance data (entities and relations) for the specified ontology. Schema nodes are preserved.

**Response:** `200 OK`
```json
{
  "ontologyKey": "acme",
  "entitiesDeleted": 150,
  "relationsDeleted": 42
}
```

**Behavior:**
1. Delete all entity instance nodes and relation instance relationships belonging to this ontology's entity types.
2. Rebuild the in-memory schema cache for this ontology.
3. Return a summary of deleted items.

**Errors:** 404 if ontology key not found.

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
- Default values are injected for required properties not in the request but with a `defaultValue` in the schema.
- All validation errors are collected and returned at once (not fail-fast).

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

**Filter syntax:** All property filters use the `filter.` prefix to avoid namespace collisions with reserved parameters. Operator suffixes use double-underscore:

| Suffix | Meaning | Example |
|--------|---------|---------|
| (none) | equals | `filter.name=Alice` |
| `__gt` | greater than | `filter.age__gt=25` |
| `__gte` | greater than or equal | `filter.age__gte=25` |
| `__lt` | less than | `filter.age__lt=40` |
| `__lte` | less than or equal | `filter.age__lte=40` |
| `__contains` | substring match (case-insensitive) | `filter.name__contains=ali` |

**Text search (`q`):** Searches all string properties of the entity type using case-insensitive `CONTAINS`. Simple substring matching, not full-text indexing. Sufficient for the MVP; full-text indexes can be added later without API changes.

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

**Null removal:** Setting a property to `null` removes it from the node (using Cypher `REMOVE`). This is the only way to unset an optional property. Setting a `required` property to `null` is rejected with 422.

**Response:** `200 OK` — full entity instance after update.

**Validation:** Same type and unknown-property checks as creation, applied only to the provided properties.

**Errors:** 404 if not found. 422 if validation fails.

### DELETE /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}

Delete an entity instance. Uses `DETACH DELETE` — all relationships connected to this entity are also deleted.

**Response:** `204 No Content`

**Errors:** 404 if not found.

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

Search entity instances by natural language meaning using vector embeddings. Returns entities ranked by cosine similarity to the query.

Requires `EMBEDDING_PROVIDER` to be configured. When embedding is disabled, returns a `422` error with code `FEATURE_DISABLED`.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string (required, min 1 char) | — | Natural language search query |
| `type` | string (required) | — | Entity type key to search |
| `limit` | integer | 10 | Max results (1–100) |
| `min_score` | float | — | Minimum cosine similarity threshold (0.0–1.0) |
| `filter.{key}` | any | — | Exact match on property |
| `filter.{key}__{op}` | any | — | Operator match on property (same syntax as entity list filters) |

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
        "role": "Distributed Systems Engineer"
      },
      "score": 0.92
    }
  ],
  "query": "distributed systems engineers",
  "total": 3
}
```

**Behavior:**
- Searches only the vector index for the specified entity type. Returns 404 if the type key is not found in the ontology schema.
- When `filter.{key}` parameters are provided, the vector index over-fetches candidates and applies property `WHERE` clauses before the final `LIMIT`. Filter syntax is identical to the entity list endpoint (equality, `__gt`, `__gte`, `__lt`, `__lte`, `__contains`).
- When `min_score` is provided, results below the threshold are excluded.
- The `_embedding` property is never included in response entities.

**Embedding generation:** Embeddings are generated automatically when entities are created or updated (if string properties change). The text representation concatenates all non-null string property values in schema-defined order, prefixed with the entity type key. If the embedding provider is unavailable at write time, the entity is created normally but without an embedding — it will not appear in semantic search results until re-embedded.

**Errors:**
- 404 if ontology key or entity type key not found.
- 422 with code `FEATURE_DISABLED` if `EMBEDDING_PROVIDER` is not configured.
- 422 if the query embedding fails to generate.

---

## 7. Error Responses

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

## 8. Endpoint Summary

| Method | Path | Description |
|--------|------|-------------|
| `DELETE` | `/api/runtime/{ontologyKey}/data` | Wipe instance data for this ontology |
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
| `GET` | `/api/runtime/{ontologyKey}/search/semantic` | Semantic search over entity instances |
| `POST` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | Create relation instance |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}` | List relation instances |
| `GET` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Get relation instance |
| `PATCH` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Partial update relation instance |
| `DELETE` | `/api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}` | Delete relation instance |
