# OntoForge Runtime API Reference

Bundled reference for building against the OntoForge runtime REST API.

## Core Rules

- Base path for ontology-scoped calls: `/api/runtime/{ontologyKey}`
- Global runtime feature probe: `GET /api/runtime/features`
- Use the ontology key in the URL path for normal REST calls
- Use `Content-Type: application/json` for JSON `POST` and `PATCH` requests
- If type keys or property keys are unknown, inspect schema first
- Property filter syntax is `filter.{key}` or `filter.{key}__{op}`
- Supported filter operators: `__gt`, `__gte`, `__lt`, `__lte`, `__contains`

## Schema Introspection

Use these first when you do not know the available entity types, relation types, or property keys.

- `GET /api/runtime/{ontologyKey}/schema`
  Returns full ontology metadata, entity types, relation types, and property definitions.
- `GET /api/runtime/{ontologyKey}/schema/entity-types`
  Returns the entity type list.
- `GET /api/runtime/{ontologyKey}/schema/entity-types/{entityTypeKey}`
  Returns one entity type with its property definitions.
- `GET /api/runtime/{ontologyKey}/schema/relation-types`
  Returns the relation type list.
- `GET /api/runtime/{ontologyKey}/schema/relation-types/{relationTypeKey}`
  Returns one relation type with `fromEntityTypeKey`, `toEntityTypeKey`, and property definitions.

## Entity Instance CRUD

- `POST /api/runtime/{ontologyKey}/entities/{entityTypeKey}`
  Creates an entity instance.
  Request body: flat JSON object of schema property values.
  Validation: required properties, no unknown properties, value coercion by schema data type.

- `GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}`
  Lists entity instances.
  Query parameters:
  `limit`, `offset`, `sort`, `order`, `q`, `fields`, `filter.{key}`, `filter.{key}__{op}`

- `GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}`
  Gets one entity instance.
  Query parameters:
  `fields`

- `PATCH /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}`
  Partially updates an entity instance.
  Request body: flat JSON object of changed properties only.
  `null` removes an optional property. `null` on a required property is rejected.

- `DELETE /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}`
  Deletes the entity instance.
  Uses detach-delete semantics, so connected relations are also removed.

## Document Properties

Properties with data type `document` hold large Markdown text. Entity reads never return their content inline — every entity payload (list, get, neighbors, search, query results, MCP) replaces the value with a stub:
`{"document": true, "length": <charCount>}`
Writes are unchanged: send the full string as a normal property value. An explicit `fields` projection naming the property returns the raw value.

- `GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/documents/{propertyKey}`
  Reads document content.
  Query parameters:
  `offset`, `limit` (character-based slicing; omit both for the full document)
  Response fields:
  `propertyKey`, `content`, `offset`, `length`, `totalLength`

## Relation Instance CRUD

- `POST /api/runtime/{ontologyKey}/relations/{relationTypeKey}`
  Creates a relation instance.
  Request body:
  `fromEntityId`, `toEntityId`, plus optional relation properties.
  `fromEntityId` and `toEntityId` must exist and match the relation type's source and target entity types.

- `GET /api/runtime/{ontologyKey}/relations/{relationTypeKey}`
  Lists relation instances.
  Query parameters:
  `limit`, `offset`, `sort`, `order`, `fromEntityId`, `toEntityId`, `filter.{key}`, `filter.{key}__{op}`

- `GET /api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}`
  Gets one relation instance.

- `PATCH /api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}`
  Partially updates a relation instance.
  Request body: relation property changes only.
  `fromEntityId` and `toEntityId` are immutable.

- `DELETE /api/runtime/{ontologyKey}/relations/{relationTypeKey}/{id}`
  Deletes only the relation instance. Connected entities remain.

## Graph Traversal

- `GET /api/runtime/{ontologyKey}/entities/{entityTypeKey}/{id}/neighbors`
  Returns an entity and its connected neighbors.
  Query parameters:
  `relationTypeKey`, `direction`, `limit`, `fields`, `relationFields`
  `direction` is `outgoing`, `incoming`, or `both`.

## Semantic Search

- `GET /api/runtime/{ontologyKey}/search/semantic`
  Searches entity instances by semantic similarity over entity embeddings and document chunks.
  Query parameters:
  `q` (required), `type` (optional entity type key), `searchIn` (`entities`, `documents`, or `all`; default `all`), `snippets` (default `true`), `limit`, `min_score`, `fields`, `filter.{key}`, `filter.{key}__{op}`
  Requires semantic search to be enabled in server config.
  Each hit carries `matchedVia`: `{source: "entity", similarity}` for entity-embedding matches, or `{source: "document", propertyKey, charOffset, charLength, snippet, similarity}` for document-chunk matches. Pass `charOffset`/`charLength` as `offset`/`limit` to the documents endpoint to read the exact matched passage. In `all` mode `score` is a rank-fusion value for ordering only — threshold on `matchedVia.similarity`.

## Read-Only OQL Query

- `POST /api/runtime/{ontologyKey}/query`
  Executes a read-only OQL query (openCypher-shaped syntax over schema type keys) validated against the ontology scope.
  Request body:
  ```json
  { "query": "MATCH (p:person) RETURN p LIMIT 10" }
  ```
  The legacy field name `cypher` is accepted as a deprecated input alias for `query`.
  Allowed: read-oriented clauses like `MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, `SKIP`, `WITH`, `UNWIND`
  Blocked: write clauses, `CALL`, labelless node patterns, reserved internal names

## Runtime Feature Discovery

- `GET /api/runtime/features`
  Returns global runtime feature flags.
  Response fields:
  `semanticSearch`, `ai`

## AI Endpoints

- `POST /api/runtime/{ontologyKey}/ai/query`
  Natural-language question to answer plus generated OQL query and raw results when used.
  Request body:
  `question`

- `POST /api/runtime/{ontologyKey}/ai/extract`
  Extracts structured entities and relations from text.
  Request body:
  `text`, optional `entityTypes`, optional `create`

- `POST /api/runtime/{ontologyKey}/ai/chat`
  Conversational runtime assistant.
  Request body:
  `message`, optional `history`, optional `includeToolCalls`

- `GET /api/runtime/{ontologyKey}/ai/agents`
  Lists the default and configured agents.

- `POST /api/runtime/{ontologyKey}/ai/agents/{agentKey}/chat`
  Agent-specific chat endpoint.

- `GET /api/runtime/{ontologyKey}/ai/.well-known/agent.json`
- `POST /api/runtime/{ontologyKey}/ai/a2a`
- `GET /api/runtime/{ontologyKey}/ai/agents/{agentKey}/.well-known/agent.json`
- `POST /api/runtime/{ontologyKey}/ai/agents/{agentKey}/a2a`
  A2A discovery and task endpoints for default or configured agents.

## Saved Queries

- `GET /api/runtime/{ontologyKey}/saved-queries`
  Lists saved query metadata and parameter definitions.

- `GET /api/runtime/{ontologyKey}/saved-queries/search`
  Searches saved queries semantically.
  Query parameters:
  `q`, `limit`, `min_score`

- `POST /api/runtime/{ontologyKey}/saved-queries/{queryKey}/run`
  Executes a saved query.
  Request body:
  parameters expected by that saved query definition

## Data Management

- `DELETE /api/runtime/{ontologyKey}/data`
  Wipes instance data for the ontology while preserving schema.

## Error Shape

The API uses structured error responses.

- `404` for unknown ontology keys, type keys, relation keys, IDs, or agent keys
- `400` for malformed request patterns such as invalid filter names
- `422` for validation failures, blocked operations, feature-disabled states, or invalid payloads

Validation errors may include field-level details such as:
- missing required property
- unknown property
- type coercion failure
- relation endpoint entity type mismatch

## Recommended Build Pattern For Agents

1. Resolve `ontologyKey`
2. Read schema endpoints if the type or property shape is not already known
3. Choose the narrowest runtime endpoint that solves the task
4. Generate the request with exact path params, query params, and JSON body
5. Only use `/query` when CRUD and search endpoints are not enough
