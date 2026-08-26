# Interfaces

The complete index of every way into the system: two REST surfaces and two MCP servers.
Concepts and vocabulary: [README.md](README.md). Structure and error model:
[architecture.md](architecture.md). What each operation *means* is in
[capabilities/](capabilities/) — this document is the map, not the semantics.

Exact request and response shapes are served by the running system as an OpenAPI
description at `/openapi.json`, with a browsable rendering at `/docs`. No request or
response bodies are reproduced here.

## Conventions

### Route prefixes

| Prefix | Surface |
|---|---|
| `/api/model` | Modeling REST — the global schema and per-lens configuration |
| `/api/runtime` | Runtime REST — instance data through one lens |
| `/mcp/model` | Modeling MCP server |
| `/mcp/runtime` | Runtime MCP server |

### How a lens is addressed

Runtime REST carries the ontology key as the first path segment after the prefix:
`/api/runtime/{ontologyKey}/...`. One route is the exception — `/api/runtime/features`
describes the server, not a lens.

Modeling REST does **not** nest types under an ontology. Entity types, relation types and
their properties are global resources at the top level. Only three things are addressed
per-lens: scope inclusions, agent configurations and saved queries.

### What a path segment identifies

This is the single most common source of mistakes against the modeling surface.

| Surface | Addressed by |
|---|---|
| Runtime REST, everywhere | Keys — ontology key, type key, property key; instance ids for entities and relations |
| Modeling REST — ontologies, entity types, relation types, properties, inclusions | **Internal identifiers**, not keys |
| Modeling REST — agent configs, saved queries | Ontology key, agent key, query key |
| Both MCP servers | Keys only |

So `PUT /api/model/ontologies/{ontologyId}` takes an identifier while
`PUT /api/model/ontologies/{ontologyKey}/ai-agents/{agentKey}` takes a key, even though
the two routes share a prefix. Identifiers are obtained from the response of the create
call or from a list call. A key is never accepted where an identifier is expected.

The same asymmetry appears inside the inclusion routes: adding an inclusion names the type
by **key in the request body**, while updating or removing one names it by **identifier in
the path**.

MCP has no such split — every tool takes keys and resolves them internally.

### JSON shape

Field names are `camelCase` in every REST body and in every MCP result. The values that
name schema elements — type keys, property keys, ontology keys — are `lower_snake_case`,
because keys are a separate namespace from field names. MCP *tool parameters* are
`snake_case`.

Server-managed fields carry a leading underscore and are readable everywhere and writable
nowhere. Their names, and the one field that breaks the underscore convention, are in
[architecture.md](architecture.md#instance-level).

### Listing, sorting, filtering

Entity and relation list routes share one parameter vocabulary.

| Parameter | Meaning |
|---|---|
| `limit` | Page size, 1–200, default 50 |
| `offset` | Rows to skip, default 0 |
| `sort` | Property key, or `_createdAt` / `_updatedAt`; default `_createdAt`. `createdAt` and `updatedAt` are accepted without the underscore |
| `order` | `asc` or `desc`, default `asc` |
| `q` | Case-insensitive substring match across every `string` property in scope; entity lists only, and `document` properties are not searched |
| `filter.<propertyKey>[__<op>]` | Property filter, repeatable |

A list response carries `items`, `total`, `limit` and `offset`. `total` is the count
before paging. String sorting follows the database's default collation.

The complete filter operator set:

| Suffix | Comparison |
|---|---|
| *(none)* | Equal |
| `__gt` | Greater than |
| `__gte` | Greater than or equal |
| `__lt` | Less than |
| `__lte` | Less than or equal |
| `__contains` | Case-insensitive substring |

Filter values arrive as text and are coerced to the property's declared data type before
comparison; `__contains` is compared as text. Non-string values are matched against
their text form — numbers as printed, booleans as `true`/`false`, datetimes as their
ISO-8601 string. An unknown property key, an unknown operator
suffix and an uncoercible value are each rejected. How a filter is evaluated, and the trap
in the suffix rule, are in
[capabilities/instance-data.md](capabilities/instance-data.md#listing). Relation lists
additionally accept `fromEntityId` and `toEntityId`.

Semantic search accepts filters through the same `filter.` syntax, but not all of them, and
not on every request shape — the restrictions and their reasons are in
[capabilities/search.md](capabilities/search.md#property-filters-on-search).

### Field projection

`fields` selects which properties come back. It is repeated rather than comma-separated
(`fields=name&fields=email`). Omitting it returns everything in scope.

| Route | Always returned regardless of projection |
|---|---|
| Entity list, entity read, semantic search | `_id` (plus `_entityTypeKey` on cross-type search) |
| Neighbours — the centre entity | `_id` |
| Neighbours — neighbour entities | `_id`, `_entityTypeKey` |
| Neighbours — relations, via `relationFields` | `_id`, `_relationTypeKey`, `direction` |

Projection has one non-obvious effect: naming a `document` property in `fields` returns its
raw content inline instead of the usual size stub. See
[capabilities/documents.md](capabilities/documents.md).

Projection is available on entity list and read, on neighbours (as `fields` and
`relationFields`) and on semantic search. Relation list and relation read do not take it.

### Naming irregularities

Two query parameters are `snake_case` on the wire where the surrounding convention would
predict otherwise: `min_score` on semantic search and on saved-query search. Neighbouring
parameters on the same routes (`searchIn`, `relationTypeKey`, `relationFields`,
`fromEntityId`, `toEntityId`) are camelCase.

### Errors

Both REST surfaces answer with the single error envelope and the six-code taxonomy defined
in [architecture.md](architecture.md#error-model). Nothing is added per route.

MCP reports the same failures as tool errors. Because a tool error is a single string, the
per-field detail that REST returns under `details.fields` is flattened into the message
text, so a model still sees every offending field in one response.

Requesting a capability whose provider is not configured is a `VALIDATION_ERROR`. Only the
two routes that need an embedding provider — semantic search and saved-query search — mark
it with `details.code` of `FEATURE_DISABLED`; the AI routes do not, so a client cannot tell
a switched-off capability from a bad request there. Call `GET /api/runtime/features` first
rather than relying on the refusal.

## Modeling REST

Prefix `/api/model`. This surface is global; see the addressing note above before using it.
Semantics: [capabilities/schema-modeling.md](capabilities/schema-modeling.md) and
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md).

### Ontologies

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/ontologies` | Create a lens | — |
| GET | `/ontologies` | List all lenses | — |
| GET | `/ontologies/{ontologyId}` | Read one lens | — |
| PUT | `/ontologies/{ontologyId}` | Update name or description; the key is immutable | — |
| DELETE | `/ontologies/{ontologyId}` | Delete a lens; the schema and its data are untouched | — |
| POST | `/ontologies/{ontologyId}/validate` | Check this lens's inclusions against the schema | — |

### Entity types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entity-types` | Create an entity type | — |
| GET | `/entity-types` | List all entity types | — |
| GET | `/entity-types/{entityTypeId}` | Read one entity type | — |
| PUT | `/entity-types/{entityTypeId}` | Update display name or description | — |
| DELETE | `/entity-types/{entityTypeId}` | Delete an entity type and its properties | `cascade` |

### Relation types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/relation-types` | Create a relation type; endpoints are named by entity type key and are fixed | — |
| GET | `/relation-types` | List all relation types | — |
| GET | `/relation-types/{relationTypeId}` | Read one relation type | — |
| PUT | `/relation-types/{relationTypeId}` | Update display name or description | — |
| DELETE | `/relation-types/{relationTypeId}` | Delete a relation type and its properties | `cascade` |

### Property definitions

Identical shape on both owners. There is no route to read a single property definition —
list the owner's properties.

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entity-types/{entityTypeId}/properties` | Define a property on an entity type | `cascade` |
| GET | `/entity-types/{entityTypeId}/properties` | List an entity type's properties | — |
| PUT | `/entity-types/{entityTypeId}/properties/{propertyId}` | Update a property; key and data type are immutable | — |
| DELETE | `/entity-types/{entityTypeId}/properties/{propertyId}` | Remove a property definition | `cascade` |
| POST | `/relation-types/{relationTypeId}/properties` | Define a property on a relation type | `cascade` |
| GET | `/relation-types/{relationTypeId}/properties` | List a relation type's properties | — |
| PUT | `/relation-types/{relationTypeId}/properties/{propertyId}` | Update a property; key and data type are immutable | — |
| DELETE | `/relation-types/{relationTypeId}/properties/{propertyId}` | Remove a property definition | `cascade` |

`cascade` is the explicit second consent for a change that would invalidate a lens. Without
it such a change is refused with `CASCADE_REQUIRED` naming the lenses affected.

### Scope inclusions

The routes that make a lens scoped. A lens with no inclusions exposes the whole schema.

| Method | Path | Purpose |
|---|---|---|
| POST | `/ontologies/{ontologyId}/includes/entity-types` | Include an entity type, optionally narrowed to a property list |
| GET | `/ontologies/{ontologyId}/includes/entity-types` | List the lens's entity type inclusions |
| PUT | `/ontologies/{ontologyId}/includes/entity-types/{entityTypeId}` | Replace an inclusion's property list |
| DELETE | `/ontologies/{ontologyId}/includes/entity-types/{entityTypeId}` | Drop an entity type from the lens |
| POST | `/ontologies/{ontologyId}/includes/relation-types` | Include a relation type, optionally narrowed to a property list |
| GET | `/ontologies/{ontologyId}/includes/relation-types` | List the lens's relation type inclusions |
| PUT | `/ontologies/{ontologyId}/includes/relation-types/{relationTypeId}` | Replace an inclusion's property list |
| DELETE | `/ontologies/{ontologyId}/includes/relation-types/{relationTypeId}` | Drop a relation type from the lens |

An omitted property list means *all properties*; an explicit list must contain every
required property that has no default.

### Agent configurations

Per-lens, addressed by ontology key. Semantics:
[capabilities/ai-agents.md](capabilities/ai-agents.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/ontologies/{ontologyKey}/ai-agents` | List the lens's agent configurations |
| PUT | `/ontologies/{ontologyKey}/ai-agents/{agentKey}` | Create or replace one; answers 201 on create, 200 on replace |
| DELETE | `/ontologies/{ontologyKey}/ai-agents/{agentKey}` | Delete an agent configuration |

### Saved queries

Per-lens, addressed by ontology key. Semantics:
[capabilities/saved-queries.md](capabilities/saved-queries.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/ontologies/{ontologyKey}/saved-queries` | List the lens's saved queries |
| PUT | `/ontologies/{ontologyKey}/saved-queries/{queryKey}` | Create or replace one; answers 201 on create, 200 on replace |
| DELETE | `/ontologies/{ontologyKey}/saved-queries/{queryKey}` | Delete a saved query |

### Schema-wide operations

| Method | Path | Purpose |
|---|---|---|
| POST | `/schema/validate` | Check the global schema and every lens for consistency |
| GET | `/export` | Export the whole schema in the transfer format |
| POST | `/import` | Import a transfer payload |
| POST | `/rebuild-embeddings` | Regenerate every embedding and repair vector index widths |

Rebuild answers with a stream of newline-delimited JSON progress records rather than one
body, because it runs over the whole dataset. It is refused when no embedding provider is
configured. Transfer carries schema only — see
[capabilities/transfer.md](capabilities/transfer.md) and
[capabilities/search.md](capabilities/search.md).

## Runtime REST

One global route, then everything else under `/api/runtime/{ontologyKey}`.

### Server capabilities

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/runtime/features` | Report whether semantic search and AI are available |

The only route on either surface that names no lens. Clients call it before offering
semantic search or AI, since both depend on external providers.

### Schema introspection

Read-only, and already filtered to the lens.

| Method | Path | Purpose |
|---|---|---|
| GET | `/schema` | The whole scoped schema in one response |
| GET | `/schema/entity-types` | Entity types visible through the lens |
| GET | `/schema/entity-types/{entityTypeKey}` | One entity type with its visible properties |
| GET | `/schema/relation-types` | Relation types visible through the lens |
| GET | `/schema/relation-types/{relationTypeKey}` | One relation type with its visible properties |

### Entities

Semantics: [capabilities/instance-data.md](capabilities/instance-data.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entities/{entityTypeKey}` | Create an entity | — |
| GET | `/entities/{entityTypeKey}` | List entities of one type | `limit`, `offset`, `sort`, `order`, `q`, `fields`, `filter.*` |
| GET | `/entities/{entityTypeKey}/{entityId}` | Read one entity | `fields` |
| PATCH | `/entities/{entityTypeKey}/{entityId}` | Partial update; an explicit null clears a property | — |
| DELETE | `/entities/{entityTypeKey}/{entityId}` | Delete an entity and every relation attached to it | — |

### Documents

Semantics: [capabilities/documents.md](capabilities/documents.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/entities/{entityTypeKey}/{entityId}/documents/{propertyKey}` | Read a document property, whole or by character range | `offset`, `limit` |
| PATCH | `/entities/{entityTypeKey}/{entityId}/documents/{propertyKey}` | Partial write | — |

One route covers both partial-write forms, selected by an operation discriminator in the
body: exact string replacement, and overwrite of a character range with an optional guard
against a stale offset. Insert and append are the range form with zero length.

### Neighbours

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/entities/{entityTypeKey}/{entityId}/neighbors` | The entity plus everything connected to it and the connecting relations | `relationTypeKey`, `direction`, `limit`, `fields`, `relationFields` |

`direction` is `outgoing`, `incoming` or `both` (default). `limit` is 1–200, default 50.

### Relations

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/relations/{relationTypeKey}` | Create a relation between two entities | — |
| GET | `/relations/{relationTypeKey}` | List relations of one type | `limit`, `offset`, `sort`, `order`, `fromEntityId`, `toEntityId`, `filter.*` |
| GET | `/relations/{relationTypeKey}/{relationId}` | Read one relation | — |
| PATCH | `/relations/{relationTypeKey}/{relationId}` | Partial update of properties; endpoints cannot change | — |
| DELETE | `/relations/{relationTypeKey}/{relationId}` | Delete a relation; its endpoints are untouched | — |

### Semantic search

Semantics: [capabilities/search.md](capabilities/search.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/search/semantic` | Rank entities, document passages, or both, by meaning | `q`, `type`, `limit`, `min_score`, `searchIn`, `snippets`, `fields`, `filter.*` |

`type` is optional — omit it to search every entity type in the lens at once, in which case
every hit carries `_entityTypeKey`. `searchIn` is `entities`, `documents` or `all`
(default). `limit` is 1–100, default 10. `snippets` defaults to true and controls whether
document hits carry a passage excerpt. Requires an embedding provider.

### Query

Semantics: [capabilities/oql.md](capabilities/oql.md).

| Method | Path | Purpose |
|---|---|---|
| POST | `/query` | Execute one read-only OQL query against the lens |

The response is columnar: an ordered list of column names plus the rows.

### Saved queries

Runtime runs them; modeling defines them. Semantics:
[capabilities/saved-queries.md](capabilities/saved-queries.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/saved-queries` | List the lens's saved queries with their parameter definitions | — |
| GET | `/saved-queries/search` | Find a saved query by describing what it should do | `q`, `limit`, `min_score` |
| POST | `/saved-queries/{queryKey}/run` | Execute a saved query with parameter values | — |

Search ranks saved-query descriptions semantically, so it needs an embedding provider.
`limit` is 1–20, default 3; `min_score` defaults to 0.7.

### AI

Semantics: [capabilities/ai-agents.md](capabilities/ai-agents.md). Every route here
requires a language-model provider.

| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/query` | Turn a natural-language question into an OQL query and run it |
| POST | `/ai/extract` | Extract entities and relations from free text, optionally writing them |
| POST | `/ai/chat` | Converse with the default agent over the lens |
| GET | `/ai/agents` | List the agents configured on this lens |
| POST | `/ai/agents/{agentKey}/chat` | Converse with one named agent |

The default agent is implicit — it needs no configuration and exists on every lens.

### Agent-to-agent

The interoperability surface: a published card describing an agent, and a task endpoint.
Each named agent gets its own pair, and the default agent gets one at the `/ai` root.

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/.well-known/agent.json` | Card for the default agent |
| POST | `/ai/a2a` | Submit a task to the default agent |
| GET | `/ai/agents/{agentKey}/.well-known/agent.json` | Card for one named agent |
| POST | `/ai/agents/{agentKey}/a2a` | Submit a task to one named agent |

A card advertises absolute URLs, whose host is derived rather than fixed. What a card
carries, how its host is resolved and what a proxied deployment must do about it are in
[capabilities/ai-agents.md](capabilities/ai-agents.md#the-card).

## MCP

Two servers, mounted in the same process as REST and calling the same services directly.
Both use the stateless-HTTP, plain-JSON transport required by
[decisions.md](decisions.md#interfaces), so one mount serves many clients and no
connection carries state.

| | Modeling | Runtime |
|---|---|---|
| Mount | `/mcp/model` | `/mcp/runtime`, or `/mcp/runtime/{ontologyKey}` |
| Lens binding | None — the server is global | Exactly one, resolved when the request arrives |
| Tools | 27 | 20 |

### How each resolves a lens

**The modeling server takes no ontology key in its URL.** It is mounted at `/mcp/model`
with nothing after it, and it is global by design, matching the modeling REST surface: the
schema belongs to no lens. The tools that *do* concern a lens — ontology management, scope
inclusions, agent configurations, saved queries — take an `ontology_key` argument instead.
A trailing path segment on this mount is not interpreted as a lens.

The runtime server resolves exactly one lens per request, in this order:

1. the first path segment after `/mcp/runtime`;
2. the `X-Ontology-Key` request header;
3. a configured fallback key.

With none of the three, the request is refused with 400. A tool can therefore never name a
lens or reach across two.

### Modeling tools

| Tool | Purpose |
|---|---|
| `get_schema` | The whole global schema — types, relation types, properties, and every lens with its inclusions, agents and saved queries. Identical to `export_schema`, and the only way to enumerate lenses: there is no `list_ontologies` |
| `create_entity_type` | Add an entity type |
| `update_entity_type` | Change display name or description; the key is immutable |
| `delete_entity_type` | Remove an entity type and its properties |
| `create_relation_type` | Add a relation type between two entity types |
| `update_relation_type` | Change display name or description; endpoints are immutable |
| `delete_relation_type` | Remove a relation type and its properties |
| `add_property` | Define a property on an entity type or a relation type |
| `update_property` | Change a property's metadata; key and data type are immutable |
| `delete_property` | Remove a property definition |
| `validate_schema` | Check the global schema and every lens |
| `export_schema` | Produce a transfer payload |
| `import_schema` | Apply a transfer payload |
| `create_ontology` | Create a lens |
| `update_ontology` | Change a lens's name or description |
| `delete_ontology` | Delete a lens |
| `add_entity_type_to_ontology` | Include an entity type in a lens, optionally narrowed to a property list |
| `remove_entity_type_from_ontology` | Drop an entity type from a lens |
| `add_relation_type_to_ontology` | Include a relation type in a lens, optionally narrowed to a property list |
| `remove_relation_type_from_ontology` | Drop a relation type from a lens |
| `validate_ontology` | Check one lens's inclusions against the schema |
| `list_ai_agents` | List a lens's agent configurations |
| `set_ai_agent` | Create or replace an agent configuration |
| `delete_ai_agent` | Delete an agent configuration |
| `list_saved_queries` | List a lens's saved queries |
| `set_saved_query` | Create or replace a saved query pipeline |
| `delete_saved_query` | Delete a saved query |

`add_property`, `delete_property`, `delete_entity_type` and `delete_relation_type` take a
`cascade` flag with the same meaning as the REST parameter. There is no modeling tool for
rebuilding embeddings.

### Runtime tools

Everything a client can do to instance data through one lens.

| Tool | Purpose |
|---|---|
| `get_schema` | The scoped schema — types, properties, required flags |
| `create_entity` | Create an entity |
| `list_entities` | List entities with search, filters, sorting, paging and projection |
| `get_entity` | Read one entity by id |
| `get_document` | Read a document property, whole or by character range |
| `update_entity` | Partial update; a null clears a property |
| `edit_document` | Change part of a document by exact string replacement |
| `write_document` | Overwrite a character range of a document; also inserts and appends |
| `delete_entity` | Delete an entity and its relations |
| `create_relation` | Connect two entities |
| `list_relations` | List relations, optionally by source or target |
| `get_relation` | Read one relation by id |
| `update_relation` | Partial update of relation properties |
| `delete_relation` | Delete a relation |
| `get_neighbors` | An entity's local neighbourhood, with projection on both entities and relations |
| `execute_query` | Run a read-only OQL query |
| `semantic_search` | Rank entities and document passages by meaning |
| `list_saved_queries` | Discover saved queries and their parameters |
| `run_saved_query` | Execute a saved query with parameter values |
| `search_saved_queries` | Find a saved query by describing what it should do |

An agent configuration may grant exactly ten of them: `get_schema`, `list_entities`,
`get_entity`, `list_relations`, `get_neighbors`, `semantic_search`, `execute_query`,
`list_saved_queries`, `run_saved_query`, `search_saved_queries`. Every write tool is
outside that set, and so are the read-only `get_document` and `get_relation` — being
read-only is not sufficient to be grantable. See
[capabilities/ai-agents.md](capabilities/ai-agents.md).

`write_document` has no REST counterpart of its own: over REST both document edit forms
share one route, selected by the operation in the body.

## What is not exposed

Reasonable things to look for that are absent everywhere — REST, MCP and the web client.

| Absent | Consequence |
|---|---|
| Health or readiness endpoint | Nothing for an orchestrator to probe; liveness must be inferred from a real request |
| Data-wipe endpoint | Instance data is removed one entity or relation at a time |
| Bulk or batch write | Every create and update is a single object; import covers schema, not data |
| Instance-data export | Transfer moves the schema only; data leaves through queries or listing |
| Single-property read on modeling | List the owning type's properties |
| Cross-lens read | No route or tool sees two lenses at once |

Authentication, authorization and multi-tenancy are absent by design and are discussed in
[architecture.md](architecture.md#what-the-architecture-does-not-provide).
