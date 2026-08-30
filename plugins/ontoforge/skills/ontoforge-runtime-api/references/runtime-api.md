# OntoForge Runtime API Reference

Bundled reference for building against the OntoForge runtime REST API.

## Addressing

Every runtime call names two keys in its path:

```
/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/...
```

- **Ontology** — the isolated unit: one schema, its lenses, its agents, its saved
  queries and all of its instance data. Nothing spans two ontologies, and there is no
  default: every request names one.
- **Lens** — a named view over that ontology's schema. Runtime reads and writes
  instance data *through* a lens. An unscoped lens exposes the whole schema; a scoped
  lens exposes only the types and properties it names, and everything else is invisible
  through it — absent from schema reads, rejected on write, stripped from query results.

An entity is not "in" a lens. Within its ontology it exists once, and every lens that
includes its type can see it.

An unknown ontology key answers not found before the lens is considered; an unknown lens
key answers not found within the ontology.

The one runtime-relevant route outside this prefix is the feature probe, which describes
the deployment rather than any ontology: `GET /api/server/features`.

## Core Rules

- Base path: `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`
- Feature probe: `GET /api/server/features`
- Everything on this surface is addressed by **keys** — ontology key, lens key, type key,
  property key — plus instance ids for entities and relations. Internal identifiers
  appear on the modeling surface, never here
- Use `Content-Type: application/json` for JSON `POST` and `PATCH` requests
- If type keys or property keys are unknown, inspect the schema first
- Field names are `camelCase`; keys are `lower_snake_case`
- Property filter syntax is `filter.{key}` or `filter.{key}__{op}`
- Supported filter operators: `__gt`, `__gte`, `__lt`, `__lte`, `__contains`
- `fields` is repeated, not comma-separated: `fields=name&fields=email`
- Two query parameters are `snake_case` against the surrounding convention:
  `min_score` on semantic search and on saved-query search

## Listing, Sorting, Filtering

Entity and relation lists share one parameter vocabulary.

| Parameter | Meaning |
|---|---|
| `limit` | Page size, 1–200, default 50 |
| `offset` | Rows to skip, default 0 |
| `sort` | Property key, or `_createdAt` / `_updatedAt`; default `_createdAt`. The underscore may be omitted |
| `order` | `asc` or `desc`, default `asc` |
| `q` | Case-insensitive substring across every `string` property in scope. **Entity lists only**; `document` properties are not searched |
| `filter.{key}[__{op}]` | Property filter, repeatable |

A list response carries `items`, `total`, `limit` and `offset`. `total` is the count
before paging.

Filter values arrive as text and are coerced to the property's declared data type before
comparison; `__contains` is compared as text. An unknown property key, an unknown
operator suffix and an uncoercible value are each rejected.

## Schema Introspection

Read-only, and already filtered to the lens. Use these first when the available entity
types, relation types or property keys are unknown.

- `GET /schema`
  The whole scoped schema in one response.
- `GET /schema/entity-types`
  Entity types visible through the lens.
- `GET /schema/entity-types/{entityTypeKey}`
  One entity type with its visible properties.
- `GET /schema/relation-types`
  Relation types visible through the lens.
- `GET /schema/relation-types/{relationTypeKey}`
  One relation type with `fromEntityTypeKey`, `toEntityTypeKey` and its visible
  properties.

## Entity Instance CRUD

- `POST /entities/{entityTypeKey}`
  Creates an entity.
  Request body: flat JSON object of property values.
  Validation: required properties, no unknown properties, coercion by declared data type.

- `GET /entities/{entityTypeKey}`
  Lists entities of one type.
  Query parameters: `limit`, `offset`, `sort`, `order`, `q`, `fields`,
  `filter.{key}`, `filter.{key}__{op}`

- `GET /entities/{entityTypeKey}/{entityId}`
  Reads one entity.
  Query parameters: `fields`

- `PATCH /entities/{entityTypeKey}/{entityId}`
  Partial update.
  Request body: changed properties only. An explicit `null` clears an optional property;
  `null` on a required property is rejected.

- `DELETE /entities/{entityTypeKey}/{entityId}`
  Deletes the entity **and every relation attached to it**.

Entity list and read always return `_id` regardless of projection.

## Document Properties

Properties with data type `document` hold large text, and are allowed on entity types
only. Entity reads never return their content inline — every entity payload (list, get,
neighbors, search, query results, MCP) replaces the value with a stub:

```json
{"document": true, "length": 1234}
```

Naming the property in an explicit `fields` projection returns the raw value instead.
Writes are unchanged: send the full string as a normal property value.

- `GET /entities/{entityTypeKey}/{entityId}/documents/{propertyKey}`
  Reads document content, whole or by character range.
  Query parameters: `offset`, `limit` (character-based; omit both for the full document)
  Response fields: `propertyKey`, `content`, `offset`, `length`, `totalLength`

- `PATCH /entities/{entityTypeKey}/{entityId}/documents/{propertyKey}`
  Partial write. One route covers both forms, selected by the `op` discriminator in the
  body.

  Exact string replacement:
  ```json
  { "op": "str_replace", "oldString": "…", "newString": "…", "replaceAll": false }
  ```

  Overwrite of a character range, with an optional guard against a stale offset. Insert
  and append are this form with `length: 0`:
  ```json
  { "op": "replace_range", "offset": 0, "length": 12, "content": "…", "expect": "…" }
  ```

## Relation Instance CRUD

- `POST /relations/{relationTypeKey}`
  Creates a relation.
  Request body: `fromEntityId`, `toEntityId`, plus optional relation properties.
  Both endpoints must exist and match the relation type's source and target entity types.

- `GET /relations/{relationTypeKey}`
  Lists relations of one type.
  Query parameters: `limit`, `offset`, `sort`, `order`, `fromEntityId`, `toEntityId`,
  `filter.{key}`, `filter.{key}__{op}`
  Relation lists take **no** `q` and **no** `fields` projection.

- `GET /relations/{relationTypeKey}/{relationId}`
  Reads one relation. No projection.

- `PATCH /relations/{relationTypeKey}/{relationId}`
  Partial update of properties. The endpoints are immutable.

- `DELETE /relations/{relationTypeKey}/{relationId}`
  Deletes only the relation. Its endpoints are untouched.

## Graph Traversal

- `GET /entities/{entityTypeKey}/{entityId}/neighbors`
  The entity plus everything connected to it and the connecting relations.
  Query parameters: `relationTypeKey`, `direction`, `limit`, `fields`, `relationFields`
  `direction` is `outgoing`, `incoming` or `both` (default). `limit` is 1–200, default 50.

Regardless of projection: the centre entity always carries `_id`; neighbour entities
carry `_id` and `_entityTypeKey`; relations carry `_id`, `_relationTypeKey` and
`direction`.

## Semantic Search

- `GET /search/semantic`
  Ranks entities, document passages, or both fused into one ranking.
  Query parameters:
  `q` (required), `type` (optional entity type key), `searchIn` (`entities`, `documents`
  or `all`; default `all`), `snippets` (default `true`), `limit` (1–100, default 10),
  `min_score`, `fields`, `filter.{key}`, `filter.{key}__{op}`

  Omit `type` to search every entity type in the lens at once, in which case every hit
  also carries `_entityTypeKey`.

  Each hit carries `matchedVia`: `{source: "entity", similarity}` for entity-embedding
  matches, or `{source: "document", propertyKey, charOffset, charLength, snippet,
  similarity}` for document-passage matches. Pass `charOffset`/`charLength` as
  `offset`/`limit` to the documents endpoint to read the exact matched passage.

  In `all` mode `score` is a rank-fusion value for ordering only — threshold on
  `matchedVia.similarity`.

  Requires an embedding provider.

## Read-Only OQL Query

- `POST /query`
  Executes one read-only OQL query against the lens.
  Request body — the query text, nothing else:
  ```json
  { "query": "MATCH (p:person) RETURN p LIMIT 10" }
  ```
  The response is columnar: `columns`, an ordered list of column names, plus `results`,
  the rows.

OQL is written entirely in the schema's own type keys and property keys, and is anchored
to the ISO GQL standard and its GPML pattern sublanguage.

- **Clauses**: `MATCH`, `OPTIONAL MATCH`, `WHERE`, `WITH`, `RETURN`, `ORDER BY` with
  `ASC`/`DESC`, `SKIP`, `LIMIT`, and `AS` aliases. At most one `WITH` per query, so a
  pipeline is at most two stages.
- **Predicates**: `=`, `<>`, `<`, `<=`, `>`, `>=`; `AND`, `OR`, `NOT` with parentheses;
  `CONTAINS` (case-sensitive, unlike the `q` and `__contains` filters); `IN`; `IS NULL`
  and `IS NOT NULL`.
- **Functions**: the seven aggregates `count(*)`, `count(x)`, `avg`, `collect`, `max`,
  `min`, `sum` — and no others.
- **Rejected**: every write clause, procedure calls, a node pattern that binds a variable
  but carries no label, and internal labels and relationship types. `XOR` and `UNWIND`
  are rejected too.

Two result rules worth knowing in advance: a `document` property comes back as a stub in
query results, and a relation returned by a query carries no `fromEntityId` and no
`toEntityId` — traverse with `neighbors` or read the relation directly when the endpoints
are needed.

A rejected query reports **every** violation at once, and each rejection names what would
have been valid — so one rejection carries enough to correct the next attempt.

## Saved Queries

Runtime runs them; the modeling surface defines them.

- `GET /saved-queries`
  Lists the lens's saved queries with their parameter definitions.

- `GET /saved-queries/search`
  Finds a saved query by describing what it should do.
  Query parameters: `q`, `limit` (1–20, default 3), `min_score` (default 0.7)
  Ranks descriptions semantically, so it requires an embedding provider.

- `POST /saved-queries/{queryKey}/run`
  Executes a saved query. Parameter values are nested under `params`:
  ```json
  { "params": { "city": "Berlin" } }
  ```

## AI Endpoints

Every route here requires a language-model provider.

- `POST /ai/query`
  Turns a natural-language question into an OQL query and runs it.
  Request body: `question`

- `POST /ai/extract`
  Extracts entities and relations from free text, optionally writing them.
  Request body: `text`, optional `entityTypes`, optional `create` (default `false`)

- `POST /ai/chat`
  Converses with the default agent over the lens.
  Request body: `message`, optional `history` (a list of `{role, content}` with `role`
  either `user` or `assistant`), optional `includeToolCalls`

- `GET /ai/agents`
  Lists the agents configured on this lens. The default agent is implicit — it needs no
  configuration and exists on every lens.

- `POST /ai/agents/{agentKey}/chat`
  Converses with one named agent.

An agent may be granted exactly ten runtime tools: `get_schema`, `list_entities`,
`get_entity`, `list_relations`, `get_neighbors`, `semantic_search`, `execute_query`,
`list_saved_queries`, `run_saved_query`, `search_saved_queries`. Every write tool is
outside that set, and so are the read-only `get_document` and `get_relation`.

### Agent-to-agent

Each named agent gets a card and a task endpoint; the default agent gets one pair at the
`/ai` root.

- `GET /ai/.well-known/agent.json`
- `POST /ai/a2a`
- `GET /ai/agents/{agentKey}/.well-known/agent.json`
- `POST /ai/agents/{agentKey}/a2a`

A card advertises absolute URLs whose host is derived from the request rather than fixed.

## Feature Discovery

- `GET /api/server/features`
  Describes the deployment, not any ontology — it takes no ontology and no lens.
  Response fields: `semanticSearch`, `ai`

Semantic search and the AI routes depend on external providers and are unavailable unless
one is configured. Call this **before** offering either, rather than relying on the
refusal.

## Error Shape

Every error uses one envelope:

```json
{ "error": { "code": "…", "message": "…", "details": { } } }
```

There are exactly six codes:

| Condition | Status | Code | `details` |
|---|---|---|---|
| Resource does not exist | 404 | `RESOURCE_NOT_FOUND` | — |
| Uniqueness or referential conflict | 409 | `RESOURCE_CONFLICT` | — |
| Input rejected | 422 | `VALIDATION_ERROR` | `fields` map or `errors` list |
| Change requires explicit cascade | 409 | `CASCADE_REQUIRED` | `affectedLenses` |
| Unexpected storage failure | 500 | `STORAGE_ERROR` | `errorId` |
| Malformed request body | 400 | `INVALID_JSON` | — |

`details.code` narrows, it does not replace: where it appears, the top-level code stays
one of the six.

The one narrowing that matters on this surface is `FEATURE_DISABLED`. A request needing a
provider that is not configured — semantic search, saved-query search, or any AI route —
answers `422 VALIDATION_ERROR` with `details: {"code": "FEATURE_DISABLED"}`, which is what
separates it from an ordinary rejected request on the same route:

```jsonc
// AI switched off, request well-formed
{"error": {"code": "VALIDATION_ERROR", "message": "AI feature is disabled (AI_PROVIDER not configured)",
           "details": {"code": "FEATURE_DISABLED"}}}

// same route, malformed request
{"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed",
           "details": {"errors": [{"path": "/question", "message": "…"}]}}}
```

Branch on `details.code` to tell a client "this deployment has no AI configured" instead
of reporting a bad request. Listing agents and fetching an agent card never run a model,
so they answer normally even with no provider.

`CASCADE_REQUIRED` belongs to the modeling surface and is listed here only for
completeness of the envelope.

`STORAGE_ERROR` carries an `errorId`, not a cause — the driver message is logged
server-side against that id and never reaches the client.

Validation errors may name field-level detail such as a missing required property, an
unknown property, a coercion failure, or a relation endpoint whose entity type does not
match.

## What Runtime Does Not Offer

Reasonable things to look for that are absent — do not generate calls for them:

| Absent | Consequence |
|---|---|
| Data-wipe endpoint | Instance data is removed one entity or relation at a time. Deleting the whole ontology is the only bulk removal, and that is a registry operation |
| Bulk or batch write | Every create and update is a single object |
| Instance-data export | The design exports; data leaves through listing or queries |
| Health or readiness endpoint | Liveness must be inferred from a real request |
| Cross-lens read | No route sees two lenses at once |
| Cross-ontology anything | No route sees two ontologies at once |
| Schema mutation | Runtime never edits the schema — that is the modeling surface |

## Recommended Build Pattern For Agents

1. Resolve the **ontology key** and the **lens key** — both are required, and neither has
   a default
2. Probe `GET /api/server/features` before using semantic search or any AI route
3. Read the schema endpoints if the type or property shape is not already known
4. Choose the narrowest runtime endpoint that solves the task
5. Generate the request with exact path params, query params and JSON body
6. Only use `/query` when CRUD and search endpoints are not enough
