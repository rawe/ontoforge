# Instance data

Creating, reading, changing and traversing entities and relations. Every operation is
generic over the schema: a type key names what is being addressed, the lens decides what
is reachable, the property definitions decide what is valid. Nothing is written per type.

## What it does

One entity or one relation per call. There is no batch write and no transaction spanning
calls.

Reads come in four shapes: one instance by id, a filtered and paginated list of one type,
the immediate neighbourhood of one entity, and [OQL](oql.md) for anything a fixed shape
cannot express. Matching by meaning is [search](search.md); long-text values are
[documents](documents.md).

Deliberately absent, because each is easily assumed:

- **No versioning, no soft delete, no audit trail.** A delete is immediate and final.
- **No optimistic concurrency.** Entity and relation writes are last-write-wins. Only
  document range writes offer a guard.
- **No cursor pagination.** Offsets only, so a list that changes under a paging client can
  repeat or skip rows.
- **No instance export.** [transfer.md](transfer.md) carries schema only.

## Entities

An entity is created against one entity type with a map of property values, and comes back
with a server-assigned `_id`. Reading takes the type key and the id together — an id alone
addresses nothing on the public surface.

Updates are partial (see [Partial updates](#partial-updates)). Delete is by type key and
id, and takes three things with it:

1. the entity;
2. **every relation attached to it, in either direction** — including relations whose type
   the current lens cannot see;
3. every [document chunk](documents.md) belonging to it.

Nothing warns first and nothing is refused: the runtime cascade is silent, unlike the
schema cascade protocol in [schema-modeling.md](schema-modeling.md). A caller that needs to
know what would be lost must traverse first.

Addressing an entity whose type the lens does not expose fails exactly as addressing a
missing entity does: not found. A lens never reports that something exists but is hidden.

## Relations

A relation is created against one relation type with two endpoint ids and, optionally,
property values. Both endpoints must already exist, and each endpoint's entity type must
equal the relation type's declared source and target — checked against the full schema, not
the lens, so a narrow lens cannot create an edge that is invalid under a wider one.
Endpoint errors are collected alongside property errors and reported together.

**Endpoints are immutable.** An update that carries endpoint ids ignores them silently
rather than rejecting the request; properties in the same payload still apply. Repointing a
relation means deleting it and creating another, with a new id.

Deleting a relation removes only that relation; neither endpoint is touched.

Relations carry no document properties (the schema forbids them there) and are never
embedded, so they are invisible to [search](search.md) — they are reachable by listing, by
traversal and by [OQL](oql.md) only.

## Validation

Every write runs the same pipeline, and the caller sees it as one verdict rather than a
sequence of them.

| Step | Effect |
|---|---|
| Unknown properties | Any key not defined on the type is rejected, named individually. System properties are rejected the same way, since no definition ever bears their names. |
| Required check *(creation)* | A required property that is absent or explicitly null and has no default is rejected. |
| Defaults *(creation)* | Every property with a default that the caller did not supply receives it. |
| Coercion | Each supplied value is converted to the property's declared data type, or rejected. |

**All errors are collected.** One rejected write names every offending field at once,
keyed by property. This is contractual, not incidental — see
[decisions.md](../decisions.md).

**Coercion is strict, and it is conversion, not guessing.** The write path applies the
declared data type unchanged; the seven data types and exactly what each one accepts and
rejects are tabulated in [schema-modeling.md](schema-modeling.md#data-types). Dates and
date-times are stored as temporal values, not as text, and read back as temporal values.

Which properties a write must carry, which are filled in for it, and what happens when a
default cannot be coerced are the property definition's own rules —
[schema-modeling.md](schema-modeling.md#required-and-default) has the three states
`required` and `default` combine into, and the two ways a bad default can fail. One
consequence belongs to the write path itself: defaults come from the full schema while
validation uses the lens ([architecture.md](../architecture.md#ontology-scoping)), so a
property the lens hides still receives its default and an entity created through a narrow
lens stays valid under a wide one.

## Partial updates

An update carries only the properties it changes. Anything absent from the payload keeps
its stored value, and defaults are **not** re-applied — a default acts at creation only.

**Null means remove.** An optional property set to null is deleted from the instance, not
set to an empty value; a subsequent read omits the key entirely. Null on a **required**
property is rejected. Removal is exactly the operation the required flag forbids, and no
default is substituted to rescue it: the property is required, so the instance must keep a
value, and the caller must supply the replacement in the same request.

Consequently, on **creation** an explicit null differs from an omitted key only for
properties with no default: with a default, both paths take the default, so null cannot be
used to create a property-less instance.

An update whose payload survives validation but changes nothing returns the current
instance unchanged, and does not advance the update timestamp.

## System properties

Server-managed, always readable, never writable. Their names — and the one exception to the
underscore convention, a relation's endpoint ids — are listed in
[architecture.md](../architecture.md#instance-level). One further name appears only here:
in neighbourhood results each relation additionally carries `direction`, which is not
stored anywhere; it describes the edge relative to the entity being traversed from.

Internal bookkeeping — embedding vectors, document length counters — is stripped before a
response is built and never appears, under any projection.

## Listing

A list request names one entity type or one relation type and returns `items` plus `total`,
`limit` and `offset`. `total` is the count of all matches, not of the page.

**Pagination.** A page size and an offset, both bounded — the permitted range and the
defaults are with the parameter in
[interfaces.md](../interfaces.md#listing-sorting-filtering). An out-of-range page size is
rejected, so there is no way to pull more than one capped page in a single call.

**Sorting.** `sort` accepts any property key of the type as exposed by the lens, plus the
creation and update timestamps, and defaults to the creation timestamp ascending. Anything
else is a validation error naming the field. The timestamps are accepted both by their
system names and by underscore-less aliases; the aliases exist only for sorting and name
nothing in a response. Where instances lack the sort property, their relative position is
unspecified.

**Literal text search.** Entity lists accept a free-text term, whose matching rules belong
to [search.md](search.md#literal-matching). One behaviour is peculiar to listing: when the
type has no exposed string property at all the term is **silently ignored**, returning the
unfiltered list rather than nothing. Relation lists take no free-text term.

**Property filters.** Any number of filters may be combined; they and the free-text term
are ANDed. The operator suffixes themselves, and the parameter form that carries them, are
in [interfaces.md](../interfaces.md#listing-sorting-filtering). What matters here is how a
filter is evaluated: values arrive as text and are coerced to the property's data type by
the same rules as writes — except under the substring operator, which compares as text and
therefore accepts anything. An unknown property, an unrecognized suffix or an uncoercible
value is a validation error naming the filter. The operator is taken as the segment after
the **last** double underscore, so a property whose own key contains a double underscore
cannot be filtered.

Relation lists additionally filter by source id, target id, or both, which is how the
relations of one entity are enumerated with a real total — the traversal operation below
does not provide one.

## Field projection

Any read that returns entities accepts `fields`: a list of property keys to keep. It is a
response-shaping filter, applied after scope filtering, so it can only narrow what the lens
already allows. Unknown names are not an error; they simply match nothing.

Some system fields survive projection unconditionally, so that a result stays identifiable.
Which ones, per read, is tabulated in
[interfaces.md](../interfaces.md#field-projection) alongside the routes that accept a
projection at all.

Projection is the one way to obtain a document property's real content inside an entity
payload: naming it in `fields` returns the text instead of the stub. The stub itself, and
the only other route to the content, are in
[documents.md](documents.md#the-stub-read-model). Write responses accept no projection — a
created or updated entity always comes back whole, with documents stubbed.

## Traversal

The neighbourhood operation returns one entity together with the entities directly
connected to it and the relation that connects each.

- **Direction** is `outgoing`, `incoming` or `both`, defaulting to `both`.
- **Relation type** may be named to restrict the traversal to one type. An unknown or
  out-of-scope type key is not an error; it simply yields no neighbours.
- **The limit is one shared budget, and `both` spends it unevenly.** Outgoing edges are
  taken first, up to the whole limit; incoming edges receive only what is left over. The
  result is therefore *not* balanced across the two directions, and an entity with at
  least as many outgoing edges as the limit allows comes back with **no incoming
  neighbours at all** — which reads as "this entity is pointed at by nothing" and is not.
  Asking for each direction separately is the way to see both.
- **No total and no offset.** The result says nothing about how many neighbours were left
  out. Counting or paging them means listing the relation type filtered by endpoint id
  instead.

Each entry carries the relation — with its `direction` — and the neighbour entity.
Relations whose type the lens does not expose are dropped from the result entirely, taking
their neighbour with them.

Two projections apply independently: `fields` shapes the centre entity **and** every
neighbour entity, `relationFields` shapes the connecting relations.

One trap: a neighbour is filtered to the lens only when its own entity type is in scope. A
lens that admits a relation type without admitting both of its endpoint types will return
those endpoint entities with all of their properties, not the scoped subset. Document
values are stubbed even then.

## Through the interfaces

The full index of routes and tools is [interfaces.md](../interfaces.md). All of the below
is runtime, addressed through one ontology key.

| Operation | REST | Runtime MCP |
|---|---|---|
| Entity lifecycle | create, list, read, update, delete under the entity route family | `create_entity`, `list_entities`, `get_entity`, `update_entity`, `delete_entity` |
| Relation lifecycle | same five under the relation route family | `create_relation`, `list_relations`, `get_relation`, `update_relation`, `delete_relation` |
| Traversal | neighbours of one entity | `get_neighbors` |

REST carries filters as `filter.<property>` query parameters and repeats `fields` per
value; MCP takes a filters object and a list, with the same keys and the same operator
suffixes. Both reach the same service, so every rule above holds identically. MCP clamps
`limit` and `offset` into range instead of rejecting them, where REST rejects out-of-range
values.

In the web UI, the data workbench is the surface for all of this: a per-type table with
sorting, filtering, text search and paging, an entity detail view with inline property
editing and a neighbour list, and a graph explorer built on the same traversal operation.
See [product-surface.md](../product-surface.md).
