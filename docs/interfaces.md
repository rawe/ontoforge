# Interfaces

The complete index of every way into the system: the ontology registry, two per-ontology
REST surfaces, one server-wide route, two probes, a metrics route, two MCP servers, and — with
authentication on — sign-in and user management. Concepts and
vocabulary: [README.md](README.md). Structure and error model: [architecture.md](architecture.md).
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
| `/api/auth` | Sign-in — the browser session and who is signed in |
| `/api/users` | User management — principals and their roles; authentication on only |
| `/api/ontologies/{ontologyKey}/model` | Modeling REST — one ontology's schema and per-lens configuration |
| `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` | Runtime REST — one ontology's instance data through one lens |
| `/api/ontologies/{ontologyKey}/runtime/rulesets` | Ruleset maintenance — one ontology's rulesets, without a lens |
| `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/rulesets/{rulesetKey}` | Ruleset runtime REST — the runtime routes through one lens, under one ruleset's rules |
| `/mcp/ontologies/{ontologyKey}/model` | Modeling MCP server, bound to one ontology |
| `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` | Runtime MCP server, bound to one ontology and one lens |
| `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/rulesets/{rulesetKey}` | Ruleset runtime MCP server, bound to one ontology, one lens and one ruleset |
| `/.well-known/oauth-protected-resource` | Where MCP clients discover how to sign in; authentication on only |

Every ontology-scoped request names its ontology in the path, and an ontology is always
spelled `ontologies/<key>`, a lens always `lenses/<key>` — uniformly across REST, MCP
and the web client's own addresses. There is no header-based addressing and no default
ontology. A request naming an unknown ontology key answers not found before anything
else about it is considered.

### How an ontology and a lens are addressed

The registry addresses ontologies by key. Below one ontology, the modeling surface
addresses the schema; the runtime surface addresses instance data and carries the lens
key as a second path parameter, and a ruleset mount the ruleset key as a third. How the
address keeps ontologies apart: [architecture.md](architecture.md#ontology-isolation).

Modeling REST does **not** nest types under a lens. Entity types, relation types and
their properties are resources of the ontology, at the top level of its modeling
surface. Scope inclusions, agent configurations, saved queries, retrievers and
navigators are addressed per lens.

### What a path segment identifies

This is the single most common source of mistakes against the modeling surface.

| Surface | Addressed by |
|---|---|
| Registry | Ontology key |
| Runtime REST, everywhere | Keys — ontology key, lens key, ruleset key, type key, property key; instance ids for entities and relations, or an entity's [identity](capabilities/entity-identity.md) on the identity twin of an entity route |
| Modeling REST — lenses, entity types, relation types, properties, inclusions | **Internal identifiers**, not keys |
| Modeling REST — agent configs, saved queries, retrievers, navigators | Lens key and the resource key |
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
| `sort` | Property key, or `_createdAt` / `_updatedAt`; default `_createdAt`. `createdAt` and `updatedAt` are accepted without the underscore. Entity lists also take `_identity` where the type has an identity the lens shows |
| `order` | `asc` or `desc`, default `asc` |
| `q` | Case-insensitive substring match across every `string` property in scope; entity lists only, and `document` properties are not searched |
| `filter.<propertyKey>[__<op>]` | Property filter, repeatable; on entity lists `_identity` filters as a `string` property where the type has an identity the lens shows |
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
additionally accept `fromEntityId` and `toEntityId`, or `fromEntityIdentity` and
`toEntityIdentity`, at most one of each pair.

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
| Entity list, entity read | `_id`, `_identity` |
| Search | `_id`, `_entityTypeKey`, `_identity` |
| Neighbours — the centre entity | `_id`, `_identity` |
| Neighbours — neighbour entities | `_id`, `_entityTypeKey`, `_identity` |

`_identity` is there only where the entity has one the lens shows.
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

Every REST surface answers with the single error envelope and the nine-code taxonomy
defined in [architecture.md](architecture.md#error-model). Nothing is added per route.

MCP reports the same failures as tool errors. Because a tool error is a single string, the
per-field detail that REST returns under `details.fields` is flattened into the message
text, so a model still sees every offending field in one response. A refused relation
rules write carries its violation list under `details.violations`
([architecture.md](architecture.md#error-model)); MCP reports its message, which states
the count per rule. A rejected submit or commit of a changeset carries its own list there
([changesets](#changesets)); MCP appends each listed violation to the message.

Requesting an unavailable search strategy or a capability whose provider is not
configured answers `VALIDATION_ERROR` with
`details.code` of `FEATURE_DISABLED` — on the two routes that need an embedding provider,
semantic search and saved-query search, and on AI execution and entity identity
comparison alike. A client can therefore
tell a switched-off capability from a rejected request. Model-free operations remain
available: agent discovery, retriever management and navigator management do not
require a language-model provider; execution requirements are listed with the routes below. Agent
chat requires a language-model provider
([capabilities/agents.md](capabilities/agents.md)).

An assistant thread that is unknown, expired, bound to another assistant or started by
another principal answers `RESOURCE_NOT_FOUND` with `details.code` of `THREAD_NOT_FOUND`;
a message to a thread whose previous message is still being answered answers
`RESOURCE_CONFLICT` with `details.code` of `THREAD_BUSY` ([assistant chat and threads](#assistant-chat-and-threads)).

A create or update that would give an entity an identity another entity of its type holds
answers `RESOURCE_CONFLICT` with `details.code` of `IDENTITY_TAKEN`, `details.identity` and
`details.properties`, the type's identity property keys; it never names the other entity
([capabilities/entity-identity.md](capabilities/entity-identity.md#writes)). Setting an
identity the stored entities cannot take answers `RESOURCE_CONFLICT` with
`details.violations`, each `{rule, count, entities}`, the rule `missing_value`, `duplicate`
or `too_long`.

A relation create that would link a pair a [one-per-pair](capabilities/schema-modeling.md#one-per-pair)
relation type already links answers `RESOURCE_CONFLICT` with `details.code` of
`PAIR_TAKEN` and `details.relationTypeKey`; it never names the other relation
([capabilities/instance-data.md](capabilities/instance-data.md#relations)).

A data write whose ontology's design keeps changing while it runs, or a write or modeling
change that waits too long for another one, answers `RESOURCE_CONFLICT` and has written
nothing; it may be sent again ([architecture.md](architecture.md#design-revision)).

Call `GET /api/server/features` first all the same. Probing lets a client hide what is
unavailable, rather than offering it and explaining the refusal afterwards.

### Who may call

With authentication off, every route serves every caller. With it on, every route except
sign-in, `/api/server`, the probes, the API description and the resource metadata needs a
signed-in caller — a bearer access token, or on REST the browser's session cookie — holding
the role the route needs ([capabilities/authentication.md](capabilities/authentication.md#roles)):

| Routes | Need |
|---|---|
| `GET /api/ontologies` | Any signed-in caller; lists the ontologies it holds a role in, every one for a Platform Administrator |
| `POST /api/ontologies` | Ontology Creator |
| `GET /api/ontologies/{ontologyKey}` | Any role in the ontology, or Platform Administrator |
| `PATCH`, `DELETE /api/ontologies/{ontologyKey}` | Ontology Administrator |
| `GET .../model/lenses` | Any role in the ontology, or Platform Administrator; lists the lenses the caller holds a lens role on, every one for an administrator |
| `GET` of one lens and below it on the modeling surface | Reader, Proposer or Writer on that lens, or Ontology Administrator |
| Every other modeling route, and the modeling MCP mount | Ontology Administrator |
| `GET` of ruleset maintenance | Reader, Proposer or Writer on any lens of the ontology, or Ontology Administrator |
| Every other ruleset maintenance route | Ontology Administrator |
| Runtime routes, plain and below a ruleset, and the runtime MCP mounts | Reader, Proposer or Writer on the lens for a route that reads — chat, search and query among them — Proposer or Writer for one that stages — a changeset's check among them — Writer for every other; the operation of each is its ruleset [write access](capabilities/rulesets.md#write-access-levels) operation |
| `/api/users`, `/api/ontologies/{ontologyKey}/access` | Platform Administrator or an Ontology Administrator, narrowed per [route](#user-management) |

A request without a valid credential answers `401 UNAUTHENTICATED` with a
`WWW-Authenticate: Bearer` challenge, carrying `error="invalid_token"` when a token was
sent. A disabled principal, a role the caller lacks on something it may know of, and a
request by session cookie that may change something without the deployment's own
`Origin` answer `403 FORBIDDEN`. An ontology or lens outside the caller's roles answers
`404 RESOURCE_NOT_FOUND`, as an unknown key does. A bearer token that cannot be checked
because the provider's keys cannot be fetched answers `503 PROVIDER_UNAVAILABLE`; nothing
is admitted unchecked.

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

Prefix `/api/server`. Read-only reads describing the deployment.
Ontology-scoped operations never live here, and server-wide data operations do not
exist.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/server/info` | Report where clients reach this server and which version it runs |
| GET | `/api/server/features` | Report which optional capabilities this deployment offers |

Both routes concern neither the ontologies nor their content — they describe the
deployment.

`info` answers:

| Field | Type | Reports |
|---|---|---|
| `baseUrl` | string or null | The address clients reach this server at, without a trailing slash; REST and MCP paths are appended to it. Taken from the deployment's configured public address; `null` when none is configured |
| `version` | string | The server's release version |
| `authentication` | boolean | Authentication is on: callers sign in, and roles decide what they may do |

`features` answers as follows; clients call it before offering optional capabilities.

| Field | Type | Reports |
|---|---|---|
| `semanticSearch` | boolean | An embedding provider is configured |
| `searchStrategies` | list | The available search strategies, in preference order |
| `ai` | boolean | A language-model provider is configured; gates the `/ai` routes |
| `decisions` | boolean | A Decision provider is configured; gates the `/decisions` routes |

## Sign-in

Prefix `/api/auth`. The browser's sign-in, with the server as the provider's client.
Semantics: [capabilities/authentication.md](capabilities/authentication.md#signing-in).
`me` exists with authentication off too; the others only with it on.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/me` | Whether authentication is on, and who is signed in with their roles |
| GET | `/api/auth/login` | Start a browser sign-in: redirects to the provider; `returnTo`, a path on the deployment's own address, is where the browser lands afterwards |
| GET | `/api/auth/callback` | Where the provider sends the browser back: starts the session and redirects to `returnTo` |
| POST | `/api/auth/logout` | End the session; answers `logoutUrl`, the provider's sign-out page, for the browser to open |

`me` never answers `401`: `authentication` alone when it is off; with it on, `user` — null
when no one is signed in — and `assignments`, each with its role and the keys of its
ontology and lens. An assignment whose ontology or lens no longer exists is left out. A
failed sign-in lands on `/?login=failed`, that of a disabled principal on
`/?login=disabled`, both without a session.

**MCP clients** discover the provider through the protected-resource metadata
(RFC 9728): an MCP mount's `401` challenge names `resource_metadata`, the document at
`/.well-known/oauth-protected-resource` followed by the mount's path, and the scope
OntoForge's audience comes with. The document names the mount on the deployment's public
address as `resource`, the provider as its authorization server, and that scope; the bare
`/.well-known/oauth-protected-resource` describes the server. A client connects through
the public address, signs in at the provider and sends its access token as a bearer
header on every request; MCP takes no cookie.

## User management

Prefix `/api/users`, plus one route per ontology. Exists only with authentication on;
off, every route here answers not found. Semantics and who may do what:
[capabilities/authentication.md](capabilities/authentication.md#user-management).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users` | Find principals by name, email or username; `search`, `limit` (at most 200, default 50), `offset`; answers `items` and `total` |
| POST | `/api/users` | Admit a service under its subject at the provider, before its first call |
| GET | `/api/users/{userId}` | Read one principal with the assignments the caller may see |
| PATCH | `/api/users/{userId}` | Disable or enable a principal |
| POST | `/api/users/{userId}/assignments` | Grant a role: platform roles without keys, Ontology Administrator with `ontologyKey`, Reader, Proposer and Writer with `ontologyKey` and `lensKey`; idempotent |
| DELETE | `/api/users/{userId}/assignments/{assignmentId}` | Revoke one assignment |
| GET | `/api/ontologies/{ontologyKey}/access` | Every assignment within one ontology, each with its principal |

Removing the role of the last active Platform Administrator or of the configured
administrator, disabling either of them, or disabling oneself answers
`RESOURCE_CONFLICT`. Admitting an identity bound to a principal that holds no role turns
that principal into the service; one bound to a principal with a role answers
`RESOURCE_CONFLICT`.

## Exposure

One port serves everything. What a deployment exposes follows one rule: **what clients call
is public, what the platform calls stays internal.** The ingress or reverse proxy in front
of the server enforces it; the server itself serves every path on every request
([decisions.md](decisions.md#deployment)).

| Path | Exposed | Called by |
|---|---|---|
| `/api/*` | public | REST clients and the web client |
| `/mcp/*` | public | MCP clients |
| `/.well-known/*` | public | MCP clients finding where to sign in (authentication on) |
| `/openapi.json` | public | Clients reading the contract or generating code from it |
| `/docs/*` | optional | People browsing the same description |
| `/livez`, `/readyz` | internal | The orchestrator, on each server directly |
| `/metrics` | internal | The monitoring system, on each server directly |

Probes and metrics describe one server process, so they are called on each server, never
through a load balancer that would pick one at random.

## Probes

Two routes outside `/api` for an orchestrator; they check no dependency, are not part of
the OpenAPI description and do not use the error envelope.

| Method | Path | Answers |
|---|---|---|
| GET | `/livez` | `200` while the process answers requests |
| GET | `/readyz` | `200` until the server starts shutting down, then `503` |

They are two because they trigger different actions: a failing liveness probe restarts the
server, a failing readiness probe only stops new traffic to it. While shutting down, a
server is ready no longer but still live, so it finishes its running requests and chat
streams instead of being restarted in the middle of them
([architecture.md](architecture.md#shutdown)). Neither answers before startup is done
([architecture.md](architecture.md#startup)).

## Metrics

| Method | Path | Answers |
|---|---|---|
| GET | `/metrics` | Every metric of this server process in Prometheus text format |

Like the probes it needs no credential, is not part of the OpenAPI description and does not
use the error envelope.

| Metric | Type | Labels |
|---|---|---|
| `ontoforge_http_requests_total` | counter | `method`, `route`, `status` |
| `ontoforge_http_request_duration_seconds` | histogram | `method`, `route`, `status` |
| `ontoforge_db_pool_connections` | gauge | `pool` (`ontology`, `access`), `state` (`total`, `idle`, `waiting`) |
| `ontoforge_search_queue_items` | gauge | `state` (`pending`, `failed`) |
| `ontoforge_search_items_total` | counter | `outcome` (`completed`, `failed`, `released`) |
| `ontoforge_search_entries_total` | counter | `representation` (`keyword`, `semantic`) |
| `ontoforge_provider_request_duration_seconds` | histogram | `provider` (`embedding`, `ai`), `outcome` (`ok`, `error`) |
| `process_*`, `nodejs_*` | as the client library defines them | none |

`route` is the route template (`/api/ontologies/:ontologyKey`), or `unmatched` for a request
no route answers; `status` is the status code, or `aborted` when the client left before any
response was sent. No label carries an ontology, a lens, a principal or a raw path
([decisions.md](decisions.md#deployment)). A streamed response or model call is timed to
its end.

The search counters count this server's worker; the queue is shared, so every server reports
the same queue, as of its last pass over every ontology. A `failed` item there waits for a
rebuild; one counted `failed` by the worker may still be retried.

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
| DELETE | `/lenses/{lensId}` | Delete a lens with its changesets, answering `{changesetsDeleted}`; the schema and its data are untouched | — |
| POST | `/lenses/{lensId}/validate` | Check this lens's inclusions against the schema | — |

### Entity types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entity-types` | Create an entity type together with its name property (`nameProperty`, default `name`), optionally with an identity (`identityProperties`) | `cascade` |
| GET | `/entity-types` | List the ontology's entity types | — |
| GET | `/entity-types/{entityTypeId}` | Read one entity type | — |
| PUT | `/entity-types/{entityTypeId}` | Update display name, description, name property (`nameProperty`) or identity (`identityProperties`; null clears it) | `cascade` |
| DELETE | `/entity-types/{entityTypeId}` | Delete an entity type and its properties | `cascade` |

### Relation types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/relation-types` | Create a relation type; endpoints are named by entity type key and are fixed; `parent` optionally names the parent end, `onePerPair` optionally turns one per pair on | — |
| GET | `/relation-types` | List the ontology's relation types, each with its `parent` and `onePerPair` | — |
| GET | `/relation-types/{relationTypeId}` | Read one relation type | — |
| PUT | `/relation-types/{relationTypeId}` | Update display name, description, parent end (`parent`; null clears it) or one per pair (`onePerPair`) | — |
| DELETE | `/relation-types/{relationTypeId}` | Delete a relation type and its properties | `cascade` |

Setting or changing `parent`, or turning `onePerPair` on, on create or update, is refused
with `RESOURCE_CONFLICT` and `details.violations` when the stored relations break the
rule; nothing of the request is then written. `onePerPair` false with a parent end is a
field error ([capabilities/schema-modeling.md](capabilities/schema-modeling.md#relation-rules)).

### Property definitions

Identical shape on both owners. There is no route to read a single property definition —
list the owner's properties.

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entity-types/{entityTypeId}/properties` | Define a property on an entity type | `cascade` |
| GET | `/entity-types/{entityTypeId}/properties` | List an entity type's properties | — |
| PUT | `/entity-types/{entityTypeId}/properties/{propertyId}` | Update a property (`defaultValue`; null clears it); key and data type are immutable | — |
| DELETE | `/entity-types/{entityTypeId}/properties/{propertyId}` | Remove a property definition; refused for the type's name property | `cascade` |
| POST | `/relation-types/{relationTypeId}/properties` | Define a property on a relation type | `cascade` |
| GET | `/relation-types/{relationTypeId}/properties` | List a relation type's properties | — |
| PUT | `/relation-types/{relationTypeId}/properties/{propertyId}` | Update a property (`defaultValue`; null clears it); key and data type are immutable | — |
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
Rules:
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
changed since it was read, is a conflict. Management calls no model. The built-in default retriever
is not a modeling resource, as for agents.

### Navigators

Per-lens, addressed by lens key and assistant key. Semantics, configuration and validation:
[capabilities/navigators.md](capabilities/navigators.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/lenses/{lensKey}/assistants/navigators` | List the lens's navigators, by name, each with its current validation |
| GET | `/lenses/{lensKey}/assistants/navigators/{assistantKey}` | Read one navigator as stored, with its current validation |
| PUT | `/lenses/{lensKey}/assistants/navigators/{assistantKey}` | Create or replace; 201 on create, 200 on replace |
| DELETE | `/lenses/{lensKey}/assistants/navigators/{assistantKey}` | Delete the navigator; 204 |

A write carries `name`, optional `description`, `configVersion: 1` and `config`; unknown
fields are rejected. A read carries `key`, `lensKey`, `name`, `description`,
`configVersion`, `config`, `validation: {valid, errors, warnings}`, `createdAt` and
`updatedAt`. A configuration the lens cannot run is refused with `VALIDATION_ERROR` and the
errors under `details.errors`. Management calls no model. The built-in default navigator is
not a modeling resource, as for agents.

### Search settings

The ontology's keyword language set and its managed-index switches. Semantics:
[capabilities/search.md](capabilities/search.md#keyword-language) and
[capabilities/search-indices.md](capabilities/search-indices.md#managed-indices).

| Method | Path | Purpose |
|---|---|---|
| GET | `/search-settings` | Read `keywordLanguages` and `disabledIndices`, the managed indices switched off |
| PUT | `/search-settings` | Change either or both; an absent field stays as it is. Answers the settings now in force |

A PUT is validated whole before anything is written; field errors name `keywordLanguages`
or `disabledIndices.<i>` for a key that names no managed index.

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
enabled one with `representation`, `state`, `build` (`{done, total}`, null while no
generation is filling), `pending` and `failed` — and `lastErrors`, each with `entityId`, `partKind`, `message` and `at`.

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
index a lens includes without `cascade` answers `CASCADE_REQUIRED`.

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
navigators, search indices; no instance
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
visible properties. What a relation type carries:
[capabilities/schema-modeling.md](capabilities/schema-modeling.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/schema` | The whole scoped schema in one response |
| GET | `/schema/entity-types` | Entity types visible through the lens |
| GET | `/schema/entity-types/{entityTypeKey}` | One entity type with its visible properties |
| GET | `/schema/relation-types` | Relation types visible through the lens |
| GET | `/schema/relation-types/{relationTypeKey}` | One relation type with its visible properties |

### Entities

Semantics: [capabilities/instance-data.md](capabilities/instance-data.md).

Every route below `/entities/{entityTypeKey}/{entityId}` — read, path, update, delete,
documents and neighbours — has an identity twin below
`/entities/{entityTypeKey}/identity/{identity}`, the identity URL-encoded as one segment,
with the same parameters and answers; an unknown identity is not found
([capabilities/entity-identity.md](capabilities/entity-identity.md#addressing-by-identity)).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entities/{entityTypeKey}` | Create an entity, optionally with its parent relation (`parentRelation`) | — |
| GET | `/entities/{entityTypeKey}` | List entities of one type | `limit`, `offset`, `sort`, `order`, `q`, `fields`, `filter.*` |
| GET | `/entities/{entityTypeKey}/{entityId}` | Read one entity | `fields` |
| GET | `/entities/{entityTypeKey}/{entityId}/path` | The entity's hierarchy path through the lens | — |
| PATCH | `/entities/{entityTypeKey}/{entityId}` | Partial update; an explicit null clears a property | — |
| DELETE | `/entities/{entityTypeKey}/{entityId}` | Delete an entity and every relation attached to it; refused for an entity with children or with a relation the lens hides | — |

`parentRelation` sits beside the property values in the flat create body as
`{type, parentId, properties}`: the parent relation type's key, the parent's id — or
`parentIdentity`, its identity, in place of `parentId` — and the relation's own properties,
optional. The create answers the entity alone; faults come
under `parentRelation.*` with the entity's own. The path answers
`[{type, id, identity, name}]`, `identity` null where there is none, root first and ending with the entity; an unknown, hidden or
wrong-type entity is not found, as on the read. Deleting an entity that still has children,
or that has a relation attached whose type the lens hides, answers `RESOURCE_CONFLICT`. Rules: [capabilities/instance-data.md](capabilities/instance-data.md#hierarchies).

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
| POST | `/relations/{relationTypeKey}` | Create a relation between two entities, each end by `fromEntityId` or `fromEntityIdentity`, `toEntityId` or `toEntityIdentity` | — |
| GET | `/relations/{relationTypeKey}` | List relations of one type | `limit`, `offset`, `sort`, `order`, `fromEntityId`, `toEntityId`, `fromEntityIdentity`, `toEntityIdentity`, `filter.*` |
| GET | `/relations/{relationTypeKey}/{relationId}` | Read one relation | — |
| PATCH | `/relations/{relationTypeKey}/{relationId}` | Partial update of properties; endpoints cannot change | — |
| DELETE | `/relations/{relationTypeKey}/{relationId}` | Delete a relation; its endpoints are untouched | — |

### Changesets

Semantics: [capabilities/changesets.md](capabilities/changesets.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/changesets` | Start a changeset, with an optional `note`; 201 | — |
| GET | `/changesets` | List the changesets this URL reaches | — |
| GET | `/changesets/{changesetId}` | Read a changeset with its staged objects by first touch | `offset`, `limit` |
| GET | `/changesets/{changesetId}/documents/{entityTypeKey}/{entityId}/{propertyKey}` | Read the text a commit would leave in a document property, whole or by character range | `offset`, `limit` |
| GET | `/changesets/{changesetId}/entities/{entityTypeKey}/{entityId}` | Read one entity as the changeset leaves it, with its staged object | — |
| GET | `/changesets/{changesetId}/entities/{entityTypeKey}/identity/{identity}` | The same, the entity named by its identity in the changeset's view | — |
| DELETE | `/changesets/{changesetId}` | Discard a draft changeset; 204 | — |
| POST | `/changesets/{changesetId}/writes` | Stage one call, its body discriminated by `operation`; 201 | — |
| DELETE | `/changesets/{changesetId}/objects/{objectId}` | Unstage one staged object with its values; 204 | — |
| DELETE | `/changesets/{changesetId}/objects/{objectId}/properties/{propertyKey}` | Cut one staged value; 204 | — |
| POST | `/changesets/{changesetId}/objects/{objectId}/rebase` | Rebase an update, with optional `properties`, the keys to rebase | — |
| POST | `/changesets/{changesetId}/submit` | Submit, with an optional `note` | — |
| POST | `/changesets/{changesetId}/unsubmit` | Unsubmit, with a required `note` | — |
| POST | `/changesets/{changesetId}/check` | Check: run the commit and roll it back; no body | — |
| POST | `/changesets/{changesetId}/commit` | Commit, with an optional `expectedVersion` | — |

A staged call's `operation` is one of seven, each with its keys and no other:
`create_entity` `{type, properties?, parentRelation?}`, `update_entity`
`{type, id, properties?}`, `delete_entity` `{type, id}`, `create_relation`
`{type, fromEntityId, toEntityId, properties?}`, `update_relation` `{type, id, properties?}`,
`delete_relation` `{type, id}` and `edit_document` `{type, id, property}` with the body of
the [document write](#documents). On the entity operations `identity` may name the entity
in place of `id`, and on `create_relation` `fromEntityIdentity` and `toEntityIdentity` the
ends, resolved in the changeset's view; `type` is the type key, `id` the target, `properties`
the values as one object, and `parentRelation` the immediate create's. Staging answers
`{id}`, the staged object's id; a create with a parent relation adds `relation: {id}`, an
entity delete that took out staged relations `cascaded`, their ids, and `edit_document`
the document write's answer beside `id`.

`limit` of the changeset read is 1–500, default 100. A changeset carries `objectCount`, its
number of staged objects; the read adds `objects`, each `{id, kind, type, action,
firstTouchedAt, markers, values}`, with `name` for an entity, `identity` `{before, after}`
for an entity the changeset gives an identity, and `from` and `to`, each
`{id, name}`, for a relation, and each value `{property, before, current, after,
markers}`, a document value as `{document: true, length}`. The list counts `operations`
per `<action>_<kind>`. The staged document read pages and answers as the document read
does. The staged entity read answers `{entity, deleted, object}`: `entity` as the entity
read answers it, without timestamps for an entity the changeset creates, `object` as the
changeset read shows it, or null. Start, submit and unsubmit answer the changeset, and
rebase the object; commit answers `{committed, alreadyGone}`, the number of staged objects
and the ids of deletes whose target was already gone, and a check that passes
`{version, committed, alreadyGone}`, with the version it checked. Every unknown changeset —
committed, discarded, expired, never started, or bound to another lens or ruleset — is
`RESOURCE_NOT_FOUND`, and so is an object or value the changeset does not stage. A
refusal by state is `RESOURCE_CONFLICT`: a submitted or busy changeset, one changed
during the call, a stale `expectedVersion`, a full changeset, a rebase of a create or a
delete, a call the write access of the URL's ruleset does not allow, a second commit on
the ontology or in the process, a check beside a running commit.
Staging answers the immediate write's validation errors. A submit refused by its faults,
a rejected commit and a failed check answer `VALIDATION_ERROR` with `details.violations`,
each `{object, property?, kind, message}`, at most 100, and `details.total`; `object` is
the staged object's id, or null for the changeset as a whole, and those come first. A
failed check adds `details.version`, the version it checked.

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
`entity`, `relativeScore` and `matched`. A body
of the wrong shape, or with a field not listed here, is rejected with `details.errors`;
the request's rules — an index the lens cannot search or that does not exist at
`indices.<i>`, a relation type
at `relations.<i>` — are collected under `details.fields`; a mode that needs a missing embedding provider answers
`FEATURE_DISABLED`. Rules:
[capabilities/search.md](capabilities/search.md#index-search).

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

Every assistant kind — `agents`, `retrievers`, `navigators` — converses through the same request, the
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
thread that is unknown, expired, bound to another assistant or started by another
principal answers `RESOURCE_NOT_FOUND` with `details.code` `THREAD_NOT_FOUND`; a thread
whose previous message is still being answered answers `RESOURCE_CONFLICT` with
`details.code` `THREAD_BUSY`. Both are plain error responses before the stream opens, like every other
refusal the kind lists; a busy message is never queued.

**Stream.** Successful responses use `application/x-ndjson`: one complete JSON object per
line, each with a `type`. The shared events mean the same for every kind:

| Event `type` | Fields | Meaning |
|---|---|---|
| `thread` | `threadId` | Always first: the thread this turn runs on |
| `delta` | `text` | A fragment of the answer, for kinds that stream their answer |
| `entities` | `entities` — each `ref`, `id`, `type`, `typeName`, `label`, `fields` (`name`, `value`), `evidence`, and as the kind sends them `reason`, `role`, `hop` — and `links` — each `id` (the stored relation's id), `from`, `to` (refs, directed as stored), `type`, `label` | The entities the turn met and the stored relations between them; a later card replaces an earlier one with the same `ref`, a link is identified by its `id` |
| `final` | `reply` | Terminal: the complete answer |
| `error` | `error` | Terminal: the public error object with `code`, `message` and optional `details` |

Refs are `E1`, `E2`, … in the order the turn met the entities, unique within a turn; an
entity keeps its ref for the turn. `id` and `type` are the entity's id and type key, so a
client reads the entity through the runtime; `evidence` says the entity was handed to the
model that wrote the answer. A link's ends are cards of the same turn. Which entities a
kind sends is in its section below.

A kind's own events are named `<kind>.<event>` — `agent.…`, `retriever.…`, `navigator.…`; a client may
ignore those it does not know. A writable stream has exactly one terminal `final` or
`error`; EOF without one means an incomplete turn — so does a stream a stopping server
cuts. A closed connection cancels the turn, and a cancelled or failed turn leaves nothing
in its thread. A turn whose result cannot be kept ends with `error`: `THREAD_NOT_FOUND`
when its thread is gone meanwhile, `THREAD_BUSY` when it lost its hold on the thread,
`VALIDATION_ERROR` when the thread grew too large to keep, `STORAGE_ERROR` when the thread
store is full or fails. Unexpected failures after streaming begins have the generic `INTERNAL_ERROR` message `Internal Server Error`.
Delivery bounds buffering and terminates stalled or oversized streams.

**Read a thread.** `200` with `threadId` and `messages` — the user messages and the
assistant's answers in order, each `role` (`user` or `assistant`) and `content`, at most
the turns a thread keeps, without tool payloads. Unknown, expired, another assistant's or
another principal's thread: `THREAD_NOT_FOUND`. Reading needs no language-model provider
and does not count as use; it is gated like the kind's list.

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
language-model provider.

**Chat.** The [shared request](#assistant-chat-and-threads) plus `diagnostics` (boolean,
default false). Without a language-model provider the route answers
`FEATURE_DISABLED`, as the AI routes do. An unknown retriever answers not found, a retriever its
lens can no longer run `VALIDATION_ERROR` with the errors under `details.errors`, a
default retriever with nothing to search `VALIDATION_ERROR`, an unknown or busy thread as
shared — each before the stream opens.

The response streams the [shared frame](#assistant-chat-and-threads): `thread`, the answer
as `delta` events, then one terminal `final` or `error`. Before the answer, when results
reached the answer model, one `entities` event carries them, all evidence, without links —
with or without diagnostics. Its own events:
`retriever.phase` (`phase` `plan`, `retrieve` or `answer`, `status` `start` or `end`, an
end with `durationMs`), and — only with `diagnostics` true — `retriever.diagnostics`
events, which carry:

| Field | Content |
|---|---|
| `plan` | `subQueries` — each `indices`, `relations`, `query`, `variants`, `mode`, `filters` (`id`, `value`, `quote`, and the filter's definition from the retriever's configuration: `entityType`, `path`, `field`) and `previous` — and `unsupportedReason` |
| `results` | One row per entity and sub-query that found it, in fused order: `entityId`, `entityType`, `label`, `subQuery`, `matched` when the search ranked the entity, `answerFields` |
| `limitations` | What the answer model was told limits the results |
| `searchCalls` | The number of index searches run |
| `timings` | Milliseconds: `plan`, `retrieve`, `answer`, `planModel`, `validation`, `search`, `context`, `firstDelta`, `answerModel`, `total`; `planModel` and `validation` add up both planning calls when planning was repeated |
| `modelIO` | Bounded system prompt, input and output traces of every model call, each with its `phase` — `plan`, `replan` for a follow-up's repeated planning, `answer` — and with usage and finish reason where the provider reports them |
| `llmCalls` | The number of model calls: 2, or 3 when planning was repeated |

`matched` has the form of a search hit's ([capabilities/search.md](capabilities/search.md#response)).

**Read a thread.** As [shared](#assistant-chat-and-threads).

**Retrieve.** The body carries `query` (1 to 2,000 characters); unknown fields — a thread
id or `diagnostics` among them — are rejected.
It is refused exactly as chat is, with plain error responses: `FEATURE_DISABLED` without
a language-model provider, not found for an
unknown retriever, `VALIDATION_ERROR` for a retriever its lens can no longer run (errors under
`details.errors`), a default retriever with nothing to search, a planner input over the cap,
a failed planning call or a malformed plan. A closed connection cancels the work.

The response is `200` with `results` — best first, each `entityId`, `entityType`,
`label`, `conditions` (`filter`, `value`, `text`) and `matched` (a search hit's form, or
null) — `limitations` and `unsupportedReason` when no index can answer. No results is not
an error.

A question or a retrieve needs a language-model provider; without an embedding provider it
searches by keyword only. Neither route has an MCP equivalent.

### Navigator list and chat

The stored navigator runs — or, under the key `_default`, the lens's
[default navigator](capabilities/navigators.md#the-default-navigator); a request can never
supply or override its configuration. Semantics:
[capabilities/navigators.md](capabilities/navigators.md#answering-a-question).

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/navigators` | List the lens's navigators, the default first |
| POST | `/ai/assistants/navigators/{assistantKey}/chat` | Stream the work and the answer for one question |
| GET | `/ai/assistants/navigators/{assistantKey}/threads/{threadId}` | Read a thread back |

**List.** As for retrievers: `key`, `name`, `description` and `builtIn`, the default first,
no configuration, no validation, no language-model provider needed.

**Chat.** The [shared request](#assistant-chat-and-threads), nothing more. Without a
language-model provider the route answers `FEATURE_DISABLED`; an unknown navigator answers
not found, a navigator its lens can no longer run `VALIDATION_ERROR` with the errors under
`details.errors`, an unknown or busy thread as shared — each before the stream opens. The
response streams the shared frame — `thread`, the answer as `delta` events, one terminal
`final` or `error` — the `entities` met after the anchors, after each walk and after the
focus, with each card's `reason`, `role` (`anchor`, `reached`, `focus`) and `hop` — and
its own events, all in display names, never ids or keys:

| Event `type` | Fields | Meaning |
|---|---|---|
| `navigator.graph` | `steps` (`id`, `label`, `description`, `model`), `edges` (`from`, `to`, optional `label`; an edge to itself is a repeat) | The pipeline, once, right after `thread` |
| `navigator.step` | `id`, `status` (`running`, `done`, `skipped`, `failed`), `round`, and when it ends `durationMs` and an optional `summary` | One step starting or ending; every `running` is followed by exactly one end of the same `id` and `round`, unless the turn is cancelled; `skipped` arrives alone, with a summary and no duration |
| `navigator.summary` | `modelCalls`, `durationMs`, `entities`, `evidence`, `hops`, `timings` (milliseconds per step id) | Once, before `final` |

The answer cites evidence by ref in square brackets, one or several: `[E2]`, `[E2, E5]`.

**Read a thread.** As [shared](#assistant-chat-and-threads). No MCP equivalent exists.

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

After a successful result of `get_entity`, `list_entities`, `get_neighbors`, `search` or
`search_documents`, an `entities` event carries the lens's entities it returned that the
turn had not sent yet, all evidence, and for `get_neighbors` the relations to them. Other
tools send none; the tool events are the same either way.

Call IDs are unique within a turn. Calls precede their results, and parallel results arrive
as each completes. An unknown agent, an unavailable provider and an unknown or busy thread
are rejected before streaming, using the ordinary HTTP error response. Disconnect cancels
further agent work, with best-effort cancellation of running operations. Reading a thread
needs no provider, as the list does.

## Rulesets

Prefix `/api/ontologies/{ontologyKey}/runtime/rulesets`. One ontology's rulesets, without a
lens. Semantics: [capabilities/rulesets.md](capabilities/rulesets.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List the rulesets, by key, each `{key, anchor, writeAccess}` |
| GET | `/{rulesetKey}` | Read one ruleset |
| PUT | `/{rulesetKey}` | Create or change a ruleset; the body is `{anchor?, writeAccess?}`, and a rule it leaves out keeps its value, or takes its default on a new ruleset, so `{}` creates a ruleset that limits nothing; 200 with the record either way |
| DELETE | `/{rulesetKey}` | Delete a ruleset; 204 |

`anchor` is `{type, id, state}` or null, `state` is `found` or `deleted`; in the body it is
`{type, id}`, or null to remove it. `writeAccess` is `none`, `propose` or `full`. A key
that breaks the ruleset key rule is a `VALIDATION_ERROR` with a message only; an entity
type or entity that is not stored is a field error on `anchor.type` or `anchor.id`, and
an unknown level one on `writeAccess`. An unknown ruleset is not found on read and delete.

### Ruleset mounts

`/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/rulesets/{rulesetKey}` mirrors the
[runtime REST](#runtime-rest) routes from schema introspection to saved queries, the path
read included; the AI and entity identity comparison routes are not mirrored. Its root,
`GET` on the prefix itself, answers what `get_ruleset` answers:
`{key, writeAccess, anchor}`, `anchor` null or `{type, id, name, state, visible, path}`,
every path step as `{type, id, name}`.
Every request checks the ontology, then the lens, then the ruleset, after its own shape:
an unknown ruleset is not found on reads too. A route its
[write access](capabilities/rulesets.md#where-write-access-is-checked) does not allow
answers `RESOURCE_CONFLICT` before it runs. Writes stay in the
[anchor's subtree](capabilities/rulesets.md#what-is-held): its refusals are field errors,
and a deleted anchor or an anchor's entity the lens hides answers `RESOURCE_CONFLICT` to
every write. The MCP equivalent is the [ruleset mount](#how-a-mount-is-bound).

## MCP

Two servers, mounted in the same process as REST and calling the same services directly.
Both use the stateless-HTTP, plain-JSON transport required by
[decisions.md](decisions.md#interfaces), so one mount serves many clients and no
connection carries state.

| | Modeling | Runtime |
|---|---|---|
| Mount | `/mcp/ontologies/{ontologyKey}/model` | `/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}` |
| Bound to | One ontology | One ontology and one lens |
| Tools | 45 | 35; 36 on a ruleset mount, 35 with write access `propose`, 20 with `none` or for a Reader; 34 for a Proposer, 35 on a ruleset mount |
| Sign-in, authentication on | Bearer token of an Ontology Administrator | Bearer token of a Reader, Proposer or Writer on the lens |

### How a mount is bound

**The URL is the only binding channel.** Each mount names its scope in its own address —
there is no request header and no configured fallback, no tool takes an ontology
argument, and no runtime tool a lens argument. A URL that names no ontology (or, for runtime, no lens) is an unknown
route and answers the standard not-found error. One MCP client configuration entry per
ontology is the intended shape.

A bound client can never reach, list, or infer another ontology's existence: the binding
is fixed in the URL, and no mount exposes the registry. Ontology management — listing,
creating under an arbitrary key, renaming, deleting — is REST and web UI only, with one
carve-out: the modeling mount's `ensure_ontology` tool, which acts only on the mount's
own binding.

A runtime mount URL may add `/rulesets/{rulesetKey}`: the mount is then also bound to that
ruleset, gains `get_ruleset`, and follows the ruleset's
[rules](capabilities/rulesets.md#the-rules). Its tools are otherwise the runtime tools
that its write access allows
([capabilities/rulesets.md](capabilities/rulesets.md#write-access-through-the-interfaces)).
On a ruleset mount `get_schema`'s description says to call it after `get_ruleset`, and
`create_entity`'s adds the anchor's rule. No mount creates a ruleset.

The modeling mount serves requests even when its ontology does not exist yet — that is
what lets `ensure_ontology` provision it; until then every other tool answers a
not-found tool error. With authentication on it does not: a missing ontology answers not
found like any ontology the caller holds no role in, and `ensure_ontology` creates
nothing. How a client signs in: [Sign-in](#sign-in). The runtime mount requires both its ontology and its lens to
exist, and a ruleset mount its ruleset as well; its tools answer not-found tool errors
otherwise, reads included.

### Modeling tools

| Tool | Purpose |
|---|---|
| `ensure_ontology` | Create the ontology this mount is bound to if it does not exist yet; no-op if it does. Argument-less — it acts only on the mount's own ontology — and reports the key and whether it created. A created ontology starts bare and without a display name; naming is a REST/UI operation. With authentication on it creates nothing |
| `get_schema` | The ontology's whole design — types, relation types, properties, the keyword language set, the custom search indices and the switched-off managed ones, and every lens with its type inclusions, its search-index inclusions (`indexInclusions`), agents, saved queries, retrievers and navigators. Identical to `export_schema`, and the only way to enumerate lenses: there is no `list_lenses` |
| `create_entity_type` | Add an entity type together with its name property (`name_property`, default `name`), optionally with an identity (`identity_properties`) |
| `update_entity_type` | Change display name, description, name property (`name_property`) or identity (`identity_properties`; null clears it); the key is immutable |
| `delete_entity_type` | Remove an entity type and its properties |
| `create_relation_type` | Add a relation type between two entity types, optionally naming its parent end (`parent`) and turning one per pair on (`one_per_pair`) |
| `update_relation_type` | Change display name, description, parent end (`parent`; null clears it) or one per pair (`one_per_pair`); endpoints are immutable |
| `delete_relation_type` | Remove a relation type and its properties |
| `add_property` | Define a property on an entity type or a relation type |
| `update_property` | Change a property's metadata (`default_value`; null clears it); key and data type are immutable |
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
| `delete_lens` | Delete a lens with its changesets, stating how many |
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
`create_entity_type`, `update_entity_type`, `add_property`, `delete_property`, `delete_entity_type`,
`delete_relation_type` and `delete_search_index` take a `cascade` flag with the same
meaning as the REST parameter. The search-index tools take the index key as
`index_key` and a definition in the same wire format as REST, camelCase included.
`set_retriever` writes the current configuration version, so it takes no version argument.
Copying, moving, exporting and importing a single retriever are REST only.
There is no modeling tool for the search-data rebuild (`rebuild-search-data`).

### Runtime tools

Everything a client can do to instance data through one lens.

| Tool | Purpose |
|---|---|
| `get_ruleset` | Ruleset mounts only: what the connection may do — key, write access, and the anchor with its type, id, name, state, visible and path |
| `get_schema` | The scoped schema, as REST `/schema` returns it — the lens's key, name and description; types, properties, required flags, name properties, identity properties |
| `create_entity` | Create an entity, optionally with its parent relation (`parent_relation`: `type`, `parent_id` or `parent_identity`, `properties`) |
| `list_entities` | List entities with search, filters, sorting, paging and projection |
| `get_entity` | Read one entity by id |
| `get_path` | An entity's hierarchy path through the lens, root first |
| `get_document` | Read a document property, whole or by character range |
| `update_entity` | Partial update; a null clears a property |
| `edit_document` | Change part of a document by exact string replacement |
| `write_document` | Overwrite a character range of a document; also inserts and appends |
| `delete_entity` | Delete an entity and its relations; refused for an entity with children or with a relation the lens hides |
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
| `start_changeset` | Start a changeset, with an optional `note` |
| `list_changesets` | The changesets this mount reaches |
| `get_changeset` | A changeset with its staged objects by first touch |
| `get_staged_document` | The text a commit would leave in a document property, whole or by character range |
| `unstage` | Remove one staged object, by `object_id`, or with `property` cut one staged value |
| `rebase` | Rebase an update, by `object_id`, with optional `properties` |
| `submit_changeset` | Submit a changeset, with an optional `note` |
| `unsubmit_changeset` | Unsubmit a changeset, with a required `note` |
| `check_changeset` | Check a changeset: run the commit and roll it back |
| `commit_changeset` | Commit a changeset, with an optional `expected_version` |
| `discard_changeset` | Discard a draft changeset |

`get_entity`, `get_path`, `get_document`, `update_entity`, `edit_document`,
`write_document`, `delete_entity` and `get_neighbors` name the entity by `entity_id` or
`entity_identity`, exactly one; `create_relation` names its ends by `from_entity_id` or
`from_entity_identity` and `to_entity_id` or `to_entity_identity`, and `list_relations`
filters by either. `get_staged_document` takes an id only.

`create_entity`, `update_entity`, `delete_entity`, `create_relation`, `update_relation`,
`delete_relation`, `edit_document` and `write_document` take an optional `changeset_id`:
with it the call is staged into that changeset and answers as the staging route does.
Every changeset tool but `start_changeset` and `list_changesets` takes `changeset_id`;
`get_changeset` takes `offset` and `limit`, which it clamps into range, and
`get_staged_document` takes those of `get_document`. The changeset tools
answer what the REST routes answer, and `unstage` and `discard_changeset` a message.

An agent configuration may grant twelve tools: `get_schema`, `list_entities`,
`get_entity`, `get_document`, `list_relations`, `get_neighbors`, `search`,
`search_documents`, `execute_query`, `list_saved_queries`, `run_saved_query`,
`search_saved_queries`. Every write tool is outside that set, and so are the read-only
`get_relation`, `get_path`, `get_ruleset`, `list_changesets`, `get_changeset` and
`get_staged_document` — being
read-only is not sufficient to be grantable. The two search tools
return the REST envelope and take no strategy and no `min_similarity`; they apply the
fixed floor of [capabilities/search.md](capabilities/search.md#similarity-floor) whenever
the default strategy ranks semantically, echoed as `minSimilarity`. MCP also accepts
filters and fields. See [capabilities/agents.md](capabilities/agents.md).

`search_by_index` is the index search of `POST /search`, on MCP only. It takes `query`,
`index` — one index key or a list, absent for every index the lens can search —
`relations`, `limit`, `filters` and `fields`, but no mode and no `minScore`: it runs the
default mode under the same fixed floor and answers `query`, `mode`, `minSimilarity` and
`hits`. `list_search_indices` answers the catalog of `GET /search-indices`. Agents have
neither.

`write_document` has no REST counterpart of its own: over REST both document edit forms
share one route, selected by the operation in the body.

## What is not exposed

Reasonable things to look for that are absent everywhere — REST, MCP and the web client.

| Absent | Consequence |
|---|---|
| Data-wipe endpoint | Instance data is removed one entity or relation at a time; deleting the whole ontology is the only bulk removal |
| Bulk or batch write | Every create and update is a single object, except a create with a parent relation, which writes one entity and its one relation, on every mount; a changeset stages writes call by call and commits them together; import covers the design, not data |
| Instance-data export | Transfer moves the design only; data leaves through queries or listing |
| Single-property read on modeling | List the owning type's properties |
| Cross-lens read | No route or tool sees two lenses at once |
| Cross-ontology anything | No route or tool sees two ontologies at once; overviews are a client-side concern |
| Registry over MCP | Ontology management is REST/UI only; `ensure_ontology` is the sole, self-scoped exception |

Multi-tenancy is absent by design and is discussed in
[architecture.md](architecture.md#what-the-architecture-does-not-provide).
