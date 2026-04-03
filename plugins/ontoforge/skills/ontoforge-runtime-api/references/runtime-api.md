# OntoForge Runtime API Reference Map

Use this file as the entry point for runtime REST work.

## Primary Sources

- Full contract: [docs/api-contracts/runtime-api.md](../../../../../docs/api-contracts/runtime-api.md)
- Practical examples: [docs/runtime-usage.md](../../../../../docs/runtime-usage.md)

## How To Use The Docs

1. Start with the full contract for the exact endpoint definition.
2. Use the usage guide when you need concrete `curl` calls, filter syntax, or example payloads.
3. Do not use the modeling API docs for this skill.

## Section Guide

### Schema Introspection

- Full schema: [GET `/schema`](../../../../../docs/api-contracts/runtime-api.md#2-schema-introspection)
- Entity types: [GET `/schema/entity-types` and `/schema/entity-types/{entityTypeKey}`](../../../../../docs/api-contracts/runtime-api.md#2-schema-introspection)
- Relation types: [GET `/schema/relation-types` and `/schema/relation-types/{relationTypeKey}`](../../../../../docs/api-contracts/runtime-api.md#2-schema-introspection)

### Entity CRUD

- Create entity: [POST `/entities/{entityTypeKey}`](../../../../../docs/api-contracts/runtime-api.md#3-entity-instance-crud)
- List/search entities: [GET `/entities/{entityTypeKey}`](../../../../../docs/api-contracts/runtime-api.md#3-entity-instance-crud)
- Get entity: [GET `/entities/{entityTypeKey}/{id}`](../../../../../docs/api-contracts/runtime-api.md#3-entity-instance-crud)
- Update entity: [PATCH `/entities/{entityTypeKey}/{id}`](../../../../../docs/api-contracts/runtime-api.md#3-entity-instance-crud)
- Delete entity: [DELETE `/entities/{entityTypeKey}/{id}`](../../../../../docs/api-contracts/runtime-api.md#3-entity-instance-crud)
- Neighbors: [GET `/entities/{entityTypeKey}/{id}/neighbors`](../../../../../docs/api-contracts/runtime-api.md#5-graph-traversal)

### Relation CRUD

- Create relation: [POST `/relations/{relationTypeKey}`](../../../../../docs/api-contracts/runtime-api.md#4-relation-instance-crud)
- List relations: [GET `/relations/{relationTypeKey}`](../../../../../docs/api-contracts/runtime-api.md#4-relation-instance-crud)
- Get relation: [GET `/relations/{relationTypeKey}/{id}`](../../../../../docs/api-contracts/runtime-api.md#4-relation-instance-crud)
- Update relation: [PATCH `/relations/{relationTypeKey}/{id}`](../../../../../docs/api-contracts/runtime-api.md#4-relation-instance-crud)
- Delete relation: [DELETE `/relations/{relationTypeKey}/{id}`](../../../../../docs/api-contracts/runtime-api.md#4-relation-instance-crud)

### Querying And Search

- Semantic search: [GET `/search/semantic`](../../../../../docs/api-contracts/runtime-api.md#6-semantic-search)
- Read-only Cypher: [POST `/query`](../../../../../docs/api-contracts/runtime-api.md#7-cypher-query)
- Filtering, sorting, pagination, and `q`: [runtime usage guide](../../../../../docs/runtime-usage.md#4-filtering-and-search)

### Runtime Features

- Feature flags: [GET `/api/runtime/features`](../../../../../docs/api-contracts/runtime-api.md#9-feature-discovery)

### AI Runtime Endpoints

- AI query: [POST `/ai/query`](../../../../../docs/api-contracts/runtime-api.md#10-ai-endpoints)
- AI extract: [POST `/ai/extract`](../../../../../docs/api-contracts/runtime-api.md#10-ai-endpoints)
- AI chat and agents: [AI runtime endpoints](../../../../../docs/api-contracts/runtime-api.md#10-ai-endpoints)

### Saved Queries

- List saved queries: [GET `/saved-queries`](../../../../../docs/api-contracts/runtime-api.md#11-saved-queries)
- Search saved queries: [GET `/saved-queries/search`](../../../../../docs/api-contracts/runtime-api.md#11-saved-queries)
- Run saved query: [POST `/saved-queries/{queryKey}/run`](../../../../../docs/api-contracts/runtime-api.md#11-saved-queries)

### Data Management

- Wipe instance data: [DELETE `/data`](../../../../../docs/runtime-usage.md#6-data-management)

## Important Reminders

- Base path: `/api/runtime/{ontologyKey}`
- Runtime REST uses the ontology key in the path.
- `X-Ontology-Key` is relevant for MCP and some other integrations, not normal runtime REST calls.
- If the shape of an entity or relation is unknown, inspect the runtime schema endpoints first.
