# Interfaces

The complete index of every way into the system: the ontology registry, two per-ontology
REST surfaces, one server-wide route, and two MCP servers. Concepts and vocabulary:
[README.md](README.md). Structure and error model: [architecture.md](architecture.md).
What each operation *means* is in [capabilities/](capabilities/) — this document is the
map, not the semantics.

Exact request and response shapes are served by the running system as an OpenAPI
description at `/openapi.json`, with a browsable rendering at `/docs`. No request or
response bodies are reproduced here.

## Conventions

### Route prefixes

| Prefix | Surface |
|---|---|
| `/api/ontologies` | Registry — ontologies as whole units |
| `/api/server` | Server — deployment capability reads |
| `/api/ontologies/{ontologyKey}/model` | Modeling REST — one ontology's schema and per-lens configuration |
| `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` | Runtime REST — one ontology's instance data through one lens |
| `/mcp/ontologies/{ontologyKey}/model` | Modeling MCP server, bound to one ontology |
| `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` | Runtime MCP server, bound to one ontology and one lens |

Every ontology-scoped request names its ontology in the path, and an ontology is always
spelled `ontologies/<key>`, a lens always `lenses/<key>` — uniformly across REST, MCP
and the web client's own addresses. There is no header-based addressing and no default
ontology. A request naming an unknown ontology key answers not found before anything
else about it is considered.

### How an ontology and a lens are addressed

The registry addresses ontologies by key. Below one ontology, the modeling surface
addresses the schema; the runtime surface addresses instance data and carries the lens
key as a second path parameter. One request addresses either the schema or instance
data through one lens — never both.

Modeling REST does **not** nest types under a lens. Entity types, relation types and
their properties are resources of the ontology, at the top level of its modeling
surface. Scope inclusions, agent configurations, saved queries and retrievers
are addressed per lens.

### What a path segment identifies

This is the single most common source of mistakes against the modeling surface.

| Surface | Addressed by |
|---|---|
| Registry | Ontology key |
| Runtime REST, everywhere | Keys — ontology key, lens key, type key, property key; instance ids for entities and relations |
| Modeling REST — lenses, entity types, relation types, properties, inclusions | **Internal identifiers**, not keys |
| Modeling REST — agent configs, saved queries, retrievers | Lens key and the resource key |
| Modeling REST — search indices | Index key — managed keys included, which carry `~` |
| Both MCP servers | Keys only |

So `PUT .../model/lenses/{lensId}` takes an identifier while
`PUT .../model/lenses/{lensKey}/assistants/agents/{assistantKey}` takes a key, even though the two
routes share a prefix. Identifiers are obtained from the response of the create call or
from a list call. A key is never accepted where an identifier is expected.

The same asymmetry appears inside the inclusion routes: adding an inclusion names the type
by **key in the request body**, while updating or removing one names it by **identifier in
the path**. A search-index inclusion names the index by key in both places, as every
search-index route does.

MCP has no such split — every tool takes keys and resolves them internally.

### JSON shape

Field names are `camelCase` in every REST body and in every MCP result. The values that
name schema elements — ontology keys, lens keys, type keys, property keys — are
`lower_snake_case`, because keys are a separate namespace from field names. MCP *tool
parameters* are `snake_case`.

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
| `filter.<relationTypeKey>[:out\|:in].<propertyKey>[__<op>]` | Query path — filter by a property of the related entity; entity lists and search, repeatable |
| `filter.<relationTypeKey>[:out\|:in]@<propertyKey>[__<op>]` | Query path — filter by a property stored on the relation itself; entity lists and search, repeatable |
| `filter.<relationTypeKey>[:out\|:in]__exists` / `__missing` | Relation existence — whether any relation of the type exists; entity lists and search, repeatable |

A list response carries `items`, `total`, `limit` and `offset`. `total` is the count
before paging. String sorting follows the database's default collation.

The complete filter operator set:

| Suffix | Condition |
|---|---|
| *(none)* | Equal |
| `__ne` | Present and not equal |
| `__gt` | Greater than |
| `__gte` | Greater than or equal |
| `__lt` | Less than |
| `__lte` | Less than or equal |
| `__contains` | Case-insensitive substring |
| `__exists` | Present (`true`) or absent (`false`) |
| `__missing` | Absent (`true`) or present (`false`) — the readable inverse of `__exists` |

Filter values arrive as text and are coerced to the property's declared data type before
comparison; `__contains` is compared as text. Non-string values are matched against
their text form — numbers as printed, booleans as `true`/`false`, datetimes as their
ISO-8601 string. `__exists` and `__missing` take a boolean flag and no comparison value;
their subject may be a property, a query path, or — on entity lists and search — a bare
relation type, and its data type plays no part. An unknown property key, an unknown operator
suffix, an uncoercible value, a non-boolean existence flag and a relation type under a
comparison operator are each rejected; a request carrying several faulty
filters is rejected once, every fault under its own filter key in `details.fields`. How a
filter is evaluated, and the trap in the suffix rule, are in
[capabilities/instance-data.md](capabilities/instance-data.md#listing). Relation lists
additionally accept `fromEntityId` and `toEntityId`.

A filter key on an entity list, or on search, may be a query path — `filter.works_for.name=Acme` for a
property of the related entity, `filter.works_for@role=CTO` for a property stored on the
relation itself — with the same operator suffixes and the value coerced by the final
property. The direction follows the relation type's endpoints; a `:out` or `:in` marker
on the relation segment must agree with it, and on a self-relation the marker is required
(`filter.manages:out.name=Bob`). An entity matches when at least one relation of the type
satisfies the condition, and every path fault is collected like a property fault; the
rules are in
[capabilities/instance-data.md](capabilities/instance-data.md#query-paths). Under
`__exists` or `__missing` the relation type alone is a filter key —
`filter.supersedes__missing=true` selects the entities no relation of the type reaches —
resolved with the same direction rules
([capabilities/instance-data.md](capabilities/instance-data.md#relation-existence)).
`sort` rejects paths, and relation lists take neither paths nor relation subjects. The
MCP `filters` object takes path and relation keys as ordinary keys.

Semantic search accepts filters through the same `filter.` syntax, but not all of them, and
not on every request shape — the restrictions and their reasons are in
[capabilities/search.md](capabilities/search.md#scope-and-filters).

### Field projection

`fields` selects which properties come back. It is repeated rather than comma-separated
(`fields=name&fields=email`). Omitting it returns everything in scope.

| Route | Always returned regardless of projection |
|---|---|
| Entity list, entity read | `_id` |
| Search | `_id`, `_entityTypeKey` |
| Neighbours — the centre entity | `_id` |
| Neighbours — neighbour entities | `_id`, `_entityTypeKey` |
| Neighbours — relations, via `relationFields` | `_id`, `_relationTypeKey`, `direction` |

Projection has one non-obvious effect: naming a `document` property in `fields` returns its
raw content inline instead of the usual size stub. See
[capabilities/documents.md](capabilities/documents.md).

Projection is available on entity list and read, on neighbours (as `fields` and
`relationFields`) and on search. Relation list and relation read do not take it.

### Naming irregularities

`min_score` on saved-query discovery and `min_similarity` on search are the two
snake_case runtime query parameters.
Other runtime parameters follow their documented names, including kind-prefixed
`document.property` and `filter.<key>`.

### Errors

Every REST surface answers with the single error envelope and the six-code taxonomy
defined in [architecture.md](architecture.md#error-model). Nothing is added per route.

MCP reports the same failures as tool errors. Because a tool error is a single string, the
per-field detail that REST returns under `details.fields` is flattened into the message
text, so a model still sees every offending field in one response.

Requesting an unavailable search strategy, a capability whose provider is not configured,
or one the storage adapter does not support answers `VALIDATION_ERROR` with
`details.code` of `FEATURE_DISABLED` — on the two routes that need an embedding provider,
semantic search and saved-query search, on AI execution and entity identity
comparison alike, and on the search settings, search-index and retriever operations
of an adapter without search indices. A client can therefore
tell a switched-off capability from a rejected request. Model-free operations remain
available: agent discovery and retriever management do not require a
language-model provider; execution requirements are listed with the routes below. Agent
chat requires a language-model provider
([capabilities/agents.md](capabilities/agents.md)).

An assistant thread that is unknown, expired or bound to another assistant answers
`RESOURCE_NOT_FOUND` with `details.code` of `THREAD_NOT_FOUND`; a message to a thread whose
previous message is still being answered answers `RESOURCE_CONFLICT` with `details.code`
of `THREAD_BUSY` ([assistant chat and threads](#assistant-chat-and-threads)).

Call `GET /api/server/features` first all the same. Probing lets a client hide what is
unavailable, rather than offering it and explaining the refusal afterwards.

## Registry

Prefix `/api/ontologies`. Ontologies as whole units — the only surface that manages
them. An ontology is created bare: empty schema, no lenses, no data, and no lens is
auto-created.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ontologies` | Create an ontology — a key plus an optional display name |
| GET | `/api/ontologies` | List every ontology |
| GET | `/api/ontologies/{ontologyKey}` | Read one ontology |
| PATCH | `/api/ontologies/{ontologyKey}` | Rename — the display name only; the key is immutable |
| DELETE | `/api/ontologies/{ontologyKey}` | Hard cascade delete of the ontology and everything it contains |

Keys follow the schema [key](README.md) rule at up to 59 characters and are unique
server-wide, as are display names. Delete is a plain request with no API-level guard —
the web client adds its own confirmation, callers of the API get none.

## Server

Prefix `/api/server`. Read-only capability reads describing the deployment.
Ontology-scoped operations never live here, and server-wide data operations do not
exist.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/server/features` | Report which optional capabilities this deployment offers |

The one route that concerns neither the ontologies nor their content — it describes the
deployment. Clients call it before offering optional capabilities.

| Field | Type | Reports |
|---|---|---|
| `semanticSearch` | boolean | An embedding provider is configured |
| `searchStrategies` | list | The available search strategies, in preference order |
| `ai` | boolean | A language-model provider is configured; gates the `/ai` routes |
| `decisions` | boolean | A Decision provider is configured; gates the `/decisions` routes |
| `searchIndices` | boolean | The storage adapter supports search indices |

## Modeling REST

Prefix `/api/ontologies/{ontologyKey}/model`. This surface covers one ontology's whole
schema; see the addressing note above before using it. Semantics:
[capabilities/schema-modeling.md](capabilities/schema-modeling.md) and
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md).

### Lenses

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/lenses` | Create a lens | — |
| GET | `/lenses` | List the ontology's lenses | — |
| GET | `/lenses/{lensId}` | Read one lens | — |
| PUT | `/lenses/{lensId}` | Update name or description; the key is immutable | — |
| DELETE | `/lenses/{lensId}` | Delete a lens; the schema and its data are untouched | — |
| POST | `/lenses/{lensId}/validate` | Check this lens's inclusions against the schema | — |

### Entity types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entity-types` | Create an entity type together with its name property (`nameProperty`, default `name`) | — |
| GET | `/entity-types` | List the ontology's entity types | — |
| GET | `/entity-types/{entityTypeId}` | Read one entity type | — |
| PUT | `/entity-types/{entityTypeId}` | Update display name, description or name property (`nameProperty`) | — |
| DELETE | `/entity-types/{entityTypeId}` | Delete an entity type and its properties | `cascade` |

### Relation types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/relation-types` | Create a relation type; endpoints are named by entity type key and are fixed | — |
| GET | `/relation-types` | List the ontology's relation types | — |
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
| DELETE | `/entity-types/{entityTypeId}/properties/{propertyId}` | Remove a property definition; refused for the type's name property | `cascade` |
| POST | `/relation-types/{relationTypeId}/properties` | Define a property on a relation type | `cascade` |
| GET | `/relation-types/{relationTypeId}/properties` | List a relation type's properties | — |
| PUT | `/relation-types/{relationTypeId}/properties/{propertyId}` | Update a property; key and data type are immutable | — |
| DELETE | `/relation-types/{relationTypeId}/properties/{propertyId}` | Remove a property definition | `cascade` |

`cascade` is the explicit second consent for a change that would invalidate a lens or
reach a custom search index. Without it such a change is refused with `CASCADE_REQUIRED`,
whose `details` name the lenses affected (`affectedLenses`) and the custom indices
(`affectedIndices`), each a sorted list of keys
([capabilities/schema-modeling.md](capabilities/schema-modeling.md#the-cascade-protocol)).

### Scope inclusions

The routes that make a lens scoped — its type inclusions — and those that choose the search
indices it searches. A lens with no type inclusions exposes the whole schema.

| Method | Path | Purpose |
|---|---|---|
| POST | `/lenses/{lensId}/includes/entity-types` | Include an entity type, optionally narrowed to a property list |
| GET | `/lenses/{lensId}/includes/entity-types` | List the lens's entity type inclusions |
| PUT | `/lenses/{lensId}/includes/entity-types/{entityTypeId}` | Replace an inclusion's property list |
| DELETE | `/lenses/{lensId}/includes/entity-types/{entityTypeId}` | Drop an entity type from the lens |
| POST | `/lenses/{lensId}/includes/relation-types` | Include a relation type, optionally narrowed to a property list |
| GET | `/lenses/{lensId}/includes/relation-types` | List the lens's relation type inclusions |
| PUT | `/lenses/{lensId}/includes/relation-types/{relationTypeId}` | Replace an inclusion's property list |
| DELETE | `/lenses/{lensId}/includes/relation-types/{relationTypeId}` | Drop a relation type from the lens |
| POST | `/lenses/{lensId}/includes/search-indices` | Include a search index, named by `key`; 201 |
| GET | `/lenses/{lensId}/includes/search-indices` | List the lens's search-index inclusions, each as `{key}`, in key order |
| DELETE | `/lenses/{lensId}/includes/search-indices/{indexKey}` | Drop a search index from the lens; 204 |

An omitted property list means *all properties*; an explicit list must contain every
required property that has no default.

Search-index inclusions never make a lens scoped, and take effect for search at once. An
unknown lens or index, or removing an index the lens does not include, is not found;
including an index twice is a conflict. A lens with entity type inclusions that does not
include the index's root entity type answers `VALIDATION_ERROR` at `details.fields.key`.
The three routes answer `FEATURE_DISABLED` on an adapter without search indices. Rules:
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md#search-through-a-lens).

### Agent configurations

Per-lens, addressed by lens key and assistant key. Semantics:
[capabilities/agents.md](capabilities/agents.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/lenses/{lensKey}/assistants/agents` | List the lens's agent configurations |
| GET | `/lenses/{lensKey}/assistants/agents/{assistantKey}` | Read one agent configuration |
| PUT | `/lenses/{lensKey}/assistants/agents/{assistantKey}` | Create or replace one; answers 201 on create, 200 on replace |
| DELETE | `/lenses/{lensKey}/assistants/agents/{assistantKey}` | Delete an agent configuration |

The built-in default agent is not a modeling resource: it is not listed, and `_default`
can be neither read nor written here.

### Saved queries

Per-lens, addressed by lens key. Semantics:
[capabilities/saved-queries.md](capabilities/saved-queries.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/lenses/{lensKey}/saved-queries` | List the lens's saved queries |
| PUT | `/lenses/{lensKey}/saved-queries/{queryKey}` | Create or replace one; answers 201 on create, 200 on replace |
| DELETE | `/lenses/{lensKey}/saved-queries/{queryKey}` | Delete a saved query |

### Retrievers

Per-lens, addressed by lens key and assistant key. Semantics, configuration and validation:
[capabilities/retrievers.md](capabilities/retrievers.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/lenses/{lensKey}/assistants/retrievers` | List the lens's retrievers, by name, each with its current validation |
| GET | `/lenses/{lensKey}/assistants/retrievers/{assistantKey}` | Read one retriever as stored, with its current validation |
| PUT | `/lenses/{lensKey}/assistants/retrievers/{assistantKey}` | Create or replace; 201 on create, 200 on replace |
| DELETE | `/lenses/{lensKey}/assistants/retrievers/{assistantKey}` | Delete the retriever; 204 |
| POST | `/lenses/{lensKey}/assistants/retrievers/{assistantKey}/copy` | Independent copy to `targetLensKey`/`targetKey` in this ontology; 201 |
| POST | `/lenses/{lensKey}/assistants/retrievers/{assistantKey}/move` | Move to `targetLensKey`/`targetKey` in this ontology, identity kept; 200 |
| GET | `/lenses/{lensKey}/assistants/retrievers/{assistantKey}/export` | The retriever's portable JSON |
| POST | `/lenses/{lensKey}/assistants/retrievers/import` | Create from portable JSON; 201, never replaces a key |

A write carries `name`, optional `description`, `configVersion: 2` and `config`; unknown
fields are rejected. A read carries `key`, `lensKey`, `name`, `description`,
`configVersion`, `config`, `validation: {valid, errors, warnings}`, `createdAt` and
`updatedAt`. The portable JSON is `{key, name, description, configVersion, config}`;
import also accepts `configVersion: 1`, converted first. A configuration the lens cannot
run — on write, import, or copy or move into the target lens — is refused with
`VALIDATION_ERROR` and the errors under `details.errors`; a taken target key, or a source
changed since it was read, is a conflict. Management calls no model. Every route answers
`FEATURE_DISABLED` on an adapter without search indices. The built-in default retriever
is not a modeling resource, as for agents.

### Search settings

The ontology's keyword language set and its managed-index switches. Semantics:
[capabilities/search.md](capabilities/search.md#keyword-language) and
[capabilities/search-indices.md](capabilities/search-indices.md#managed-indices).

| Method | Path | Purpose |
|---|---|---|
| GET | `/search-settings` | Read `keywordLanguages` and `disabledIndices`, the managed indices switched off |
| PUT | `/search-settings` | Change either or both; an absent field stays as it is. Answers the settings now in force |

A PUT is validated whole before anything is written; field errors name `keywordLanguages`
or `disabledIndices.<i>` for a key that names no managed index. Both routes answer
`FEATURE_DISABLED` on an adapter without search indices.

### Search indices

Managed and custom search indices, addressed by index key. Semantics:
[capabilities/search-indices.md](capabilities/search-indices.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/search-indices` | List every index — managed and custom, in key order — with its status | — |
| POST | `/search-indices/preview` | Validate a draft definition, estimate its build cost and outline its entries, without saving; the key may be omitted | — |
| POST | `/search-indices` | Create a custom index; 201 | — |
| GET | `/search-indices/{indexKey}` | Read one index with its status | — |
| PUT | `/search-indices/{indexKey}` | Replace a custom index's definition | — |
| DELETE | `/search-indices/{indexKey}` | Delete a custom index with its entries; 204 | `cascade` |
| GET | `/search-indices/{indexKey}/status` | Read an index's build status | — |
| POST | `/search-indices/{indexKey}/rebuild` | Start new generations of an index; 202 with its status | — |

A request body is a definition in the index wire format. An index reads as `key`,
`kind` (`default`, `passage` or `custom`), `enabled` (false for a switched-off managed
index), `definition`, `documentProperty` (the document field it cuts into passages, or
null), `status` and timestamps. A status carries `state`, `representations` — each
enabled one with `representation`, `state`, `done`, `total`, `pending` and `failed` —
and `lastErrors`, each with `entityId`, `partKind`, `message` and `at`.

A preview answers `{valid, issues, estimate, outline}`: `issues` as `{path, message}` by
dotted path, `estimate` null for an invalid draft, else `entities`, `entries`, `seconds`
and `perRepresentation` — each with `representation`, `entries`, `seconds` and
`measured`. `outline` is null when the parts it reads are not well-shaped, else the
[entry outline](capabilities/search-indices.md#entry-outline), one part per entry kind
with `partKind`, `groupNo`, `relationType`, `direction`, `targetType` (null for the own
entry and passages), `semanticText`, `keywordText`, `template` (`none`, `rendered` or
`fallback`) and `unresolved`. An invalid draft is never refused.

Create and replace answer an invalid definition with `VALIDATION_ERROR`, `details.fields`
keyed by dotted path (`relations.0.target.company`). The wire format is closed: an unknown
field is refused at the object that carries it — `definition` at the top level,
`relations.<i>`, `semantic` or `keyword` below — and is a preview issue at the same path.
A key with `~` is refused at `key`, and so is a replacement whose body names another key
than the path. A taken key is a
conflict. Replacing or deleting a managed index is a conflict — managed indices are only
switched, in the search settings — and so is rebuilding a switched-off one. Deleting an
index a lens includes without `cascade` answers `CASCADE_REQUIRED`. Every route answers
`FEATURE_DISABLED` on an adapter without search indices.

### Schema-wide operations

Schema-wide means ontology-wide: each of these covers the addressed ontology and nothing
beyond it.

| Method | Path | Purpose |
|---|---|---|
| POST | `/schema/validate` | Check the ontology's schema and every lens for consistency |
| GET | `/export` | Export the ontology's design in the transfer format |
| POST | `/import` | Import a transfer payload into this ontology |
| POST | `/rebuild-search-data` | Rebuild the saved-query description vectors and repair the width of their vector index |

Both validation operations — this one and `POST /lenses/{lensId}/validate` — always answer
`{valid, errors, warnings}`, each error and warning a `{path, message}` with a dotted
path. Warnings never make the result invalid; they name what limits the search indices a
lens includes
([capabilities/ontology-lenses.md](capabilities/ontology-lenses.md#validation-warnings)).

Rebuild answers with a stream of newline-delimited JSON progress records rather than one
body, because it can run over many items. It is never refused for a missing embedding
provider: without one it skips the vector work and says so in its summary. It does not
touch search indices. After an embedding-provider switch it is run once per ontology. See
[capabilities/search.md](capabilities/search.md#rebuild).

Transfer carries the design only — schema, lenses, agents, saved queries, retrievers,
search indices; no instance
data and no ontology identity — see
[capabilities/transfer.md](capabilities/transfer.md) and
[capabilities/search.md](capabilities/search.md).

## Runtime REST

Everything under `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. An unknown
ontology key answers not found before the lens is considered; an unknown lens key
answers not found within the ontology.

### Schema introspection

Read-only, and already filtered to the lens. `/schema` returns the lens's key, name and
description together with the entity types and relation types it exposes, each with its
visible properties.

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

### Search

Semantics: [capabilities/search.md](capabilities/search.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/search` | Rank entities by properties, document passages, or both | `q`, `type`, repeatable `in`, `strategy`, `min_similarity`, `document.property`, `limit`, `fields`, `filter.*` |
| GET | `/search-indices` | The lens's search catalog: the indices it can search, projected through it | — |
| POST | `/search` | Rank entities through chosen search indices | body: `indices`, `query`, `mode`, `relations`, `filters`, `minScore`, `limit`, `fields` |

`q` is required. Omit `type` for cross-type search; `in` accepts `properties` and
`document`, defaulting to both. `strategy` accepts `semantic`, `keyword`, `keyword-any`,
`keyword-all`, `hybrid`, defaulting to the best available; `keyword` and `hybrid` use the
default keyword matching, while `keyword-any` and `keyword-all` each fix one. `document.property` restricts document search only and
requires that kind. `min_similarity`, 0–1, drops semantic candidates measured below it
and needs a strategy that ranks semantically. `limit` counts entities, 1–100, default 10.
Filters also work across types, narrowing the searched set. The response carries `query`,
`type`, `in`, `strategy`, `minSimilarity`, `filter`, `hits`; each hit has an entity, a
within-response relative score, matches and `matched`. Matches — one per index that found
the entity — carry nullable semantic/keyword evidence including the keyword score.
`matched` names the entry that matched best: `index`, `partKind`, `relationType`,
`relationId`, `target`, `snippet`, `charOffset`, `charLength`. Scores are not confidence.
Evidence scope, `matched` and null semantics are defined in
[the search response contract](capabilities/search.md#response).

The catalog lists, in key order, each index as `key`, `kind` (`default`, `passage` or
`custom`), `name`, `description`, `entityType`, `fields`, `relations` — each
`{relationType, direction, label}` — `documentProperty` (null when none), `modes` and
`status`. Rules: [capabilities/search.md](capabilities/search.md#the-search-catalog).

`POST /search` takes a JSON body. `query` is required; `indices` names index keys and
defaults to every index the lens can search; `mode` accepts `semantic`, `keyword` or
`hybrid` and defaults to the first available; `relations` lists relation types whose
relation entries count; `filters` carries the `filter.*` keys of `GET /search` without
the prefix, query paths included, each with a string value; `minScore`, 0–1, needs a
mode that ranks semantically; `limit` counts entities, 1–100, default 10; `fields`
projects each entity. The response carries `query`, `mode` and `hits`, each hit
`entity`, `relativeScore` and `matched`. An unknown index key answers not found. A body
of the wrong shape, or with a field not listed here, is rejected with `details.errors`;
the request's rules — an index the lens cannot search at `indices.<i>`, a relation type
at `relations.<i>` — are collected under `details.fields`; a mode that needs a missing embedding provider answers
`FEATURE_DISABLED`. Rules:
[capabilities/search.md](capabilities/search.md#index-search).

Both routes answer `FEATURE_DISABLED` on an adapter without search indices; `GET /search`
works on every adapter.

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

Run takes the parameter values in the body under `params`, keyed by parameter key, for
example `{"params": {"hall": "2"}}`; a query without parameters accepts an empty body.

Search ranks saved-query descriptions semantically, so it needs an embedding provider.
`limit` is 1–20, default 3; `min_score` defaults to 0.7. The bare result array keeps
`key`, `name`, `description`, `parameters` and absolute cosine `score` (0–1).

### Entity identity comparison

Semantics and request/response contract:
[capabilities/entity-identity-comparison.md](capabilities/entity-identity-comparison.md).
Requires a Decision provider, independently of AI and search.

| Method | Path | Purpose |
|---|---|---|
| POST | `/decisions/compare-entities` | Judge the identity of two supplied partial snapshots of one scoped entity type |

### Assistant chat and threads

Every assistant kind — `agents`, `retrievers` — converses through the same request, the
same stream frame and the same threads. Semantics:
[capabilities/threads.md](capabilities/threads.md). The kind's own section below lists its
routes, its extra request fields and its own events.

| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/assistants/<kind>/{assistantKey}/chat` | One message: a new thread, or a turn on an existing one |
| GET | `/ai/assistants/<kind>/{assistantKey}/threads/{threadId}` | Read a thread back |

**Request.** `message` (1 to 2,000 characters) and optionally `threadId`; a kind may add
fields, and unknown fields are rejected. Without `threadId` the message starts a new
thread bound to the addressed assistant; with it, the message continues that thread. A
thread that is unknown, expired or bound to another assistant answers
`RESOURCE_NOT_FOUND` with `details.code` `THREAD_NOT_FOUND`; a thread whose previous
message is still being answered answers `RESOURCE_CONFLICT` with `details.code`
`THREAD_BUSY`. Both are plain error responses before the stream opens, like every other
refusal the kind lists; a busy message is never queued.

**Stream.** Successful responses use `application/x-ndjson`: one complete JSON object per
line, each with a `type`. The shared events mean the same for every kind:

| Event `type` | Fields | Meaning |
|---|---|---|
| `thread` | `threadId` | Always first: the thread this turn runs on |
| `delta` | `text` | A fragment of the answer, for kinds that stream their answer |
| `final` | `reply` | Terminal: the complete answer |
| `error` | `error` | Terminal: the public error object with `code`, `message` and optional `details` |

A kind's own events are named `<kind>.<event>` — `agent.…`, `retriever.…`; a client may
ignore those it does not know. A writable stream has exactly one terminal `final` or
`error`; EOF without one means an incomplete turn. A closed connection cancels the turn,
and a cancelled or failed turn leaves nothing in its thread. Unexpected failures after
streaming begins have the generic `INTERNAL_ERROR` message `Internal Server Error`.
Delivery bounds buffering and terminates stalled or oversized streams.

**Read a thread.** `200` with `threadId` and `messages` — the user messages and the
assistant's answers in order, each `role` (`user` or `assistant`) and `content`, at most
the turns a thread keeps, without tool payloads. Unknown, expired or another assistant's
thread: `THREAD_NOT_FOUND`. Reading needs no language-model provider and does not count as
use; it is gated like the kind's list.

### Retriever list, chat and retrieve

The stored retriever runs — or, under the key `_default`, the lens's
[default retriever](capabilities/retrievers.md#the-default-retriever);
a request can never supply or override its configuration. Semantics:
[capabilities/retrievers.md](capabilities/retrievers.md#answering-a-question)
and [retrieve](capabilities/retrievers.md#retrieve).

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/retrievers` | List the lens's retrievers, the default first |
| POST | `/ai/assistants/retrievers/{assistantKey}/chat` | Stream the answer to one question |
| GET | `/ai/assistants/retrievers/{assistantKey}/threads/{threadId}` | Read a thread back |
| POST | `/ai/assistants/retrievers/{assistantKey}/retrieve` | The entities one query finds, without an answer |

**List.** Every retriever of the lens, runnable or not, as `key`, `name`,
`description` and `builtIn`; the default comes first, keyed `_default`, named `Default`,
with `builtIn` true. The list carries no configuration and no validation, and needs no
language-model provider; on an adapter without search indices it answers
`FEATURE_DISABLED`.

**Chat.** The [shared request](#assistant-chat-and-threads) plus `diagnostics` (boolean,
default false). Without a language-model provider the route answers
`FEATURE_DISABLED`, as the AI routes do. An unknown retriever answers not found, a retriever its
lens can no longer run `VALIDATION_ERROR` with the errors under `details.errors`, a
default retriever with nothing to search `VALIDATION_ERROR`, an adapter without search
indices `FEATURE_DISABLED`, an unknown or busy thread as shared — each before the stream
opens.

The response streams the [shared frame](#assistant-chat-and-threads): `thread`, the answer
as `delta` events, then one terminal `final` or `error`. Its own events:
`retriever.phase` (`phase` `plan`, `retrieve` or `answer`, `status` `start` or `end`, an
end with `durationMs`), and — only with `diagnostics` true — `retriever.diagnostics`
events, which carry:

| Field | Content |
|---|---|
| `plan` | `subQueries` — each `indices`, `relations`, `query`, `variants`, `mode`, `filters` (`id`, `value`, `quote`) and `previous` — and `unsupportedReason` |
| `results` | One row per entity and sub-query that found it, in fused order: `entityId`, `entityType`, `label`, `subQuery`, `matched` when the search ranked the entity, `answerFields` |
| `limitations` | What the answer model was told limits the results |
| `searchCalls` | The number of index searches run |
| `timings` | Milliseconds: `plan`, `retrieve`, `answer`, `planModel`, `validation`, `search`, `context`, `firstDelta`, `answerModel`, `total`; `planModel` and `validation` add up both planning calls when planning was repeated |
| `modelIO` | Bounded system prompt, input and output traces of every model call, each with its `phase` — `plan`, `replan` for a follow-up's repeated planning, `answer` — and with usage and finish reason where the provider reports them |
| `llmCalls` | The number of model calls: 2, or 3 when planning was repeated |

`matched` has the form of a search hit's ([capabilities/search.md](capabilities/search.md#response)).

**Read a thread.** As [shared](#assistant-chat-and-threads); on an adapter without search
indices it answers `FEATURE_DISABLED`, as the list does.

**Retrieve.** The body carries `query` (1 to 2,000 characters); unknown fields — a thread
id or `diagnostics` among them — are rejected.
It is refused exactly as chat is, with plain error responses: `FEATURE_DISABLED` without
a language-model provider or on an adapter without search indices, not found for an
unknown retriever, `VALIDATION_ERROR` for a retriever its lens can no longer run (errors under
`details.errors`), a default retriever with nothing to search, a planner input over the cap,
a failed planning call or a malformed plan. A closed connection cancels the work.

The response is `200` with `results` — best first, each `entityId`, `entityType`,
`label`, `conditions` (`filter`, `value`, `text`) and `matched` (a search hit's form, or
null) — `limitations` and `unsupportedReason` when no index can answer. No results is not
an error.

A question or a retrieve needs a language-model provider; without an embedding provider it
searches by keyword only. Neither route has an MCP equivalent.

### AI

Semantics: [capabilities/agents.md](capabilities/agents.md). Chat requires a
language-model provider; the list remains available without one.

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/agents` | List the lens's agents, the default first |
| POST | `/ai/assistants/agents/{assistantKey}/chat` | Converse with one agent |
| GET | `/ai/assistants/agents/{assistantKey}/threads/{threadId}` | Read a thread back |

The default agent is implicit — it needs no configuration, exists on every lens and is
addressed by the key `_default` like any configured agent. The list names every agent as
`key`, `name`, `description` and `builtIn`; the default comes first, named `Default`, with
`builtIn` true.

Chat takes the [shared request](#assistant-chat-and-threads) and streams the shared frame:
`thread`, then the agent's tool events, then one terminal `final` or `error`; the answer
arrives whole in `final`, never as `delta`. Tool events are unconditional; there is no
response-mode option.

| Event `type` | Fields | Meaning |
|---|---|---|
| `agent.tool_call` | `callId`, `tool`, `args` | One invocation begins, including schema-invalid arguments |
| `agent.tool_result` | `callId`, `result` | That invocation completes; result retains its native JSON structure |

Call IDs are unique within a turn. Calls precede their results, and parallel results arrive
as each completes. An unknown agent, an unavailable provider and an unknown or busy thread
are rejected before streaming, using the ordinary HTTP error response. Disconnect cancels
further agent work, with best-effort cancellation of running operations. Reading a thread
needs no provider, as the list does.

## MCP

Two servers, mounted in the same process as REST and calling the same services directly.
Both use the stateless-HTTP, plain-JSON transport required by
[decisions.md](decisions.md#interfaces), so one mount serves many clients and no
connection carries state.

| | Modeling | Runtime |
|---|---|---|
| Mount | `/mcp/ontologies/{ontologyKey}/model` | `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` |
| Bound to | One ontology | One ontology and one lens |
| Tools | 45 | 22 |

### How a mount is bound

**The URL is the only binding channel.** Each mount names its scope in its own address —
there is no request header and no configured fallback, and no tool takes an ontology or
lens argument. A URL that names no ontology (or, for runtime, no lens) is an unknown
route and answers the standard not-found error. One MCP client configuration entry per
ontology is the intended shape.

A bound client can never reach, list, or infer another ontology's existence: the binding
is fixed in the URL, and no mount exposes the registry. Ontology management — listing,
creating under an arbitrary key, renaming, deleting — is REST and web UI only, with one
carve-out: the modeling mount's `ensure_ontology` tool, which acts only on the mount's
own binding.

The modeling mount serves requests even when its ontology does not exist yet — that is
what lets `ensure_ontology` provision it; until then every other tool answers a
not-found tool error. The runtime mount requires both its ontology and its lens to
exist; its tools answer not-found tool errors otherwise.

### Modeling tools

| Tool | Purpose |
|---|---|
| `ensure_ontology` | Create the ontology this mount is bound to if it does not exist yet; no-op if it does. Argument-less — it acts only on the mount's own ontology — and reports the key and whether it created. A created ontology starts bare and without a display name; naming is a REST/UI operation |
| `get_schema` | The ontology's whole design — types, relation types, properties, the keyword language set, the custom search indices and the switched-off managed ones, and every lens with its type inclusions, its search-index inclusions (`indexInclusions`), agents, saved queries and retrievers. Identical to `export_schema`, and the only way to enumerate lenses: there is no `list_lenses` |
| `create_entity_type` | Add an entity type together with its name property (`name_property`, default `name`) |
| `update_entity_type` | Change display name, description or name property (`name_property`); the key is immutable |
| `delete_entity_type` | Remove an entity type and its properties |
| `create_relation_type` | Add a relation type between two entity types |
| `update_relation_type` | Change display name or description; endpoints are immutable |
| `delete_relation_type` | Remove a relation type and its properties |
| `add_property` | Define a property on an entity type or a relation type |
| `update_property` | Change a property's metadata; key and data type are immutable |
| `delete_property` | Remove a property definition; refused for an entity type's name property |
| `validate_schema` | Check the ontology's schema and every lens |
| `export_schema` | Produce a transfer payload |
| `import_schema` | Apply a transfer payload |
| `get_search_settings` | Read the keyword language set and the managed indices switched off |
| `set_search_settings` | Change `keyword_languages` and/or `disabled_indices`, as the REST route does |
| `list_search_indices` | List every search index, managed and custom, with its status |
| `get_search_index` | Read one search index with its status |
| `preview_search_index` | Validate a draft definition, estimate its build cost and outline its entries, without saving |
| `create_search_index` | Create a custom search index from a `definition` |
| `update_search_index` | Replace a custom search index's `definition`; the key cannot change |
| `delete_search_index` | Delete a custom search index |
| `get_search_index_status` | Read a search index's build status |
| `rebuild_search_index` | Start new generations of a search index and return its status |
| `create_lens` | Create a lens |
| `update_lens` | Change a lens's name or description |
| `delete_lens` | Delete a lens |
| `add_entity_type_to_lens` | Include an entity type in a lens, optionally narrowed to a property list |
| `remove_entity_type_from_lens` | Drop an entity type from a lens |
| `add_relation_type_to_lens` | Include a relation type in a lens, optionally narrowed to a property list |
| `remove_relation_type_from_lens` | Drop a relation type from a lens |
| `add_search_index_to_lens` | Include a search index in a lens, by `index_key` |
| `remove_search_index_from_lens` | Drop a search index from a lens, by `index_key` |
| `validate_lens` | Check one lens's inclusions against the schema; warnings name what limits its search indices |
| `list_agents` | List a lens's agents |
| `get_agent` | Read one agent, by `agent_key` |
| `set_agent` | Create or replace an agent |
| `delete_agent` | Delete an agent, by `agent_key` |
| `list_retrievers` | List a lens's retrievers, each with its validation |
| `get_retriever` | Read one retriever with its validation, by `retriever_key` |
| `set_retriever` | Create or replace a retriever from a `config` in the REST wire format; an invalid configuration is refused with every error in one message |
| `delete_retriever` | Delete a retriever, by `retriever_key` |
| `list_saved_queries` | List a lens's saved queries |
| `set_saved_query` | Create or replace a saved query pipeline |
| `delete_saved_query` | Delete a saved query |

The per-lens tools take a `lens_key` naming a lens of the bound ontology.
`add_property`, `delete_property`, `delete_entity_type`,
`delete_relation_type` and `delete_search_index` take a `cascade` flag with the same
meaning as the REST parameter. The search-index tools take the index key as
`index_key` and a definition in the same wire format as REST, camelCase included.
`set_retriever` writes the current configuration version, so it takes no version argument;
the retriever tools are refused as a disabled feature where the adapter has no search
indices. Copying, moving, exporting and importing a single retriever are REST only.
There is no modeling tool for the search-data rebuild (`rebuild-search-data`).

### Runtime tools

Everything a client can do to instance data through one lens.

| Tool | Purpose |
|---|---|
| `get_schema` | The scoped schema, as REST `/schema` returns it — the lens's key, name and description; types, properties, required flags, name properties |
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
| `list_search_indices` | The lens's search catalog, to choose indices for `search_by_index` |
| `search` | Rank entities by properties and documents, using the default strategy and the fixed similarity floor |
| `search_documents` | Rank entities by document passages under the same defaults; optionally restrict to one property |
| `search_by_index` | Rank entities through the named search indices, or every index of the lens, under the default mode and the same fixed floor |
| `list_saved_queries` | Discover saved queries and their parameters |
| `run_saved_query` | Execute a saved query with parameter values |
| `search_saved_queries` | Find a saved query by describing what it should do |

An agent configuration may grant twelve tools: `get_schema`, `list_entities`,
`get_entity`, `get_document`, `list_relations`, `get_neighbors`, `search`,
`search_documents`, `execute_query`, `list_saved_queries`, `run_saved_query`,
`search_saved_queries`. Every write tool is outside that set, and so is the read-only
`get_relation` — being read-only is not sufficient to be grantable. The two search tools
return the REST envelope and take no strategy and no `min_similarity`; they apply the
fixed floor of [capabilities/search.md](capabilities/search.md#similarity-floor) whenever
the default strategy ranks semantically, echoed as `minSimilarity`. MCP also accepts
filters and fields. See [capabilities/agents.md](capabilities/agents.md).

`search_by_index` is the index search of `POST /search`, on MCP only. It takes `query`,
`index` — one index key or a list, absent for every index the lens can search —
`relations`, `limit`, `filters` and `fields`, but no mode and no `minScore`: it runs the
default mode under the same fixed floor and answers `query`, `mode`, `minSimilarity` and
`hits`. `list_search_indices` answers the catalog of `GET /search-indices`. On an
adapter without search indices both answer a not-supported tool error. Agents have
neither.

`write_document` has no REST counterpart of its own: over REST both document edit forms
share one route, selected by the operation in the body.

## What is not exposed

Reasonable things to look for that are absent everywhere — REST, MCP and the web client.

| Absent | Consequence |
|---|---|
| Health or readiness endpoint | Nothing for an orchestrator to probe; liveness must be inferred from a real request |
| Data-wipe endpoint | Instance data is removed one entity or relation at a time; deleting the whole ontology is the only bulk removal |
| Bulk or batch write | Every create and update is a single object; import covers the design, not data |
| Instance-data export | Transfer moves the design only; data leaves through queries or listing |
| Single-property read on modeling | List the owning type's properties |
| Cross-lens read | No route or tool sees two lenses at once |
| Cross-ontology anything | No route or tool sees two ontologies at once; overviews are a client-side concern |
| Registry over MCP | Ontology management is REST/UI only; `ensure_ontology` is the sole, self-scoped exception |

Authentication, authorization and multi-tenancy are absent by design and are discussed in
[architecture.md](architecture.md#what-the-architecture-does-not-provide).
