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
searches every index; a scoped lens only the indices it includes — managed or custom,
each only while the lens exposes its root type — and lens validation warns when a lens
hides properties an included index reads
([ontology-lenses.md](ontology-lenses.md#search-through-a-lens)).

There are two kinds. **Managed indices** are derived by the server from the schema and
can only be switched off ([below](#managed-indices)); **custom indices** are defined in
modeling, and only they have relation groups, a chosen header or templates
([below](#custom-indices)).

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

## Custom indices

A custom index is written by a modeler: it chooses the root type, the fields, the header,
the relation groups, the templates and the representations. Its key follows the shared
key rules, so it never contains `~` and never collides with a managed key; a name and a
description are required, and neither may be blank — the description is written for
whoever picks an index to search. A definition looks like this:

```json
{
  "key": "person_employment",
  "name": "People by employment",
  "description": "People with their roles at companies and since when.",
  "entityType": "person",
  "fields": ["name", "bio"],
  "header": null,
  "relations": [
    {
      "relationType": "works_for",
      "direction": "outgoing",
      "fields": ["role", "since"],
      "target": { "company": ["name", "founded"] },
      "label": "Employment",
      "template": "{name}, {role} at {target.name}, since {since}."
    }
  ],
  "semantic": { "enabled": true, "template": null },
  "keyword": { "enabled": true }
}
```

Every part but key, name, description and root type may be left out: absent fields and
groups count as none — though an index needs one of them — an absent header is the name
property, absent templates are none, and both representations are on.

### Relation groups

A relation group follows one relation type in one direction from the root: `outgoing`
when the root type is the relation type's source, `incoming` when it is its target. It
names the relation's own properties to include (`fields`) and those of the entity at the
other end (`target`, keyed by that entity's type — the relation type's other endpoint,
the one key it can hold). A group reaches the root's relations and the entities on their
other end, nothing further: one hop
([../decisions.md](../decisions.md#behaviour)).

**Pairing is per relation instance.** Each relation of the group yields one entry of the
entity on the root side, holding that relation's properties together with those of the
very entity it points at — never another relation's, never a merge of several
([entries](#entries)). An entity with three employments has three employment entries,
and each can match on its own. A group with only relation fields still yields one entry
per relation; one with only target fields carries the related entity's fields and none
of the relation's.

The group's `label` heads its entries' semantic text; without one, the relation type's
display name does. Two groups may follow the same relation type only in different
directions — a relation type from a type to itself, followed both ways.

### Header

The header is the short prefix of the root's own fields that starts every relation and
passage entry, so an entry about one employment still says whose it is. It never starts
the entity's own entry, which holds the fields anyway.

| `header` | Header |
|---|---|
| absent or null | the root type's [name property](schema-modeling.md#the-name-property) — and follows it when it is reassigned |
| a list of keys | those own fields, in that order |
| an empty list | none |

Header fields are own fields of the root and need not be among `fields`.

### Templates

Without a template, semantic text renders as labelled lines ([composition](#composition)).
A template replaces them with prose, for the semantic representation only — keyword
entries never use a template. `semantic.template` renders the entity's own entry; a
group's `template` renders each of its relation entries. Passages have none.

- `{x}` is the value of field `x`: in a relation template a relation field of the group,
  else an own or header field of the root; in the own-entry template an own or header
  field.
- `{target.x}` is field `x` of the entity at the other end — a target field of the group.
- A placeholder without a value — empty, or naming a field the index does not read —
  drops its **clause**: the template text up to and including the next `,`, `;`, `.` or
  line break. Separators left over at either end are trimmed.
- The template replaces the whole entry text: no header or group label is added in front
  of it.
- When every clause is dropped, the entry falls back to the labelled lines.

Placeholders are not validated: a misspelt one simply never has a value.

### Validation and limits

A custom index is validated against the full schema when it is created, replaced,
previewed or imported. Every issue is reported at once, each at a dotted path into the
definition (`relations.0.target.company`):

- the root entity type exists;
- each group's relation type exists and starts (`outgoing`) or ends (`incoming`) at the
  root type; each `target` key is the entity type at its other end;
- every field exists on its owner — the root for `fields` and `header`, the relation
  type for a group's `fields`, the target type for its target fields — and appears once
  in its list;
- fields are `string`, `integer`, `float`, `boolean`, `date` or `datetime`, rendered as
  text; a `document` is allowed only among the root's `fields`, at most one, and makes
  the index cut that document into passage entries beside the own entry of the remaining
  fields;
- an index reads at least one field or has at least one group, and every group reads at
  least one relation or target field;
- two groups on one relation type differ in direction;
- at least one representation is enabled.

**Limits.** At most **12 fields** — own, relation and target fields counted together;
the header does not count — and at most **4 relation groups**, of one hop each. There is
no cap on the number of indices: the [cost preview](#cost-preview) shows what each one
costs instead. The limits bind custom indices only; managed indices are derived and
never validated against them.

### Changing a custom index

A replacement names the whole definition; the key never changes. A new generation is
built only for a representation whose content the change touches — the key, name,
description and the representation switches touch none, and group labels and templates
touch the semantic representation alone. Switching a representation off retires its
generations; switching it on builds one. Until a new generation is ready, the previous
one keeps serving ([lifecycle](#lifecycle)).

Deleting a custom index deletes its generations and entries. When a lens includes it,
the deletion follows the cascade protocol
([schema-modeling.md](schema-modeling.md#the-cascade-protocol)). The schema changes
that reach a custom index — a deleted type it reads, a deleted property it reads — do
so too, and the cascade prunes the index rather than leaving it reading what no longer
exists.

## Cost preview

A draft definition can be checked without saving it. The preview validates it exactly as
a save would and, for a valid draft, estimates what building it costs; an invalid draft
returns its issues and no estimate, never a refusal. A draft needs no key.

The estimate is always that of a **full build** — every entity of the root type composed
again, as a new generation is built, whatever the change from a stored definition:

- **entities** — of the root type;
- **entries** — per representation: one own entry per entity when the index reads an own
  text field, one per relation of each group whose root end is an entity of the root
  type, and the passages of the document field, estimated from each document's length
  as the chunker cuts it (a chunker that prefers boundaries may cut a few more);
- **seconds** — per representation, the entries divided by the throughput: what the
  worker of the answering server process has measured, as a moving average, or a default
  before it has measured any — 500 keyword and 20 semantic entries per second. Each
  representation says whether its rate was measured. The total assumes the
  representations are built one after the other.

A representation that will not be built is left out: one the draft switches off, and
the semantic one when no embedding provider is configured.

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

A [template](#templates) replaces the semantic text of a custom index's own or
relation entries.

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
write of its entity or a [rebuild](#rebuild). A new generation with failed entries does not complete, and the
generation it would replace keeps serving.

### Status

Every index reports a build status per representation it keeps — one its definition
switches off is not reported — with the entities done and the total of a generation
building, the items pending and the items failed:

| State | Meaning |
|---|---|
| `ready` | the active generation is current, nothing pending |
| `building` | a new generation is filling; done of total |
| `stale` | the active generation has work pending, or no generation exists yet |
| `failed` | items failed for good — in the active generation with nothing else pending, or all that a building generation has left |
| `unavailable` | the semantic representation without an embedding provider |

The index's own state is the most severe of its representations' — `failed`, then
`building`, `stale`, `ready` — and `unavailable` only when no representation can be
built. A switched-off managed index reports `disabled` and no representation. The status
also lists up to ten last errors, newest first, one per distinct message: the entity,
the part kind, the message and the time of the failed attempt.

### Rebuild

A rebuild starts a new generation of every representation an index keeps — the semantic
one only with an embedding provider — from all entities of its root type, whether or
not anything changed. It gives failed items their fresh start; the active generations
keep serving until the new ones are ready. It answers at once with the status. A
switched-off managed index cannot be rebuilt.

## Through the interfaces

Indices are reached through ranked search ([search.md](search.md)). The default search —
`GET search`, the MCP and agent search tools and saved-query search steps — searches the
managed indices of the requested types. The index search — `POST search`, and the MCP
`search` tool given index keys — searches any indices the lens can search, custom ones
and their relation entries included ([search.md](search.md#index-search)); the lens's
search catalog, over REST and the runtime MCP server, lists them with their status
([search.md](search.md#the-search-catalog)). Each hit names the entry that matched
([search.md](search.md#response)).

Indices are designed through the modeling surface — REST and the modeling MCP server —
which lists every index with its status, manages custom indices, previews
a draft and starts a rebuild
([../interfaces.md](../interfaces.md#search-indices)), and includes indices in lenses
([../interfaces.md](../interfaces.md#scope-inclusions)). The whole-schema read and the
[transfer format](transfer.md) carry the custom definitions, the switched-off
managed indices and each lens's index inclusions. The server's feature report says whether the storage adapter stores
search indices ([../interfaces.md](../interfaces.md#server)); on one that stores none,
every search-index operation is refused as a disabled feature.
