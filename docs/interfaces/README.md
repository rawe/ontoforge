# Interfaces

The complete index of every way into the system: the ontology registry, two per-ontology
REST surfaces, one server-wide route, two probes, a metrics route, two MCP servers, and — with
authentication on — sign-in and user management. [Concepts](../concepts.md) explain the mental
model; the [glossary](../glossary.md) defines its terms. System structure:
[architecture.md](../architecture.md).
The shared wire error contract is [below](#errors).
What each operation *means* is in [capabilities/](../capabilities/) — this folder is the
map, not the semantics. This file holds the conventions every route and tool shares;
each surface has its own file, listed below.

Exact request and response shapes are served by the running system as an OpenAPI
description at `/openapi.json`, with a browsable rendering at `/docs`. No request or
response bodies are reproduced here except the shared error envelope.

## Find an interface

| Need | Start here |
|---|---|
| Addressing, filtering, errors and access | [Conventions](#conventions) |
| Ontologies and deployment information | [Registry](server.md#registry), [Server](server.md#server) |
| Sign-in, users and deployment health | [Sign-in](server.md#sign-in), [User management](server.md#user-management), [Exposure](server.md#exposure), [Probes](server.md#probes), [Metrics](server.md#metrics) |
| Design an ontology | [Modeling REST](modeling-rest.md) |
| Work with instance data through a lens | [Runtime REST](runtime-rest.md), [Rulesets](runtime-rest.md#rulesets) |
| Chat with an assistant of a lens | [Assistants REST](assistants-rest.md) |
| Connect an MCP client | [MCP](mcp.md) |

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
address keeps ontologies apart: [architecture.md](../architecture.md#ontology-isolation).

Modeling REST does **not** nest types under a lens. Entity types, relation types and
their properties are resources of the ontology, at the top level of its modeling
surface. Scope inclusions, agent configurations, saved queries, named searches, retrievers
and navigators are addressed per lens.

### What a path segment identifies

This is the single most common source of mistakes against the modeling surface.

| Surface | Addressed by |
|---|---|
| Registry | Ontology key |
| Runtime REST, everywhere | Keys — ontology key, lens key, ruleset key, type key, property key; instance ids for entities and relations, or an entity's [identity](../capabilities/entity-identity.md) on the identity twin of an entity route |
| Modeling REST — lenses, entity types, relation types, properties, inclusions | **Internal identifiers**, not keys |
| Modeling REST — agent configs, saved queries, named searches, retrievers, navigators | Lens key and the resource key |
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
Runtime and MCP address schema and design objects by key so callers, especially models,
do not have to retain opaque identifiers for those objects. Modeling REST may use an
identifier because its client has just created or listed the addressed object.

### JSON shape

Field names are `camelCase` in every REST body and in every MCP result. The values that
name schema elements — ontology keys, lens keys, type keys, property keys — are
`lower_snake_case`, because keys are a separate namespace from field names. MCP *tool
parameters* are `snake_case`.

Caller-facing names use schema vocabulary, not database-vendor or implementation-language
vocabulary. Otherwise routes, fields, tools and errors would expose implementation details
that callers could start depending on. Rejected values are described by their JSON type
([errors](#errors)).

Server-managed fields carry a leading underscore and are readable everywhere and writable
nowhere. Their names, and the one field that breaks the underscore convention, are in
[architecture.md](../architecture.md#instance-level).

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
[capabilities/instance-data.md](../capabilities/instance-data.md#listing). Relation lists
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
[capabilities/instance-data.md](../capabilities/instance-data.md#query-paths). Under
`__exists` or `__missing` the relation type alone is a filter key —
`filter.supersedes__missing=true` selects the entities no relation of the type reaches —
resolved with the same direction rules
([capabilities/instance-data.md](../capabilities/instance-data.md#relation-existence)).
`sort` rejects paths, and relation lists take neither paths nor relation subjects. The
MCP `filters` object takes path and relation keys as ordinary keys.

Ranked search accepts the same filter keys — in its `filter` object, without the
`filter.` prefix — but not all of them; the restrictions and their reasons are in
[capabilities/search.md](../capabilities/search.md#scope-and-filters).

### Field projection

`fields` selects which properties come back. It is repeated rather than comma-separated
(`fields=name&fields=email`). Omitting it returns everything in scope.

| Route | Always returned regardless of projection |
|---|---|
| Entity list, entity read | `_id`, `_identity` |
| MCP search tools | `_id`, `_entityTypeKey`, `_identity` |
| Neighbours — the centre entity | `_id`, `_identity` |
| Neighbours — neighbour entities | `_id`, `_entityTypeKey`, `_identity` |

`_identity` is there only where the entity has one the lens shows.
| Neighbours — relations, via `relationFields` | `_id`, `_relationTypeKey`, `direction` |

Projection has one non-obvious effect: naming a `document` property in `fields` returns its
raw content inline instead of the usual size stub. See
[capabilities/documents.md](../capabilities/documents.md).

Projection is available on entity list and read, on neighbours (as `fields` and
`relationFields`) and on the MCP search tools. Relation list and relation read do not
take it.

### Naming irregularities

`min_score` on saved-query discovery is the one snake_case runtime query parameter.
Other runtime parameters follow their documented names, including `filter.<key>`.

### Compatibility of names

A rename of an API, MCP or configuration name is a hard cut: there is no deprecated alias
or second spelling. Stored data and transfer payloads are upgraded instead. Two supported
spellings would double every check and leave callers unsure which is current. This is the
compatibility policy for names, not permission to change an architectural contract without
review.

### Errors

Every REST error response has the same envelope:

```json
{ "error": { "code": "...", "message": "...", "details": { } } }
```

There are exactly ten top-level codes:

| Condition | Status | Code | `details` |
|---|---|---|---|
| No valid credential (authentication on) | 401 | `UNAUTHENTICATED` | — |
| The caller's roles do not allow it (authentication on) | 403 | `FORBIDDEN` | — |
| The identity provider's keys cannot be fetched to check a token (authentication on) | 503 | `PROVIDER_UNAVAILABLE` | — |
| Resource does not exist | 404 | `RESOURCE_NOT_FOUND` | — or `code` |
| Uniqueness or referential conflict | 409 | `RESOURCE_CONFLICT` | —, `code` or `violations` |
| Input rejected | 422 | `VALIDATION_ERROR` | `fields` map, `errors` list, `violations` list with `total`, or `items` list |
| Change requires explicit cascade | 409 | `CASCADE_REQUIRED` | `affectedLenses`, `affectedIndices` |
| Unexpected storage failure | 500 | `STORAGE_ERROR` | `errorId` |
| Malformed request body | 400 | `INVALID_JSON` | — |
| Request body over the configured limit | 413 | `PAYLOAD_TOO_LARGE` | — |

Four refinements:

**`details.code` narrows, it does not replace.** Where it appears, the top-level code
stays one of the ten. A search with a `semantic` block and no embedding provider, saved-query discovery with no embedding provider, an AI request with no
language-model provider configured answers `422 VALIDATION_ERROR` with `details.code` of `FEATURE_DISABLED`.
An assistant thread that is unknown, expired, bound to another assistant or started by
another principal answers `404 RESOURCE_NOT_FOUND` with `details.code` of
`THREAD_NOT_FOUND`, and a message to a thread still running `409 RESOURCE_CONFLICT` with
`details.code` of `THREAD_BUSY` ([thread store](../architecture.md#thread-store)).

**A refused relation rules write carries its violations.** A relation rules change — on
create, update or import — that the stored relations break answers `409
RESOURCE_CONFLICT` with `details.violations`: one entry per broken rule, `two_parents`,
`cycle` or `duplicate_pair`, each with the `count` of offending entities, or of pairs
for `duplicate_pair`, and up to five entities as `{type, id}`, a pair by its source
([capabilities/schema-modeling.md](../capabilities/schema-modeling.md#relation-rules)). The
message carries the counts, so an MCP caller sees them too.

**`STORAGE_ERROR` carries an id, not a cause.** A driver message names the vendor and its
physical objects, which must not reach a client. The adapter logs the original against a
generated `errorId` and returns only that id, so a reported failure can still be traced to
its server-side record. This error does not promise that a failure is retryable. Expected
domain conditions use their documented errors
([ADR 0012](../adr/0012-unexpected-storage-failures-become-storeerror.md)).

**What a caller holds no role in is not found.** An ontology or lens outside the caller's
assignments answers `RESOURCE_NOT_FOUND`, as an unknown key does; `FORBIDDEN` is for what
the caller may know of ([capabilities/authentication.md](../capabilities/authentication.md#what-a-caller-sees)).
A `401` carries a `WWW-Authenticate` challenge ([sign-in](server.md#sign-in)).

When a value cannot be coerced, its field error names the expected schema type and
describes the received value by its JSON type. Field errors are strings in
`details.fields`; failures that do not involve a type use the same string-valued shape
([ADR 0014](../adr/0014-received-values-named-by-their-json-type.md)).

MCP reports the same failures as tool errors. Because a tool error is a single string, the
per-field detail that REST returns under `details.fields` is flattened into the message
text, so a model still sees every offending field in one response. A refused relation
rules write carries its violation list under `details.violations`; MCP reports its
message, which states the count per rule. A rejected submit or commit of a changeset
carries its own list there ([changesets](runtime-rest.md#changesets)); MCP appends each listed violation
to the message.

`FEATURE_DISABLED` applies to the two routes that need an embedding provider — semantic
search and saved-query search — and to AI execution and entity identity comparison. A
client can distinguish a switched-off capability from a rejected request. Model-free
operations remain available: agent discovery, retriever management and navigator
management do not require a language-model provider; execution requirements are listed
with the routes in each surface file. Agent chat requires a language-model provider
([capabilities/agents.md](../capabilities/agents.md)).

A create or update that would give an entity an identity another entity of its type holds
answers `RESOURCE_CONFLICT` with `details.code` of `IDENTITY_TAKEN`, `details.identity` and
`details.properties`, the type's identity property keys; it never names the other entity
([capabilities/entity-identity.md](../capabilities/entity-identity.md#writes)). Setting an
identity the stored entities cannot take answers `RESOURCE_CONFLICT` with
`details.violations`, each `{rule, count, entities}`, the rule `missing_value`, `duplicate`
or `too_long`.

A relation create that would link a pair a [one-per-pair](../capabilities/schema-modeling.md#one-per-pair)
relation type already links answers `RESOURCE_CONFLICT` with `details.code` of
`PAIR_TAKEN` and `details.relationTypeKey`; it never names the other relation
([capabilities/instance-data.md](../capabilities/instance-data.md#relations)).

A data write whose ontology's design keeps changing while it runs, or a write or modeling
change that waits too long for another one, answers `RESOURCE_CONFLICT` and has written
nothing; it may be sent again ([architecture.md](../architecture.md#design-revision)).

Call `GET /api/server/features` first all the same. Probing lets a client hide what is
unavailable, rather than offering it and explaining the refusal afterwards.

### Who may call

With authentication off, every route serves every caller. With it on, every route except
sign-in, `/api/server`, the probes, the API description and the resource metadata needs a
signed-in caller — a bearer access token, or on REST the browser's session cookie — holding
the role the route needs ([capabilities/authentication.md](../capabilities/authentication.md#roles)):

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
| Runtime routes, plain and below a ruleset, and the runtime MCP mounts | Reader, Proposer or Writer on the lens for a route that reads — chat, search and query among them — Proposer or Writer for one that stages — a changeset's check among them — Writer for every other; the operation of each is its ruleset [write access](../capabilities/rulesets.md#write-access-levels) operation |
| `/api/users`, `/api/ontologies/{ontologyKey}/access` | Platform Administrator or an Ontology Administrator, narrowed per [route](server.md#user-management) |

A request without a valid credential answers `401 UNAUTHENTICATED` with a
`WWW-Authenticate: Bearer` challenge, carrying `error="invalid_token"` when a token was
sent. A disabled principal, a role the caller lacks on something it may know of, and a
request by session cookie that may change something without the deployment's own
`Origin` answer `403 FORBIDDEN`. An ontology or lens outside the caller's roles answers
`404 RESOURCE_NOT_FOUND`, as an unknown key does. A bearer token that cannot be checked
because the provider's keys cannot be fetched answers `503 PROVIDER_UNAVAILABLE`; nothing
is admitted unchecked.

## What is not exposed

Reasonable things to look for that are absent everywhere — REST, MCP and the web client.

| Absent | Consequence |
|---|---|
| Data-wipe endpoint | Instance data is removed one entity or relation at a time; deleting the whole ontology is the only bulk removal |
| Instance-data export | Transfer moves the design only; data leaves through queries or listing |
| Single-property read on modeling | List the owning type's properties |
| Cross-lens read | No route or tool sees two lenses at once |
| Cross-ontology anything | No route or tool sees two ontologies at once; overviews are a client-side concern |
| Registry over MCP | Ontology management is REST/UI only; `ensure_ontology` is the sole, self-scoped exception |

Multi-tenancy is absent by design and is discussed in
[architecture.md](../architecture.md#what-the-architecture-does-not-provide).
