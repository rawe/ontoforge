# Ontology lenses

An ontology is a named aperture onto the one global schema. It decides what a
runtime caller can see, name and write — and nothing else.

Vocabulary: [../README.md](../README.md). The schema it looks at:
[schema-modeling.md](schema-modeling.md).

## What a lens is

A lens has a key, a unique name and an optional description. The key matches
`^[a-z][a-z0-9_]*$`, is chosen at creation, is never updatable, and is what every
interface uses to address the lens. The name is unique too, but purely for
display.

Any number of lenses may exist, including any number that expose everything.

**A lens is not a container.** It holds no types, no properties and no instance
data. It cannot define a type, override a property, or rename anything. Its entire
content is a set of declarations about types that exist independently of it.

Two things do belong to a lens, keyed within it, exported with it and deleted with
it: **agent configurations** ([ai-agents.md](ai-agents.md)) and **saved queries**
([saved-queries.md](saved-queries.md)). Both are lens-local because both are
written in terms of what that lens exposes.

Deleting a lens deletes those two and nothing else. Types, property definitions
and every entity and relation survive untouched, and other lenses are unaffected.
There is no consent step and no protection: lens deletion is always permitted,
because nothing outside the lens depends on it.

## Unscoped and scoped

A lens is scoped **if and only if it has at least one inclusion.** There is no
flag, no mode and no third state — declaring nothing is what makes a lens
unscoped.

An unscoped lens exposes the entire schema, and keeps doing so as the schema
changes: a type created tomorrow is visible through it immediately, with no edit.
It can never be broken by a schema change and never appears in a cascade refusal.

A scoped lens exposes what it declares, and everything else is invisible through
it — absent from schema reads, rejected on write, stripped from results.

## Inclusions

One inclusion is one declaration that a lens exposes one type. At most one
inclusion exists per lens and type; adding the same type again is an upsert that
replaces the previous declaration rather than a duplicate or a conflict.

Each inclusion optionally carries a **property allowlist**:

| Allowlist | Meaning | Behaviour as the schema changes |
|---|---|---|
| absent | every property of the type | tracks the type automatically — properties appear and disappear on their own |
| present | exactly the listed properties | pinned; a listed key that no longer resolves simply matches nothing |

That is the difference between the two stability classes of a scoped lens, and it
decides which lenses the cascade protocol defends: only an allowlist can be
invalidated by a property change, so only lenses with allowlists are ever named in
a cascade refusal ([schema-modeling.md](schema-modeling.md)).

Four rules bind an inclusion. They are enforced when it is added or updated, and
re-checked by lens validation:

- the type it names must exist
- every key in the allowlist must be a property of that type
- every required property of that type with no default must be in the allowlist —
  otherwise creates through the lens could never satisfy it
- for a relation type, **when the lens already has entity inclusions**, both its
  source and target entity types must themselves be included

The italic in that last rule is a real ordering hazard. A lens with no entity
inclusions yet accepts any relation type inclusion unchecked; adding entity
inclusions afterwards can leave an included relation type whose endpoints are not
exposed. Import writes inclusions without applying any of the four rules at all.
In both cases the result is a lens that validation reports as invalid but that the
runtime will still load and serve.

## The scoping matrix

Entity scoping and relation scoping are **independent dimensions**, and their
combination — not the presence of inclusions in general — decides what a lens
exposes. This is the single most consequential rule in the document.

| Entity inclusions | Relation inclusions | Entity types exposed | Relation types exposed |
|---|---|---|---|
| none | none | **all** | **all** |
| some | none | only those included | **inferred**: every relation type whose source *and* target are both exposed |
| none | some | **all** | only those included |
| some | some | only those included | only those included |

The inferred case exists because a relation whose endpoint is invisible would be
unusable: you could neither read the entity it points at nor create one to point
at. Naming entity types alone therefore yields a coherent subgraph without any
relation bookkeeping.

**The cliff edge.** Adding the *first* relation inclusion to a lens in the inferred
case moves it to the fourth row, and every inferred relation type disappears at
once — including ones the caller never intended to remove. Nothing warns about
this; the transition is a consequence of the matrix, not a separate rule. It is
deliberate: declaring one relation type explicitly is read as taking explicit
control of the whole dimension.

Two corollaries fall out of the matrix and are easy to miss:

- Only an inclusion can carry an allowlist. So in the inferred case relation types
  always expose all their properties, and in the third row entity types always
  expose all of theirs — property narrowing is unavailable on a dimension that is
  not explicitly scoped.
- An inclusion naming a type that no longer exists is skipped silently when the
  lens is assembled. It costs nothing at runtime and is reported only by
  validation.

## What scoping cuts

Three places, matching the three things a caller can do with a schema.

**Schema reads.** The runtime schema surface returns only exposed types, each
carrying only its exposed properties. Asking for a type the lens does not expose
answers *not found* — indistinguishable from asking for a type that does not
exist. The lens does not advertise what it hides.

**Writes.** A property the lens does not expose is an unknown property: the write
is rejected and names it, alongside every other offending field. Creating,
updating or deleting through an unexposed type answers *not found*.

**Read results.** Every entity and relation in a response is stripped to the
exposed properties. System properties always survive stripping — they are never
part of a lens's declaration and never removable by one.

Three behaviours follow from those three, and each is a place a reimplementation
tends to leak:

- **Query results are filtered per column.** Node and relation values in a result
  row are stripped exactly as a read result is, and a scalar projection of a
  document property is replaced by its stub. The column list itself is never
  filtered, because a query naming an out-of-scope type or property fails
  validation before execution — the lens is enforced when the query is parsed, not
  only when its rows come back. See [oql.md](oql.md).
- **Traversal drops what the lens does not acknowledge.** A neighbour reached
  through a relation type the lens does not expose is omitted from the
  neighbourhood entirely, not returned with an empty relation.
- **Search is restricted to exposed types**, and passage search only to exposed
  document properties. Because a restricted lens filters a fixed candidate pool
  after ranking, a narrow lens can return fewer hits than requested even when more
  matches exist ([search.md](search.md)).

Filtering is applied per type, not per response, and that has one visible
consequence during traversal: a neighbour whose own entity type is out of scope
escapes property stripping ([instance-data.md](instance-data.md)). Under the
matrix that combination cannot arise from the interactive paths — it needs an
inclusion set written past the endpoint check, via import or the ordering hazard
above.

## The lens/full-schema asymmetry

A lens governs what a caller may name. It does not govern what the system knows.
Three operations deliberately consult the full schema instead of the lens, and
getting any of them wrong produces data that is valid under one lens and broken
under another:

- **Defaults on create come from the full schema.** A property the lens hides
  cannot be written through it, yet if that property has a default the created
  entity still receives it. Reason and rule:
  [../decisions.md](../decisions.md).
- **Relation endpoint checks use the full schema.** The source and target entity
  types a new relation is validated against are the type's real endpoints, not
  whatever the lens exposes.
- **Embedding text is built from the full schema's properties.** A scoped lens's
  semantic ranking can therefore be driven by text it cannot see — a result may be
  highly ranked for reasons invisible through that lens. This is inherent to
  sharing one stored record between lenses, and is documented rather than
  prevented.

Defaults apply on creation only. A lens that hides a property never causes that
property to be re-defaulted on update, so widening or narrowing a lens does not
rewrite anything already stored.

## Instance data is shared

An entity is not *in* an ontology. It exists once, and every lens exposing its
type sees it — the same identifier, the same record.

- An entity created through one lens is readable and writable through every other
  lens that exposes its type. There is no copy and no synchronization.
- Two lenses over the same entity see different property subsets of one stored
  record. Hiding a property does not remove it, and does not stop another lens
  from writing it.
- Concurrent writes through different lenses to the same property are last-write-
  wins. Nothing partitions the data by lens, so nothing detects the collision.
- There is no lens-scoped data deletion, and deliberately so: wiping "the lens's
  data" would destroy instances other lenses depend on. Data is removed one
  entity or relation at a time ([instance-data.md](instance-data.md)).

A lens is assembled once per process and discarded after any modeling change; the
caching rules and their one operational limit are in
[../architecture.md](../architecture.md).

## Through the interfaces

Full index: [../interfaces.md](../interfaces.md).

Defining a lens is a modeling operation; using one is a runtime operation. The two
never mix — that separation is what makes it safe to hand an autonomous agent a
lens without handing it the schema.

| | REST | MCP | Web UI |
|---|---|---|---|
| Lens create, read, update, delete | modeling routes | modeling server, by key | schema studio |
| Inclusions | separate operations per dimension: add, list, update, remove | add and remove per dimension | schema studio |
| Lens validation | per-lens operation | per-lens tool | schema studio |
| Using a lens | the lens key is a path segment on every runtime route | bound once, at connection time | data workbench |

Two interface facts are load-bearing:

**MCP has no update-inclusion tool.** Adding an inclusion again with a different
allowlist is how an allowlist is changed there, which works because adding is an
upsert. REST offers the explicit update as well.

**The runtime MCP server binds to exactly one lens for the life of the
connection**, resolved when it opens ([../decisions.md](../decisions.md)). A model
never chooses a lens and can never reach across two.

What the web UI does with all of this is described in
[../product-surface.md](../product-surface.md).
