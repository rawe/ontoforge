# Runtime REST

Everything under `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. An unknown
ontology key answers not found before the lens is considered; an unknown lens key
answers not found within the ontology.

Find routes for [schema reads](#schema-introspection), [entities](#entities),
[documents](#documents), [neighbours](#neighbours), [relations](#relations),
[changesets](#changesets), [search](#search), [OQL](#query),
[saved queries](#saved-queries), [identity comparison](#entity-identity-comparison),
or [assistant chat and threads](assistants-rest.md#assistant-chat-and-threads).

## Schema introspection

Read-only, and already filtered to the lens. `/schema` returns the lens's key, name and
description together with the entity types and relation types it exposes, each with its
visible properties. What a relation type carries:
[capabilities/schema-modeling.md](../capabilities/schema-modeling.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/schema` | The whole scoped schema in one response |
| GET | `/schema/entity-types` | Entity types visible through the lens |
| GET | `/schema/entity-types/{entityTypeKey}` | One entity type with its visible properties |
| GET | `/schema/relation-types` | Relation types visible through the lens |
| GET | `/schema/relation-types/{relationTypeKey}` | One relation type with its visible properties |

## Entities

Semantics: [capabilities/instance-data.md](../capabilities/instance-data.md).

Every route below `/entities/{entityTypeKey}/{entityId}` — read, path, update, delete,
documents and neighbours — has an identity twin below
`/entities/{entityTypeKey}/identity/{identity}`, the identity URL-encoded as one segment,
with the same parameters and answers; an unknown identity is not found
([capabilities/entity-identity.md](../capabilities/entity-identity.md#addressing-by-identity)).

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
or that has a relation attached whose type the lens hides, answers `RESOURCE_CONFLICT`. Rules: [capabilities/instance-data.md](../capabilities/instance-data.md#hierarchies).

## Documents

Semantics: [capabilities/documents.md](../capabilities/documents.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/entities/{entityTypeKey}/{entityId}/documents/{propertyKey}` | Read a document property, whole or by character range | `offset`, `limit` |
| PATCH | `/entities/{entityTypeKey}/{entityId}/documents/{propertyKey}` | Partial write | — |

One route covers both partial-write forms, selected by an operation discriminator in the
body: exact string replacement, and overwrite of a character range with an optional guard
against a stale offset. Insert and append are the range form with zero length.

## Neighbours

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/entities/{entityTypeKey}/{entityId}/neighbors` | The entity plus everything connected to it and the connecting relations | `relationTypeKey`, `direction`, `limit`, `fields`, `relationFields` |

`direction` is `outgoing`, `incoming` or `both` (default). `limit` is 1–200, default 50.

## Relations

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/relations/{relationTypeKey}` | Create a relation between two entities, each end by `fromEntityId` or `fromEntityIdentity`, `toEntityId` or `toEntityIdentity` | — |
| GET | `/relations/{relationTypeKey}` | List relations of one type | `limit`, `offset`, `sort`, `order`, `fromEntityId`, `toEntityId`, `fromEntityIdentity`, `toEntityIdentity`, `filter.*` |
| GET | `/relations/{relationTypeKey}/{relationId}` | Read one relation | — |
| PATCH | `/relations/{relationTypeKey}/{relationId}` | Partial update of properties; endpoints cannot change | — |
| DELETE | `/relations/{relationTypeKey}/{relationId}` | Delete a relation; its endpoints are untouched | — |

## Changesets

Semantics: [capabilities/changesets.md](../capabilities/changesets.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/changesets` | Start a changeset, with an optional `note`; 201 | — |
| GET | `/changesets` | List the changesets this URL reaches | — |
| GET | `/changesets/{changesetId}` | Read a changeset with its staged objects by first touch | `offset`, `limit` |
| GET | `/changesets/{changesetId}/documents/{entityTypeKey}/{entityId}/{propertyKey}` | Read the text a commit would leave in a document property, whole or by character range | `offset`, `limit` |
| GET | `/changesets/{changesetId}/entities/{entityTypeKey}/{entityId}` | Read one entity as the changeset leaves it, with its staged object | — |
| GET | `/changesets/{changesetId}/entities/{entityTypeKey}/identity/{identity}` | The same, the entity named by its identity in the changeset's view | — |
| DELETE | `/changesets/{changesetId}` | Discard a draft changeset; 204 | — |
| POST | `/changesets/{changesetId}/writes` | Stage one call, its body discriminated by `operation`, or a list of up to 1,000; 201 | — |
| DELETE | `/changesets/{changesetId}/objects/{objectId}` | Unstage one staged object with its values; 204 | — |
| DELETE | `/changesets/{changesetId}/objects/{objectId}/properties/{propertyKey}` | Cut one staged value; 204 | — |
| POST | `/changesets/{changesetId}/objects/{objectId}/rebase` | Rebase an update, with optional `properties`, the keys to rebase | — |
| POST | `/changesets/{changesetId}/submit` | Submit, with an optional `note` | — |
| POST | `/changesets/{changesetId}/unsubmit` | Unsubmit, with a required `note` | — |
| POST | `/changesets/{changesetId}/check` | Check: run the commit and roll it back; no body | — |
| POST | `/changesets/{changesetId}/commit` | Commit, with an optional `expectedVersion` | — |

A staged call's `operation` is one of nine, each with its keys and no other:
`create_entity` `{type, properties?, parentRelation?}`, `update_entity`
`{type, id, properties?}`, `delete_entity` `{type, id}`, `create_relation`
`{type, fromEntityId, toEntityId, properties?}`, `update_relation` `{type, id, properties?}`,
`delete_relation` `{type, id}`, `edit_document` `{type, id, property}` with the body of
the [document write](#documents), and the [puts](../capabilities/changesets.md#put)
`put_entity` `{type, properties?}` and `put_relation` `{type, fromEntityId, toEntityId,
properties?}`. On the entity operations `identity` may name the entity
in place of `id`, and on `create_relation` and `put_relation` `fromEntityIdentity` and
`toEntityIdentity` the ends, resolved in the changeset's view; `type` is the type key, `id` the target, `properties`
the values as one object, and `parentRelation` the immediate create's. Staging answers
`{id}`, the staged object's id; a create with a parent relation adds `relation: {id}`, an
entity delete that took out staged relations `cascaded`, their ids, `edit_document`
the document write's answer beside `id`, and a put `action`, `create` or `update`, what it
staged. A body that is a list of calls answers the list of their answers, in order; when
any call fails, nothing is staged and the `422 VALIDATION_ERROR` carries `details.items`,
one `{item, code, message, details?}` per failed call, `item` its index in the list and
`code` and `details` the envelope it alone would answer.

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

## Search

Semantics: [capabilities/search.md](../capabilities/search.md).

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| GET | `/search` | Rank entities by properties, document passages, or both | `q`, `type`, repeatable `in`, `strategy`, `min_similarity`, `document.property`, `limit`, `fields`, `filter.*` |
| GET | `/search-indices` | The lens's search catalog: the indices it can search, projected through it | — |
| POST | `/search` | Rank entities through chosen search indices | body: `indices`, `query`, `mode`, `relations`, `filters`, `minScore`, `limit`, `fields` |
| POST | `/search/entities` | Rank entities for a query text through a scope of search indices | body: `query`, `types`, `indices`, `keyword`, `semantic`, `filter`, `limit` |
| POST | `/search/passages` | Rank passages of documents for a query text through a scope of search indices | body: `query`, `types`, `documents`, `indices`, `keyword`, `semantic`, `filter`, `limit`, `perEntity`, `text` |

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
[the search response contract](../capabilities/search.md#response).

The catalog lists, in key order, each index as `key`, `kind` (`default`, `passage` or
`custom`), `name`, `description`, `entityType`, `fields`, `relations` — each
`{relationType, direction, label}` — `documentProperty` (null when none), `modes` and
`status`. Rules: [capabilities/search.md](../capabilities/search.md#the-search-catalog).

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
[capabilities/search.md](../capabilities/search.md#index-search).

`POST /search/entities` takes a JSON body. `query` is required and non-empty. `types`
(entity type keys) or `indices` (index keys), not both, choose the scope. The blocks
`keyword: {match}`, `any` or `all`, and `semantic: {minSimilarity}`, 0–1, choose the
methods; with neither, the best available runs. `filter` carries the `filter.*` keys of the
entity list without the prefix; `limit` counts entities, 1–100, default 10. The response
carries `ran`, `items` and `limitations`. Each item has `rank`, from 1, `entity`
`{_id, _entityTypeKey, name}` and `match` `{index, part, snippet}`, plus `property` (null
when the lens hides the document), `charOffset`, `charLength` for a passage and
`relationType`, `target` for a relation. Each limitation has `code` and `message` and,
where they apply, `method`, `indices`, `types`. A body of the wrong shape, or with a field
not listed here, is rejected with `details.errors`. The request's rules are collected under
`details.fields` at the request's own paths: `query`, `types.<i>`, `indices.<i>`,
`keyword.match`, `semantic.minSimilarity`, `filter.<key>`, `limit`. A `semantic` block
without an embedding provider answers `FEATURE_DISABLED`. Rules:
[capabilities/search.md](../capabilities/search.md#entity-search).

`POST /search/passages` takes the body of `POST /search/entities`, with `documents` —
document properties as `type.property` — as a third scope field: `types`, `documents` or
`indices`, one at a time. `limit` counts passages, 1–100, default 10; `perEntity`, 1 to
the limit, caps the passages per entity; `text`, default true, false leaves the passage
text out. Each item has `rank`, from 1, `entity` `{_id, _entityTypeKey, name}` and
`passage` `{property, ordinal, charOffset, charLength, text}`. Limitations are those of
`POST /search/entities`, with `documents` where it applies. Errors are reported as there,
and also at `documents.<i>` and `perEntity`. Rules:
[capabilities/search.md](../capabilities/search.md#passage-search).

## Query

Semantics: [capabilities/oql.md](../capabilities/oql.md).

| Method | Path | Purpose |
|---|---|---|
| POST | `/query` | Execute one read-only OQL query against the lens |

The response is columnar: an ordered list of column names plus the rows.

## Saved queries

Runtime runs them; modeling defines them. Semantics:
[capabilities/saved-queries.md](../capabilities/saved-queries.md).

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

## Entity identity comparison

Semantics and request/response contract:
[capabilities/entity-identity-comparison.md](../capabilities/entity-identity-comparison.md).
Requires a Decision provider, independently of AI and search.

| Method | Path | Purpose |
|---|---|---|
| POST | `/decisions/compare-entities` | Judge the identity of two supplied partial snapshots of one scoped entity type |

## Rulesets

Prefix `/api/ontologies/{ontologyKey}/runtime/rulesets`. One ontology's rulesets, without a
lens. Semantics: [capabilities/rulesets.md](../capabilities/rulesets.md).

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
[write access](../capabilities/rulesets.md#where-write-access-is-checked) does not allow
answers `RESOURCE_CONFLICT` before it runs. Writes stay in the
[anchor's subtree](../capabilities/rulesets.md#what-is-held): its refusals are field errors,
and a deleted anchor or an anchor's entity the lens hides answers `RESOURCE_CONFLICT` to
every write. The MCP equivalent is the [ruleset mount](mcp.md#how-a-mount-is-bound).
