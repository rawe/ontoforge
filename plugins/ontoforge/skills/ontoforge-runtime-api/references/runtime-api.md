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

Two runtime-relevant routes sit outside this prefix and describe the deployment rather
than any ontology: `GET /api/server/info` and `GET /api/server/features`.

When authentication is enabled, every request — these two included — also carries
`Authorization: Bearer <token>`. See [building-apps.md](building-apps.md#connecting).

## Core Rules

- Base path: `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`
- Deployment reads: `GET /api/server/info`, `GET /api/server/features`
- Everything on this surface is addressed by **keys** — ontology key, lens key, type key,
  property key — plus instance ids for entities and relations. Internal identifiers
  appear on the modeling surface, never here
- Use `Content-Type: application/json` for JSON `POST` and `PATCH` requests
- If type keys or property keys are unknown, inspect the schema first
- Field names are `camelCase`; keys are `lower_snake_case`
- Property filter syntax is `filter.{key}` or `filter.{key}__{op}`; on entity lists and
  search `{key}` may also be a query path (see Listing, Sorting, Filtering)
- Supported filter operators, on properties and query paths alike: no suffix for
  equality, `__ne`, `__gt`, `__gte`, `__lt`, `__lte`, `__contains`, plus the existence
  tests `__exists` and `__missing`, which take `true`/`false` and also accept a bare
  relation type as the key
- `fields` is repeated, not comma-separated: `fields=name&fields=email`
- One query parameter is `snake_case` against the surrounding convention: `min_score` on
  saved-query search

## Listing, Sorting, Filtering

Entity and relation lists share one parameter vocabulary.

| Parameter | Meaning |
|---|---|
| `limit` | Page size, 1–200, default 50 |
| `offset` | Rows to skip, default 0 |
| `sort` | Property key, or `_createdAt` / `_updatedAt`; default `_createdAt`. The underscore may be omitted. Entity lists of a type with an identity also sort by `_identity` (underscore required) |
| `order` | `asc` or `desc`, default `asc` |
| `q` | Case-insensitive substring across every `string` property in scope. **Entity lists only**; `document` properties are not searched |
| `filter.{propertyKey}[__{op}]` | Property filter, repeatable. Entity lists of a type with an identity also filter on `_identity`, as a string |
| `filter.{relationTypeKey}[:out\|:in].{propertyKey}[__{op}]` | Query path — a property of the related entity; entity lists and search, repeatable |
| `filter.{relationTypeKey}[:out\|:in]@{propertyKey}[__{op}]` | Query path — a property stored on the relation itself; entity lists and search, repeatable |
| `filter.{relationTypeKey}[:out\|:in]__exists` / `__missing` | Relation existence — whether any relation of the type exists; entity lists and search, repeatable |

A list response carries `items`, `total`, `limit` and `offset`. `total` is the count
before paging.

Filter values arrive as text and are coerced to the property's declared data type before
comparison; `__contains` is compared as text. A comparison never matches a missing
value — `filter.status__ne=archived` keeps the entities whose status exists and is not
`archived`, not the ones without a status. `__exists` and `__missing` test presence and
take a boolean flag instead of a value: `filter.email__missing=true` (the readable form
of `filter.email__exists=false`) keeps the entities without an email; the property's data
type plays no part. An unknown property key, an unknown
operator suffix, an uncoercible value and a non-boolean existence flag are each
rejected — and a request carrying
several faulty filters is rejected once, every fault under its own filter key as sent
(`age__gt`, not `age`) in `details.fields`, so one rejection is enough to correct every
filter of the next attempt.

A **query path** crosses exactly one relation type and filters by a property reached
through it: `.` reads the related entity's property, `@` reads the relation's own
property and never touches the related entity. Listing persons with
`filter.works_for.name=Acme` returns the persons employed by Acme, with
`filter.works_for@role=CTO` the persons holding a CTO employment; listing companies with
`filter.works_for.age__gt=30` returns the companies with at least one employee over
thirty.

- **Direction is derived, or marked.** When the listed type is only the relation type's
  source the path runs outgoing, to the target; when only its target, incoming, to the
  source. A `:out` or `:in` marker on the relation segment must agree with that
  direction. On a self-relation, whose source and target are both the listed type, the
  marker is required: `filter.manages:out.name=Bob` returns the persons who manage a
  Bob, `filter.manages:in.name=Alice` the persons managed by an Alice.
- **Matching is existential.** An entity matches when at least one relation of the type
  satisfies the condition. Conditions are independent — two paths through the same
  relation type may be satisfied by two different relations — and paths combine with
  each other and with plain filters by AND. An entity with no relation of the type
  never matches.
- **The value is coerced by the final property**, with the same operators as a plain
  filter; `__contains` stays textual. Under a comparison, a path cannot end in a
  `document` property. `__exists`/`__missing` on a path test the reached value under the
  same existential quantifier, and may end in a `document` property:
  `filter.works_for@role__missing=true` returns the persons with an employment that
  carries no role, `filter.works_for.profile__exists=true` the persons employed by a
  company with a profile.
- **A bare relation type tests relation existence.** Under `__exists` or `__missing`
  only, the key may be the relation type alone: `filter.works_for__missing=true` returns
  the persons employed nowhere, `filter.supersedes__missing=true` the entities nothing
  supersedes — the current versions, without any stored flag. The direction follows the
  relation type's endpoints as for a path, and the `:out`/`:in` marker is required on a
  self-relation (`filter.manages:in__missing=true` for the persons nobody manages). A
  relation type under any comparison operator is rejected.
- **Paths and relation existence are a filter feature of entity lists and search
  only.** Relation lists reject them, `sort` rejects them, `fields` treats one as an
  unknown name, and no response carries a path value.
- **Path faults are collected like any other**, each under the filter key as sent. A
  path resolves against the lens: a relation type, related entity type or property the
  lens hides fails exactly as one that does not exist, and a detail lists only what the
  lens exposes.

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
  `filter.{key}`, `filter.{key}__{op}` — `{key}` a property key or a query path

- `GET /entities/{entityTypeKey}/{entityId}`
  Reads one entity.
  Query parameters: `fields`

- `PATCH /entities/{entityTypeKey}/{entityId}`
  Partial update.
  Request body: changed properties only. An explicit `null` clears an optional property;
  `null` on a required property is rejected.

- `DELETE /entities/{entityTypeKey}/{entityId}`
  Deletes the entity **and every relation attached to it**.

Entity list and read always return `_id` regardless of projection, and `_identity`
where the entity has one.

## Entity Identity

An entity type may declare an **identity**: `identityProperties`, an ordered list of 1–5
of its `string`, `integer` or `date` properties (shown on the schema reads; `null` when
the type has none, or the lens does not show all of them). These properties are always
required. An entity's identity is their values in that order, joined with `~`; in a
`string` value `%` is written `%25` and `~` `%7E`. An `integer` is plain decimal, a
`date` `YYYY-MM-DD`. Matching is exact: no trimming, no case folding.

- Entity reads carry the identity as the read-only system property `_identity`. Never
  send it in a write.
- The identity is unique within the type. A create or update that would give an entity
  another entity's identity answers `409 RESOURCE_CONFLICT` with
  `details: {"code": "IDENTITY_TAKEN", "identity": "…", "properties": ["…"]}`.
- The id stays the entity's reference everywhere. The identity is a second address, for
  clients that know an entity by its values (an upstream key, a code and a year).
- Every route below `/entities/{entityTypeKey}/{entityId}` has an identity twin below
  `/entities/{entityTypeKey}/identity/{identity}` — read, update, delete, `/path`,
  `/neighbors` and `/documents/{propertyKey}`. URL-encode the identity as one path
  segment. An unknown identity answers `404`.
- Where a body or query names an entity by id, an identity twin names it by identity:
  `fromEntityIdentity` / `toEntityIdentity` beside `fromEntityId` / `toEntityId` on
  relation create and list, `parentIdentity` beside `parentId` in `parentRelation`.
  A pair takes one of its two, never both (`422`); where the end is required, exactly one.
- There is no create-or-update: a create refuses a taken identity, and an update never
  creates. To upsert, read by identity first, then create or update.
- Changing an identity property's value renames the identity. The old identity is not
  kept: it no longer finds the entity.

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
carry `_id` and `_entityTypeKey` (and `_identity` where they have one); relations carry `_id`, `_relationTypeKey` and
`direction`.

## Search

Two routes rank for one plain query text through a scope of **search indices**:
`POST /search/entities` ranks entities, `POST /search/passages` passages of documents.
Both return the order only, never a score.

- `POST /search/entities`
  Ranks entities. JSON body:
  ```json
  { "query": "CTO at ACME", "types": ["person"], "keyword": {"match": "any"},
    "semantic": {"minSimilarity": 0.6}, "filter": {"works_for.name": "ACME"}, "limit": 10 }
  ```
  Only `query` is required. Scope: `types` (entity type keys) or `indices` (index keys,
  custom ones included), not both; neither reads every type the lens shows through its
  managed indices. Methods: one block per method — `keyword: {match}`, `any` (default; a
  hit carries at least one query word) or `all` (every query word), and
  `semantic: {minSimilarity}`, 0–1 on the `(1 + cosine) / 2` scale, which drops semantic
  candidates below it. The blocks sent choose the methods, and two are fused; with
  neither, both run, or keyword alone without an embedding provider. `filter` takes the
  `filter.*` keys of the entity list without the prefix, query paths included, values as
  strings; a type that does not declare every key, or that a query path does not resolve
  from, drops out. Substring operators are rejected. `limit` counts entities, 1–100,
  default 10.

  The response is `{ran, items, limitations}`; `ran` lists the methods that ran. Each
  item has `rank` (from 1), `entity` — `{_id, _entityTypeKey, name}`, plus `identity`
  (the identity properties and their values) for a type with an identity the lens
  shows — and `match`, the best entry that found it: `{index, part, snippet}`, `part`
  being `self`, `relation` or `passage`. A passage adds `property` (null when the lens
  hides the document), `charOffset` and `charLength`; a relation adds `relationType` and
  `target` (`{_id, _entityTypeKey, name}`). `snippet` is null when the index reads a
  property the lens hides. Items carry no other properties: read the entity for them.

- `POST /search/passages`
  Ranks passages. The body of `POST /search/entities`, with `documents` (`type.property`)
  as a third scope field — `types`, `documents` or `indices`, one at a time — plus
  `perEntity` (1 to the limit; at most that many passages per entity, no cap when
  omitted) and `text` (default true; false leaves the passage text out). `limit` counts
  passages. Each item has `rank`, `entity` as above and `passage`
  `{property, ordinal, charOffset, charLength, text}`. Use the coordinates as `offset` and
  `limit` on a document read.

What could not run is a limitation, not an error: each has `code` (`not-searchable`,
`switched-off`, `not-ready`, `filter-excludes-all-types`), `message` and, where they
apply, `method`, `indices`, `types` and, on passages, `documents`. Every broken rule is
collected under `details.fields` at the request's own path — `query`, `types.<i>`,
`indices.<i>`, `documents.<i>`, `keyword.match`, `semantic.minSimilarity`,
`filter.<key>`, `limit`, `perEntity`; a body of the wrong shape, or with a field not
listed here, is rejected with `details.errors`. A `semantic` block without an embedding
provider answers `FEATURE_DISABLED`.

Under keyword ranking each query word also matches as a prefix; matches across languages
come from semantic ranking.

### Search indices

Ranked search reads **search indices**: per entity type a managed default index
(`<type>~default`, its own string properties), per document property a passage index
(`<type>~<documentProperty>`), and custom indices defined in modeling — which may hold one
entry per relation instance (e.g. a person's role at one company) so an entity can match
through its relations. Entries are built in the background after each write: a new entity
is searchable once its entries are built. Keyword search stems in the ontology's keyword
languages (English, German or both); no request names a language. Without `indices`, both
search routes read the managed indices of the requested types; with it, any indices the
lens can search, by key.

- `GET /search-indices`
  The lens's search catalog, in key order: per index `key`, `kind` (`default`, `passage`,
  `custom`), `name`, `description`, `entityType`, `fields`, `relations` (each
  `{relationType, direction, label}`), `documentProperty`, `modes` and `status`.

MCP has search tools of its own — `search`, `search_documents`, `search_by_index` and
`list_search_indices` — with their own arguments and response; they take no similarity
floor from the caller and apply a fixed one of 0.75 whenever they rank semantically.

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

## Entity Identity Comparison

- `POST /decisions/compare-entities`
  Judges whether two partial property snapshots of one entity type describe the same
  real-world entity. Read-only: it finds no candidates, reads no instance data and
  merges nothing.
  Request body — exactly these three fields:
  ```json
  { "entityTypeKey": "person",
    "left":  { "name": "Ann Lee", "email": "ann@example.com" },
    "right": { "name": "A. Lee", "email": null } }
  ```
  Snapshot values are JSON scalars or `null` (unknown, not disagreement); unknown,
  system, `document` and lens-hidden properties are rejected. Answers `decision`
  (`same`, `different` or `insufficient` — a normal outcome), `probabilities` (keys
  `same`, `different`, `insufficient`), `confidence` and `truncatedFields`.
  Needs a Decision provider (`decisions` in the feature probe), independently of AI and
  search; without one it answers `FEATURE_DISABLED`. There is no MCP tool.

## AI Endpoints

Assistants live under `/ai/assistants/<kind>`, where `<kind>` is `agents` (the model works
step by step with read-only tools), `retrievers` (a fixed pipeline searches the lens's
search indices and answers from what it found) or `navigators` (a fixed pipeline walks the
lens's graph from what the question names and answers citing the entities it met). Every
kind has the same three routes;
retrievers add a fourth. Assistants are configured on the modeling surface; runtime lists
and runs them.

- `GET /ai/assistants/<kind>`
  Lists the lens's assistants of that kind as `key`, `name`, `description`, `builtIn`.
  The built-in default comes first: key `_default`, name `Default`, `builtIn: true`. It
  needs no configuration, exists on every lens and is addressed by its key like any other.

- `POST /ai/assistants/<kind>/{assistantKey}/chat`
  One message to one assistant. Request body: `message` (1–2,000 characters), optional
  `threadId`; unknown fields are rejected. Without `threadId` the message starts a new
  thread; with it, the message continues that thread. The client sends only its new
  message — the server holds the conversation.

- `GET /ai/assistants/<kind>/{assistantKey}/threads/{threadId}`
  Reads a thread back: `threadId` and `messages`, each `role` (`user` or `assistant`) and
  `content`, in order, without tool payloads. Runs no model.

A thread belongs to the assistant that started it. An unknown, expired or other
assistant's thread answers `404 RESOURCE_NOT_FOUND` with `details.code` `THREAD_NOT_FOUND`
— start a new thread. A message to a thread whose previous message is still being answered
answers `409 RESOURCE_CONFLICT` with `details.code` `THREAD_BUSY`; it is never queued.
Threads are kept only for a limited time and are lost when the server restarts.

### Chat stream

A chat answers `application/x-ndjson`: one JSON object per line, each with a `type`.
Refusals — unknown assistant, no provider, unknown or busy thread — are ordinary error
responses before the stream opens.

| Event `type` | Fields | Meaning |
|---|---|---|
| `thread` | `threadId` | Always first: the thread this turn runs on; keep it to continue |
| `delta` | `text` | A fragment of the answer (retrievers and navigators) |
| `final` | `reply` | Terminal: the complete answer |
| `error` | `error` | Terminal: the error object with `code`, `message`, optional `details` |
| `entities` | `entities` (each `ref`, `id`, `type`, `typeName`, `label`, `fields`, `evidence`; a navigator adds `role`, `hop`, `reason`), `links` (`id` of the stored relation, `from`, `to`, `type`, `label`) | The entities the turn met, every kind; replace cards by `ref`, links by `id`; read an entity by `type` + `id` |
| `agent.tool_call` | `callId`, `tool`, `args` | An agent's tool invocation begins |
| `agent.tool_result` | `callId`, `result` | That invocation completes |
| `retriever.phase` | `phase` (`plan`, `retrieve`, `answer`), `status` (`start`, `end`), `durationMs` on end | Progress |
| `retriever.diagnostics` | `plan`, `results`, `limitations`, `searchCalls`, `timings`, `modelIO`, `llmCalls` | Only when requested |
| `navigator.graph` | `steps`, `edges` | The pipeline, once, after `thread` |
| `navigator.step` | `id`, `status` (`running`, `done`, `skipped`, `failed`), `round`, `durationMs` and optional `summary` on end | Progress, in plain words; every `running` is followed by exactly one end of the same `id` and `round`, unless the turn is cancelled; `skipped` arrives alone, with a summary and no duration |
| `navigator.summary` | `modelCalls`, `durationMs`, `entities`, `evidence`, `hops`, `timings` | Once, before `final` |

Ignore kind events you do not know. A stream ends with exactly one `final` or `error`;
EOF without one is an incomplete turn. Closing the connection cancels the turn, and a
cancelled or failed turn leaves nothing in its thread — ask again.

### Agents

An agent answers whole in `final`, never as `delta`; its tool events arrive always. An
agent may be granted exactly twelve runtime tools: `get_schema`, `list_entities`,
`get_entity`, `get_document`, `list_relations`, `get_neighbors`, `search`,
`search_documents`, `execute_query`, `list_saved_queries`, `run_saved_query`,
`search_saved_queries`. Every write tool is outside that set, and so is the read-only
`get_relation`. After an entity tool's result (`get_entity`, `list_entities`,
`get_neighbors`, `search`, `search_documents`), an `entities` event carries the entities it
returned that the turn had not sent yet.

### Retrievers

A retriever's chat body may add `diagnostics` (default `false`) to receive
`retriever.diagnostics`; the request cannot change the retriever's configuration. A
stored retriever the lens can no longer run answers `422 VALIDATION_ERROR` with the
errors under `details.errors`. Before the answer, an `entities` event carries the results
the answer model was given.

- `POST /ai/assistants/retrievers/{assistantKey}/retrieve`
  The entities one query finds, without an answer. Request body: `query` (1–2,000
  characters); unknown fields — `threadId` and `diagnostics` among them — are rejected.
  Answers `200` JSON: `results` (best first, each `entityId`, `entityType`, `label`,
  `conditions`, `matched`), `limitations`, and `unsupportedReason` when no index can
  answer. No results is not an error.

Without an embedding provider a retriever searches by keyword only.

### Navigators

A navigator's answer cites the entities it names by ref — `[E2]`, `[E2, E5]` — matching
the `ref` of an `entities` card with `evidence: true`; resolve a ref to its card's
`id` to read the entity. A stored navigator the lens can no longer run answers
`422 VALIDATION_ERROR` with the errors under `details.errors`. A follow-up on the same
thread may refer to the entities the previous answer cited ("which of them…").

### What needs a provider

Chat and retrieve need a language-model provider (`ai` in the feature probe). Listing and
reading a thread run no model and answer normally without one.

## Deployment Reads

Both describe the deployment, not any ontology — they take no ontology and no lens.

- `GET /api/server/info`
  Response fields: `baseUrl` (the public address clients reach the server at, or null
  when none is configured), `version` (the server's release version)

- `GET /api/server/features`
  Response fields: `semanticSearch`, `searchStrategies`, `ai`, `decisions`

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
| Uniqueness or referential conflict | 409 | `RESOURCE_CONFLICT` | `code: IDENTITY_TAKEN`, `identity`, `properties` for a taken identity |
| Input rejected | 422 | `VALIDATION_ERROR` | `fields` map or `errors` list |
| Change requires explicit cascade | 409 | `CASCADE_REQUIRED` | `affectedLenses` |
| Unexpected storage failure | 500 | `STORAGE_ERROR` | `errorId` |
| Malformed request body | 400 | `INVALID_JSON` | — |

`details.code` narrows, it does not replace: where it appears, the top-level code stays
one of the six.

The one narrowing that matters on this surface is `FEATURE_DISABLED`. A search with a
`semantic` block, saved-query discovery, AI or entity identity comparison without the
required provider
answers `422 VALIDATION_ERROR` with `details: {"code": "FEATURE_DISABLED"}`, which is what
separates it from an ordinary rejected request on the same route:

```jsonc
// AI switched off, request well-formed
{"error": {"code": "VALIDATION_ERROR", "message": "AI feature is disabled (AI_PROVIDER not configured)",
           "details": {"code": "FEATURE_DISABLED"}}}

// same route, malformed request
{"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed",
           "details": {"errors": [{"path": "/message", "message": "…"}]}}}
```

Branch on `details.code` to tell a client "this deployment has no AI configured" instead
of reporting a bad request. Listing assistants and reading a thread never run a model, so
they answer normally even with no provider.

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
| Immediate bulk write | Every immediate create and update is a single object; many objects are staged into a changeset, up to 1,000 calls per `POST …/changesets/{changesetId}/writes`, and committed together with `POST …/changesets/{changesetId}/commit` |
| Instance-data export | The design exports; data leaves through listing or queries |
| Health or readiness endpoint | Liveness must be inferred from a real request |
| Cross-lens read | No route sees two lenses at once |
| Cross-ontology anything | No route sees two ontologies at once |
| Schema mutation | Runtime never edits the schema — that is the modeling surface |

## Recommended Build Pattern For Agents

1. Resolve the **ontology key** and the **lens key** — both are required, and neither has
   a default
2. Probe `GET /api/server/features` before using search, any AI route or decisions
3. Read the schema endpoints if the type or property shape is not already known
4. Choose the narrowest runtime endpoint that solves the task
5. Generate the request with exact path params, query params and JSON body
6. Only use `/query` when CRUD and search endpoints are not enough
