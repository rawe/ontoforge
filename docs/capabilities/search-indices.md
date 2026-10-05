# Search indices

A search index decides what ranked search can find an entity by. It names a root entity
type and the text composed for each entity of that type; ranked search ranks those texts
and returns the entities that own them. On an adapter that stores search indices — the
default deployment — every ranked search reads them ([search.md](search.md)); an adapter
that stores none ranks by other means, recorded in
[../storage-adapters.md](../storage-adapters.md#where-the-adapters-diverge).

Vocabulary: [../README.md](../README.md#glossary). The rules these follow:
[../decisions.md](../decisions.md).

## What a search index is

An index is an ontology-level design object. It has a key, unique within the ontology, a
name and a description, and a definition:

- the **root entity type** — every hit is an entity of this type;
- the **fields** — properties of the root whose values are composed into text;
- the **header** — a short prefix of the root's own fields that starts every entry
  except the entity's own, by default its [name property](schema-modeling.md#the-name-property);
- **relation groups** — each follows one relation type in one direction, one hop, and
  names the relation's properties and the target entity's properties to include;
- the **representations** it keeps — semantic (a vector per entry) and keyword (a
  stemmed full-text representation per entry), either or both.

An index is stored once per ontology and serves every lens of it. An unscoped lens
searches every index; a scoped lens only the indices it includes
([ontology-lenses.md](ontology-lenses.md#search-through-a-lens)).

### Entries

An index holds **entries**: indexed texts, each owned by exactly one entity of the root
type. An entity's entries are of three part kinds:

| Part | Content | Per entity |
|---|---|---|
| Own fields | the type label and the entity's own field values | one; none when no field has a value |
| Relation | the header, the group label, the properties of one relation instance and those of the entity at its other end | one per relation instance of each group |
| Passage | the header and one chunk of a document field | one per chunk |

**An entry never combines relations.** Each relation entry holds exactly one relation
instance; two relation types, or two instances of one, never share an entry
([../decisions.md](../decisions.md#behaviour)). A question that spans two relations is
answered by an exact filter or by fusing rankings at entity level, not by one entry.

A search ranks entries and groups them by entity: the entity's best entry scores it and is
reported as what matched ([search.md](search.md#ranking)).

## Managed indices

The server derives and keeps two kinds of index from the schema, with no configuration:

- **Default index** — one per entity type, keyed `<entityTypeKey>~default`, over every
  own `string` property of the type, with both representations and no header. Every
  entity type has one, since its name property is a `string`.
- **Passage index** — one per document property, keyed
  `<entityTypeKey>~<documentPropertyKey>`, with both representations. Each chunk of the
  document is one passage entry, headed by the entity's name. A document property keyed
  `default` has none, since its key would be the default index's.

`~` occurs in no key a caller can choose, so a managed key never collides with another
key.

**Managed indices follow the schema.** Every schema change derives them again: a new
entity type or document property gets its index, a deleted one loses it, and a changed
derived definition — a `string` property added or deleted — starts a new
[generation](#lifecycle) built from the current data. Values of a deleted property
therefore leave search once that generation is ready, and a new property counts once it
is. A changed display name, or a reassigned name property, re-composes the existing
entries of every index that renders that type, without a new generation. Managed
definitions cannot be edited.

A managed index that comes into existence is included in every scoped lens that exposes
its root type ([ontology-lenses.md](ontology-lenses.md#search-through-a-lens)).

**A managed index can be switched off.** The ontology's search settings list the managed
indices that are off ([../interfaces.md](../interfaces.md#search-settings)). A change
names exactly the indices off afterwards — every other managed index is on — and a key
that names no managed index rejects the whole change before anything is written. A
switched-off index keeps its definition and its lens inclusions but has no entries: its
generations retire, and it contributes nothing to search until it is switched on again,
which builds its generations anew from all entities of its root type. When a schema
change removes a managed index, its switch goes with it.

## Composition

An entry's text is composed from the entity's current state and the **full schema**,
never a lens — two lenses see the same entries. Each entry has two texts, one per
representation:

- **Semantic text** — labelled lines with display names. A block over one type's fields
  starts with the type's display name; when the type's name property is among the
  fields, its value joins that line instead of having a line of its own. A relation
  group's label defaults to the relation type's display name.

  ```
  Person: Ada Lovelace
  Bio: Wrote the first published algorithm.
  Role: Engineer
  ```

- **Keyword text** — the same values in the same order, one per line, with no type,
  field or group label, so a schema label never counts as matching content.

Empty values are omitted. `string` values render as they are; integers, floats,
booleans, dates and datetimes render as text; a document only as passages. Fields render
in the order the definition lists them; a default index lists its type's `string`
properties in key order. Each text is capped at 8,000 code points and cut at the cap.

A text identical to the one already stored for that entry is not processed again, so an
edit that changes no indexed value costs no embedding call.

## Lifecycle

**Entries are built in the background.** A write commits without its entries; they
follow asynchronously, so search is eventually consistent
([../decisions.md](../decisions.md#storage)):

- a created entity is not searchable until its entries are built;
- after an update, the entity's previous entries keep answering until they are replaced;
- a deletion — of an entity or a relation — removes its entries with the write.

The mechanics — the queue written in the write's transaction, the worker, retries — are
in [../architecture.md](../architecture.md#search-indexing).

**Entries belong to generations.** A generation is one build of one representation of
one index, identified by the definition it was built from and, for semantic entries, the
embedding model, for keyword entries the [keyword language set](search.md#keyword-language).
Search reads only the ready generation of each index and representation, and for semantic
entries only one built with the embedding model in use. When the definition, the model or
the language set no longer matches, a new generation is built from all entities of the root type beside the
ready one, which keeps serving until the new one is complete and then gives way in one
step. Until a semantic generation of the current model is ready, that index contributes
nothing semantic — hybrid search then answers from keyword entries alone.

**Keyword entries are built first.** They need no model, so after a backfill keyword
search answers before semantic search does. Without an embedding provider no semantic
generation is built and keyword search is all there is.

**Failures do not fail writes.** Building an entry that fails is retried with growing
delays; after a configured number of attempts it counts as failed and waits for a new
write of its entity. A new generation with failed entries does not complete, and the
generation it would replace keeps serving.

## Through the interfaces

Indices are reached through ranked search: `GET search`, the MCP and agent search tools
and saved-query search steps search the managed indices of the requested types, and each
hit names the entry that matched ([search.md](search.md#response)). The server's feature
report says whether the storage adapter stores search indices
([../interfaces.md](../interfaces.md#server)).
