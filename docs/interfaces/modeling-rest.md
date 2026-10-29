# Modeling REST

Prefix `/api/ontologies/{ontologyKey}/model`. This surface covers one ontology's whole
schema; see [how an ontology is addressed](README.md#how-an-ontology-and-a-lens-are-addressed) before using it. Semantics:
[capabilities/schema-modeling.md](../capabilities/schema-modeling.md) and
[capabilities/ontology-lenses.md](../capabilities/ontology-lenses.md).

Find routes for [lenses](#lenses), [entity types](#entity-types),
[relation types](#relation-types), [properties](#property-definitions),
[scope inclusions](#scope-inclusions), [assistants](#agent-configurations),
[saved queries](#saved-queries), [search indices](#search-indices), or
[schema-wide operations](#schema-wide-operations).

## Lenses

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/lenses` | Create a lens | — |
| GET | `/lenses` | List the ontology's lenses | — |
| GET | `/lenses/{lensId}` | Read one lens | — |
| PUT | `/lenses/{lensId}` | Update name or description; the key is immutable | — |
| DELETE | `/lenses/{lensId}` | Delete a lens with its changesets, answering `{changesetsDeleted}`; the schema and its data are untouched | — |
| POST | `/lenses/{lensId}/validate` | Check this lens's inclusions against the schema | — |

## Entity types

| Method | Path | Purpose | Parameters |
|---|---|---|---|
| POST | `/entity-types` | Create an entity type together with its name property (`nameProperty`, default `name`), optionally with an identity (`identityProperties`) | `cascade` |
| GET | `/entity-types` | List the ontology's entity types | — |
| GET | `/entity-types/{entityTypeId}` | Read one entity type | — |
| PUT | `/entity-types/{entityTypeId}` | Update display name, description, name property (`nameProperty`) or identity (`identityProperties`; null clears it) | `cascade` |
| DELETE | `/entity-types/{entityTypeId}` | Delete an entity type and its properties | `cascade` |

## Relation types

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
field error ([capabilities/schema-modeling.md](../capabilities/schema-modeling.md#relation-rules)).

## Property definitions

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
([capabilities/schema-modeling.md](../capabilities/schema-modeling.md#the-cascade-protocol)).

## Scope inclusions

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
[capabilities/ontology-lenses.md](../capabilities/ontology-lenses.md#search-through-a-lens).

## Agent configurations

Per-lens, addressed by lens key and assistant key. Semantics:
[capabilities/agents.md](../capabilities/agents.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/lenses/{lensKey}/assistants/agents` | List the lens's agent configurations |
| GET | `/lenses/{lensKey}/assistants/agents/{assistantKey}` | Read one agent configuration |
| PUT | `/lenses/{lensKey}/assistants/agents/{assistantKey}` | Create or replace one; answers 201 on create, 200 on replace |
| DELETE | `/lenses/{lensKey}/assistants/agents/{assistantKey}` | Delete an agent configuration |

The built-in default agent is not a modeling resource: it is not listed, and `_default`
can be neither read nor written here.

## Saved queries

Per-lens, addressed by lens key. Semantics:
[capabilities/saved-queries.md](../capabilities/saved-queries.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/lenses/{lensKey}/saved-queries` | List the lens's saved queries |
| PUT | `/lenses/{lensKey}/saved-queries/{queryKey}` | Create or replace one; answers 201 on create, 200 on replace |
| DELETE | `/lenses/{lensKey}/saved-queries/{queryKey}` | Delete a saved query |

## Retrievers

Per-lens, addressed by lens key and assistant key. Semantics, configuration and validation:
[capabilities/retrievers.md](../capabilities/retrievers.md).

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

## Navigators

Per-lens, addressed by lens key and assistant key. Semantics, configuration and validation:
[capabilities/navigators.md](../capabilities/navigators.md).

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

## Search settings

The ontology's keyword language set and its managed-index switches. Semantics:
[capabilities/search.md](../capabilities/search.md#keyword-language) and
[capabilities/search-indices.md](../capabilities/search-indices.md#managed-indices).

| Method | Path | Purpose |
|---|---|---|
| GET | `/search-settings` | Read `keywordLanguages` and `disabledIndices`, the managed indices switched off |
| PUT | `/search-settings` | Change either or both; an absent field stays as it is. Answers the settings now in force |

A PUT is validated whole before anything is written; field errors name `keywordLanguages`
or `disabledIndices.<i>` for a key that names no managed index.

## Search indices

Managed and custom search indices, addressed by index key. Semantics:
[capabilities/search-indices.md](../capabilities/search-indices.md).

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
[entry outline](../capabilities/search-indices.md#entry-outline), one part per entry kind
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

## Schema-wide operations

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
([capabilities/ontology-lenses.md](../capabilities/ontology-lenses.md#validation-warnings)).

Rebuild answers with a stream of newline-delimited JSON progress records rather than one
body, because it can run over many items. It is never refused for a missing embedding
provider: without one it skips the vector work and says so in its summary. It does not
touch search indices. After an embedding-provider switch it is run once per ontology. See
[capabilities/search.md](../capabilities/search.md#rebuild).

Transfer carries the design only — schema, lenses, agents, saved queries, retrievers,
navigators, search indices; no instance
data and no ontology identity — see
[capabilities/transfer.md](../capabilities/transfer.md) and
[capabilities/search.md](../capabilities/search.md).
