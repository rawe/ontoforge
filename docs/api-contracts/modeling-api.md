# Modeling API Contract

> Full contract for the schema modeling REST API.
> Base path: `/api/model`

## 1. Ontology Endpoints

### POST /api/model/ontologies

Create a new ontology.

**Request body:**
```json
{
  "name": "string (required, unique)",
  "key": "string (required, unique, immutable, pattern: ^[a-z][a-z0-9_]*$)",
  "description": "string (optional)"
}
```

The `key` field is a URL-safe identifier used in runtime API routes (`/api/runtime/{ontologyKey}/...`). It follows the same snake_case pattern as entity and relation type keys. Once created, the key cannot be changed.

**Response:** `201 Created`
```json
{
  "ontologyId": "uuid",
  "name": "string",
  "key": "string",
  "description": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

**Errors:** 409 if name or key already exists.

### GET /api/model/ontologies

List all ontologies.

**Response:** `200 OK`
```json
[
  {
    "ontologyId": "uuid",
    "name": "string",
    "key": "string",
    "description": "string",
    "createdAt": "datetime",
    "updatedAt": "datetime"
  }
]
```

### GET /api/model/ontologies/{ontologyId}

Get a single ontology by ID.

**Response:** `200 OK` — same shape as list item.

**Errors:** 404 if not found.

### PUT /api/model/ontologies/{ontologyId}

Update ontology metadata. `ontologyId` and `key` are immutable.

**Request body:**
```json
{
  "name": "string (optional)",
  "description": "string (optional)"
}
```

**Response:** `200 OK` — full ontology object.

**Errors:** 404 if not found. 409 if updated name conflicts.

### DELETE /api/model/ontologies/{ontologyId}

Delete an ontology and all its entity types, relation types, and property definitions (cascade).

**Response:** `204 No Content`

**Errors:** 404 if not found.

---

## 2. Entity Type Endpoints

### POST /api/model/ontologies/{ontologyId}/entity-types

Create an entity type within an ontology.

**Request body:**
```json
{
  "key": "string (required, unique within ontology, lowercase alphanumeric + underscore)",
  "displayName": "string (required)",
  "description": "string (optional)"
}
```

**Response:** `201 Created`
```json
{
  "entityTypeId": "uuid",
  "key": "string",
  "displayName": "string",
  "description": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

**Errors:** 404 if ontology not found. 409 if key already exists in this ontology.

### GET /api/model/ontologies/{ontologyId}/entity-types

List entity types in an ontology.

**Response:** `200 OK` — array of entity type objects.

### GET /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}

Get a single entity type.

**Response:** `200 OK` — entity type object.

**Errors:** 404 if ontology or entity type not found.

### PUT /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}

Update an entity type. `key` is immutable after creation.

**Request body:**
```json
{
  "displayName": "string (optional)",
  "description": "string (optional)"
}
```

**Response:** `200 OK` — full entity type object.

**Errors:** 404 if not found.

### DELETE /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}

Delete an entity type and its property definitions. Fails if any relation type references this entity type as source or target.

**Response:** `204 No Content`

**Errors:** 404 if not found. 409 if referenced by a relation type.

---

## 3. Relation Type Endpoints

### POST /api/model/ontologies/{ontologyId}/relation-types

Create a relation type within an ontology.

**Request body:**
```json
{
  "key": "string (required, unique within ontology, lowercase alphanumeric + underscore)",
  "displayName": "string (required)",
  "description": "string (optional)",
  "sourceEntityTypeId": "uuid (required, must exist in this ontology)",
  "targetEntityTypeId": "uuid (required, must exist in this ontology)"
}
```

**Response:** `201 Created`
```json
{
  "relationTypeId": "uuid",
  "key": "string",
  "displayName": "string",
  "description": "string",
  "sourceEntityTypeId": "uuid",
  "targetEntityTypeId": "uuid",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

**Errors:** 404 if ontology not found. 409 if key already exists. 422 if source or target entity type not found in this ontology.

### GET /api/model/ontologies/{ontologyId}/relation-types

List relation types in an ontology.

**Response:** `200 OK` — array of relation type objects.

### GET /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}

Get a single relation type.

**Response:** `200 OK` — relation type object.

**Errors:** 404 if not found.

### PUT /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}

Update a relation type. `key`, `sourceEntityTypeId`, and `targetEntityTypeId` are immutable after creation.

**Request body:**
```json
{
  "displayName": "string (optional)",
  "description": "string (optional)"
}
```

**Response:** `200 OK` — full relation type object.

**Errors:** 404 if not found.

### DELETE /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}

Delete a relation type and its property definitions.

**Response:** `204 No Content`

**Errors:** 404 if not found.

---

## 4. Property Definition Endpoints

Properties are nested under their owning type (entity type or relation type).

### POST /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}/properties

Add a property definition to an entity type.

**Request body:**
```json
{
  "key": "string (required, unique within owning type, lowercase alphanumeric + underscore)",
  "displayName": "string (required)",
  "description": "string (optional)",
  "dataType": "string (required, one of: string, integer, float, boolean, date, datetime, document)",
  "required": "boolean (default: false)",
  "defaultValue": "string (optional, interpreted according to dataType)"
}
```

The `document` data type holds large text content, interpreted as Markdown (see `architecture.md` §4.2 for its storage model). It is only valid on entity types — creating a document property on a relation type is rejected with 422. When an embedding provider is configured, creating a document property also creates its chunk vector index; deleting the property drops its chunks and index.

**Response:** `201 Created`
```json
{
  "propertyId": "uuid",
  "key": "string",
  "displayName": "string",
  "description": "string",
  "dataType": "string",
  "required": true,
  "defaultValue": null,
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

**Errors:** 404 if ontology or entity type not found. 409 if key already exists on this type.

### GET /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}/properties

List properties of an entity type.

**Response:** `200 OK` — array of property definition objects.

### PUT /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}/properties/{propertyId}

Update a property definition. `key` and `dataType` are immutable after creation.

**Request body:**
```json
{
  "displayName": "string (optional)",
  "description": "string (optional)",
  "required": "boolean (optional)",
  "defaultValue": "string (optional, null to clear)"
}
```

**Response:** `200 OK` — full property definition object.

**Errors:** 404 if not found.

### DELETE /api/model/ontologies/{ontologyId}/entity-types/{entityTypeId}/properties/{propertyId}

Delete a property definition.

**Response:** `204 No Content`

**Errors:** 404 if not found.

### Relation Type Properties

The same four endpoints exist under relation types:

- `POST /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}/properties`
- `GET /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}/properties`
- `PUT /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}/properties/{propertyId}`
- `DELETE /api/model/ontologies/{ontologyId}/relation-types/{relationTypeId}/properties/{propertyId}`

Request and response shapes are identical to entity type properties, except that the `document` data type is not allowed on relation types (422).

---

## 5. Schema Validation

### POST /api/model/ontologies/{ontologyId}/validate

Validate the schema of an ontology for consistency.

Checks:
- All relation type source/target references point to existing entity types
- No duplicate keys within scope
- Property data types are valid
- Required fields are present on all types

**Response:** `200 OK`
```json
{
  "valid": true,
  "errors": []
}
```

Or with errors:
```json
{
  "valid": false,
  "errors": [
    {
      "path": "relationTypes.works_at",
      "message": "Source entity type 'nonexistent_id' does not exist"
    }
  ]
}
```

**Errors:** 404 if ontology not found.

---

## 6. Export / Import

### GET /api/model/ontologies/{ontologyId}/export

Export an ontology schema as JSON.

**Response:** `200 OK` — JSON transfer format (formatVersion `3.0`) as defined in `architecture.md` section 4.4.

**Errors:** 404 if ontology not found.

### POST /api/model/import

Import an ontology from a JSON payload.

**Request body:** JSON transfer format (see `architecture.md` section 4.4). Format `2.x` payloads are accepted: legacy saved-query steps of type `cypher` and their `cypher` field are mapped to `oql` on import.

**Query parameter:** `overwrite=true|false` (default: false). If true and an ontology with the same `ontologyId` exists, it will be replaced. If false and it exists, returns 409.

**Response:** `201 Created` — the created/updated ontology object.

**Side effects:** When an embedding provider is configured, the import recreates the semantic-search indexes for each entity type, for each document property, and for saved queries. This ensures semantic search does not fail with missing indexes on a freshly imported database. Document chunk nodes are derived data and are not part of the transfer format — regenerate them via `POST /api/model/rebuild-embeddings` after importing instance data.

**Errors:** 409 if ontology already exists and overwrite is false. 422 if the import payload fails validation.

### POST /api/model/rebuild-embeddings

Regenerate all embedding vectors for entity instances and saved queries. Ensures the semantic-search indexes exist, then iterates all entities and saved queries to (re-)compute their embeddings. For entities with document properties, the document chunks are also rebuilt (existing chunks deleted, text re-chunked and re-embedded).

Use this after data import, after changing the embedding model or dimensions, or to repair missing/corrupted indexes.

**Precondition:** Embedding provider must be configured (`EMBEDDING_PROVIDER` environment variable).

**Response:** `200 OK` with `application/x-ndjson` streaming body. Each line is a JSON object:

Progress lines (emitted per entity processed):
```json
{
  "type": "progress",
  "entityTypeKey": "string",
  "processed": 5,
  "total": 42
}
```

For saved queries, `entityTypeKey` is `"saved_queries"`.

Summary line (final line):
```json
{
  "type": "summary",
  "entityTypes": [
    { "entityTypeKey": "topic", "processed": 42, "failed": 0 }
  ],
  "savedQueriesProcessed": 7,
  "savedQueriesFailed": 0,
  "totalProcessed": 49,
  "totalFailed": 0
}
```

**Errors:** 422 if embedding provider is not configured.

---

## 7. Common DTOs

### OntologyCreate
```
name: string (required)
key: string (required, pattern: ^[a-z][a-z0-9_]*$, unique, immutable)
description: string (optional)
```

### OntologyUpdate
```
name: string (optional)
description: string (optional)
```

### OntologyResponse
```
ontologyId: string (uuid)
name: string
key: string
description: string | null
createdAt: datetime
updatedAt: datetime
```

### EntityTypeCreate
```
key: string (required, pattern: ^[a-z][a-z0-9_]*$)
displayName: string (required)
description: string (optional)
```

### EntityTypeUpdate
```
displayName: string (optional)
description: string (optional)
```

### EntityTypeResponse
```
entityTypeId: string (uuid)
key: string
displayName: string
description: string | null
createdAt: datetime
updatedAt: datetime
```

### RelationTypeCreate
```
key: string (required, pattern: ^[a-z][a-z0-9_]*$)
displayName: string (required)
description: string (optional)
sourceEntityTypeId: string (uuid, required)
targetEntityTypeId: string (uuid, required)
```

### RelationTypeUpdate
```
displayName: string (optional)
description: string (optional)
```

### RelationTypeResponse
```
relationTypeId: string (uuid)
key: string
displayName: string
description: string | null
sourceEntityTypeId: string (uuid)
targetEntityTypeId: string (uuid)
createdAt: datetime
updatedAt: datetime
```

### PropertyDefinitionCreate
```
key: string (required, pattern: ^[a-z][a-z0-9_]*$)
displayName: string (required)
description: string (optional)
dataType: string (required, enum: string | integer | float | boolean | date | datetime | document; document only on entity types)
required: boolean (default: false)
defaultValue: string (optional)
```

### PropertyDefinitionUpdate
```
displayName: string (optional)
description: string (optional)
required: boolean (optional)
defaultValue: string (optional, null to clear)
```

### PropertyDefinitionResponse
```
propertyId: string (uuid)
key: string
displayName: string
description: string | null
dataType: string
required: boolean
defaultValue: string | null
createdAt: datetime
updatedAt: datetime
```

### ValidationResult
```
valid: boolean
errors: array of { path: string, message: string }
```

### ErrorResponse
```
error: {
  code: string (enum: RESOURCE_NOT_FOUND | RESOURCE_CONFLICT | VALIDATION_ERROR | INTERNAL_ERROR)
  message: string
  details: object (optional, e.g. field-level errors)
}
```

---

## 8. Error Model

| HTTP Status | Error Code | When |
|-------------|------------|------|
| 400 | `BAD_REQUEST` | Malformed JSON, missing required fields, invalid field format |
| 404 | `RESOURCE_NOT_FOUND` | Ontology, entity type, relation type, or property not found |
| 409 | `RESOURCE_CONFLICT` | Duplicate name/key, entity type in use by relation types |
| 422 | `VALIDATION_ERROR` | Semantic error (invalid entity type reference, schema inconsistency) |
| 500 | `STORAGE_ERROR` | Storage failure; `details.errorId` correlates the response with the server log |

---

## 9. AI Agent Config Endpoints

AI agent configurations are managed per ontology. The path uses `ontologyKey` (not UUID) for consistency with runtime routes.

### GET /api/model/ontologies/{ontologyKey}/ai-agents

List all AI agent configurations for an ontology.

**Response:** `200 OK`
```json
[
  {
    "key": "string",
    "name": "string",
    "description": "string | null",
    "systemPrompt": "string | null",
    "tools": ["string"],
    "createdAt": "datetime",
    "updatedAt": "datetime"
  }
]
```

**Errors:** 404 if ontology not found.

### PUT /api/model/ontologies/{ontologyKey}/ai-agents/{agentKey}

Create or update an AI agent configuration. Returns `201 Created` when creating a new agent and `200 OK` when updating an existing one. The `agentKey` in the path becomes the agent's key.

**Request body:**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "systemPrompt": "string (optional)",
  "tools": ["string (optional, list of tool names)"]
}
```

**Response:** `201 Created` or `200 OK`
```json
{
  "key": "string",
  "name": "string",
  "description": "string | null",
  "systemPrompt": "string | null",
  "tools": ["string"],
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

**Errors:** 404 if ontology not found. 422 if validation fails.

### DELETE /api/model/ontologies/{ontologyKey}/ai-agents/{agentKey}

Delete an AI agent configuration.

**Response:** `204 No Content`

**Errors:** 404 if ontology or agent not found.

---

## 10. Saved Query Endpoints

Saved queries are managed per ontology. The path uses `ontologyKey` (not UUID) for consistency with runtime routes and AI agent endpoints.

### GET /api/model/ontologies/{ontologyKey}/saved-queries

List all saved queries for an ontology.

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
    ],
    "createdAt": "datetime",
    "updatedAt": "datetime"
  }
]
```

**Errors:** 404 if ontology not found.

### PUT /api/model/ontologies/{ontologyKey}/saved-queries/{queryKey}

Create or update a saved query. Returns `201 Created` when creating a new query and `200 OK` when updating an existing one. The `queryKey` in the path becomes the query's key.

A saved query is an ordered pipeline of steps. `oql` steps carry their OQL text in the `oql` field; `semantic_search` steps carry their search text in the `query` field. The legacy step type `cypher` and its `cypher` field are accepted on input as deprecated aliases for `oql`; responses always emit the current names.

The OQL is validated against the ontology's scoped schema at creation time. Parameter declarations must match `$param` references in the steps.

**Request body:**
```json
{
  "name": "string (required)",
  "description": "string (required)",
  "steps": [
    {
      "name": "string (required, unique per pipeline)",
      "type": "oql | semantic_search",
      "oql": "string (oql steps)",
      "entityTypeKey": "string (semantic_search steps)",
      "query": "string (semantic_search steps — the search text)",
      "limit": 10,
      "minScore": 0.7,
      "bindings": { "param": "{{stepName.field}}" }
    }
  ],
  "parameters": [
    {
      "name": "string (required)",
      "description": "string (required)",
      "dataType": "string (required, one of: string, integer, float, boolean, date, datetime)"
    }
  ]
}
```

**Response:** `201 Created` or `200 OK` — same shape as a list item.

**Errors:** 404 if ontology not found. 422 if OQL validation fails or parameters don't match `$param` references.

### DELETE /api/model/ontologies/{ontologyKey}/saved-queries/{queryKey}

Delete a saved query.

**Response:** `204 No Content`

**Errors:** 404 if ontology or saved query not found.

---

## 11. AI Agent Config DTOs

### AiAgentConfigUpsert
```
name: string (required)
description: string (optional)
systemPrompt: string (optional)
tools: string[] (optional, list of tool names)
```

### AiAgentConfigResponse
```
key: string
name: string
description: string | null
systemPrompt: string | null
tools: string[]
createdAt: datetime
updatedAt: datetime
```

---

## 12. Saved Query DTOs

### SavedQueryUpsert
```
name: string (required)
description: string (required)
steps: array of SavedQueryStep (required, min 1)
parameters: array of SavedQueryParameter (optional, default [])
```

### SavedQueryStep
```
name: string (required, pattern: ^[a-zA-Z_]\w*$)
type: string (required, enum: oql | semantic_search; legacy "cypher" accepted on input as alias for oql)
oql: string (oql steps; legacy field name "cypher" accepted on input)
entityTypeKey: string (semantic_search steps)
query: string (semantic_search steps — the search text)
limit: integer (optional, 1–100)
minScore: float (optional, 0.0–1.0)
bindings: object (optional, param name → "{{stepName.field}}")
```

### SavedQueryParameter
```
name: string (required, pattern: ^[a-zA-Z_]\w*$)
description: string (required)
dataType: string (required, enum: string | integer | float | boolean | date | datetime)
```

### SavedQueryResponse
```
key: string
name: string
description: string
steps: array of SavedQueryStep
parameters: array of SavedQueryParameter
createdAt: datetime
updatedAt: datetime
```
