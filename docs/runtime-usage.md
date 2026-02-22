# Runtime API Usage Guide

> Practical guide for managing instance data against an existing ontology.
> For the full endpoint contract, see `api-contracts/runtime-api.md`.
> For the storage model, see `architecture.md` §4.2.

All runtime endpoints are scoped by ontology key: `/api/runtime/{ontologyKey}/...`

## Prerequisites

- Neo4j running (`docker compose up -d`)
- Backend running (`cd backend && uv run uvicorn ontoforge_server.main:app --host 0.0.0.0 --port 8000`)
- An ontology created via the modeling API or imported via `POST /api/model/import`

The examples below use the test ontology (key: `test_ontology`) with entity types `person` and `company`, and relation type `works_for`.

Import the test ontology:

```bash
curl -X POST http://localhost:8000/api/model/import \
  -H 'Content-Type: application/json' \
  -d @backend/tests/fixtures/test_ontology.json
```

## 1. Schema Introspection

Before creating data, discover what the ontology defines:

```bash
curl http://localhost:8000/api/runtime/test_ontology/schema
```

The response contains the full schema: ontology metadata, entity types with their properties, and relation types with their source/target entity type keys and properties. Each property definition includes `key`, `dataType`, `required`, and `defaultValue`.

To inspect a single type:

```bash
curl http://localhost:8000/api/runtime/test_ontology/schema/entity-types/person
curl http://localhost:8000/api/runtime/test_ontology/schema/relation-types/works_for
```

## 2. Entity Instances

### Create

Send a flat JSON object with property values matching the schema:

```bash
curl -X POST http://localhost:8000/api/runtime/test_ontology/entities/person \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "age": 30, "email": "alice@example.com"}'
```

Required properties must be present unless they have a `defaultValue` in the schema. Unknown properties (not defined in the schema) are rejected.

The response includes the created instance with system fields (`_id`, `_entityTypeKey`, `_createdAt`, `_updatedAt`) plus the user properties.

### List

```bash
curl http://localhost:8000/api/runtime/test_ontology/entities/person
```

Response shape: `{ "items": [...], "total": 42, "limit": 50, "offset": 0 }`

See [Filtering and Search](#4-filtering-and-search) for query parameters.

### Get

```bash
curl http://localhost:8000/api/runtime/test_ontology/entities/person/{id}
```

### Update

Partial update — only send the fields to change:

```bash
curl -X PATCH http://localhost:8000/api/runtime/test_ontology/entities/person/{id} \
  -H 'Content-Type: application/json' \
  -d '{"age": 31}'
```

To remove an optional property, set it to `null`:

```bash
curl -X PATCH http://localhost:8000/api/runtime/test_ontology/entities/person/{id} \
  -H 'Content-Type: application/json' \
  -d '{"email": null}'
```

Setting a required property to `null` returns a 422 error.

### Delete

```bash
curl -X DELETE http://localhost:8000/api/runtime/test_ontology/entities/person/{id}
```

Deleting an entity also removes all connected relations (DETACH DELETE).

## 3. Relation Instances

### Create

Requires `fromEntityId` and `toEntityId` referencing existing entity instances. The entity types must match the relation type's source and target definitions.

```bash
curl -X POST http://localhost:8000/api/runtime/test_ontology/relations/works_for \
  -H 'Content-Type: application/json' \
  -d '{"fromEntityId": "<person-id>", "toEntityId": "<company-id>", "since": "2024-03-15", "role": "Engineer"}'
```

### List

```bash
curl http://localhost:8000/api/runtime/test_ontology/relations/works_for
```

Filter by endpoint entities:

```bash
curl "http://localhost:8000/api/runtime/test_ontology/relations/works_for?fromEntityId=<person-id>"
curl "http://localhost:8000/api/runtime/test_ontology/relations/works_for?toEntityId=<company-id>"
```

### Get

```bash
curl http://localhost:8000/api/runtime/test_ontology/relations/works_for/{id}
```

### Update

Only properties can be updated. The `fromEntityId` and `toEntityId` are immutable — delete and recreate to change endpoints.

```bash
curl -X PATCH http://localhost:8000/api/runtime/test_ontology/relations/works_for/{id} \
  -H 'Content-Type: application/json' \
  -d '{"role": "Senior Engineer"}'
```

### Delete

```bash
curl -X DELETE http://localhost:8000/api/runtime/test_ontology/relations/works_for/{id}
```

Only the relationship is removed; the connected entities are unaffected.

## 4. Filtering and Search

These query parameters work on entity and relation list endpoints.

### Pagination

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit`   | 50      | Page size (max 200) |
| `offset`  | 0       | Skip this many items |

```bash
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?limit=10&offset=20"
```

### Sorting

| Parameter | Default      | Description |
|-----------|-------------|-------------|
| `sort`    | `_createdAt` | Property key to sort by |
| `order`   | `asc`        | `asc` or `desc` |

```bash
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?sort=name&order=desc"
```

### Property filters

Use the `filter.` prefix. Exact match by default, operator suffixes with double underscore:

```bash
# Exact match
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?filter.name=Alice"

# Comparison operators
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?filter.age__gt=25"
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?filter.age__lte=40"

# Substring match (case-insensitive)
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?filter.name__contains=ali"
```

Available operators: `__gt`, `__gte`, `__lt`, `__lte`, `__contains`.

### Text search

The `q` parameter searches all string properties (case-insensitive substring match). Only available on entity list endpoints.

```bash
curl "http://localhost:8000/api/runtime/test_ontology/entities/person?q=alice"
```

## 5. Data Management

Wipe all instance data for an ontology (entities and relations). Schema is preserved.

```bash
curl -X DELETE http://localhost:8000/api/runtime/test_ontology/data
```

Response: `{ "ontologyKey": "test_ontology", "entitiesDeleted": 150, "relationsDeleted": 42 }`

## 6. Validation Errors

Write operations that fail validation return 422 with field-level details:

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

All validation errors are collected and returned at once (not fail-fast). The `fields` map keys are property names; values are human-readable error messages.

Property values are coerced to their schema `dataType` before storage:

| dataType   | Expected input | Example |
|------------|---------------|---------|
| `string`   | String        | `"Alice"` |
| `integer`  | Number or numeric string | `30` |
| `float`    | Number or numeric string | `3.14` |
| `boolean`  | Boolean       | `true` |
| `date`     | ISO date string | `"2024-03-15"` |
| `datetime` | ISO datetime string | `"2024-03-15T10:30:00Z"` |
