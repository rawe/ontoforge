# Storage adapters

Everything OntoForge persists crosses one boundary: the persistence port. Above it,
services speak schema vocabulary only — keys, property definitions, structured filters,
instance identifiers — through stores bound to one ontology and a small registry port.
Below it, exactly one adapter knows a database.

This document is the contract an adapter must satisfy. Concepts and vocabulary:
[README.md](README.md). Where the port sits in the system:
[architecture.md](architecture.md). The rules that put it there:
[decisions.md](decisions.md).

**One part binds; two describe.** Part 1 is normative: it binds every adapter. Parts 2
and 3 describe the two shipped adapters — PostgreSQL, the default deployment, and Neo4j
— in named technology. They bind nothing: nothing in an adapter part may be relied on by
code above the port, and nothing in one constrains another adapter. The known divergences
in observable behaviour between the two are enumerated in one place, between the contract
and the adapter parts.

---

# Part 1 — The contract (normative)

## Bound stores and the registry

The port has three surfaces: a modeling store and a runtime store, each obtained **bound
to one ontology**, and an **ontology registry** that manages ontologies as whole units.

**Stores are bound.** A store is requested for an ontology key and every operation on it
resolves within that binding. The binding check happens above the adapter — the port
accessors verify the key against the registry and fail with not found before the adapter
is asked for a store — so an adapter may hand out bound stores without checking. All
store operations below are written as if the ontology were the whole world, because
through a bound store it is.

**Isolation is total.** An operation on a store bound to one ontology must never
observe, return, or affect another ontology's data — schema, instances, chunks, vectors,
or search indexes. "One request, one ontology" is structural above the adapter and
physical inside it: *how* the data of two ontologies is kept apart is each adapter's
private business, described only in its own non-normative part, and nothing above the
port may depend on the mechanism.

**The registry manages ontologies as whole units.** Its rows carry the internal id, the
key, the optional display name and timestamps. Six operations:

| Operation | Obligation |
|---|---|
| Create | Given an internal id, a key, an optional display name and an optional embedding width, create the registry entry **and provision the ontology's physical home atomically** — a failed create leaves no entry and no home. When a width is given, the home carries the fixed semantic indexes at that width; when none is (no embedding provider), it carries none. |
| List | Every ontology, as registry rows. |
| Read by key | One row, or an absent result. |
| Read by display name | One row, or an absent result — display names are unique server-wide, and the pre-write conflict check needs the lookup. |
| Rename | Set the display name; the key never changes. Absent result when not found. |
| Delete | Hard cascade: the ontology's physical home and its registry entry go together — schema, lenses, agents, saved queries, instances, chunks, and every search index. False when not found. |

The registry — not the database's own catalog — is the authoritative list of ontologies.
The store must enforce server-wide uniqueness of the ontology key and the display name;
a concurrent pair of creates must produce a conflict, not a duplicate.

**A capped registry is a valid implementation.** An adapter whose physical mapping
cannot hold more than one ontology may enforce a cap by rejecting further creates as a
domain conflict — see the conformance tiers below and the rule in
[decisions.md](decisions.md#storage).

### Conformance tiers

The conformance suite splits in two. The **contract tier** covers everything in this
part at a scale of one ontology — bound stores, the registry operations, isolation
semantics — and every adapter must pass it. The **multi-ontology tier** exercises
several ontologies at once — independent same-key schemas, disjoint instance data,
cross-ontology search silence — and only adapters whose registry accepts more than one
ontology run it. PostgreSQL runs both tiers; Neo4j, capped at one ontology, runs the
contract tier only.

## What crosses the port

Five rules govern the boundary itself. They hold for every operation without exception.

**Only JSON-safe values cross.** Scalars, strings, booleans, numbers, lists, maps. No
driver objects, no cursors, no result handles, no lazily-evaluated streams. An operation
returns materialised data.

**Temporals cross as language-native date and datetime values.** Whatever temporal
representation the driver uses is the adapter's private business, converted in both
directions at the boundary. A service must never receive a value it has to recognise as
belonging to a particular database client. Datetimes carry a timezone; naive values are
treated as UTC. The outward conversion is guaranteed on the reads that carry property
definitions to guide it. The two point reads by type key and instance id carry none, and
there one deviation exists — PostgreSQL-specific: datetime values return as the stored
ISO text, whose wire serialization is byte-identical.

**Filters, sorts and searches cross as structured values, never as query text.** A filter
is a list of parsed conditions, each tagged with its kind. The property condition carries
a property key, its declared data type, an operator, and the value already coerced to
that type. The path condition carries a relation type key, an explicit direction —
outgoing or incoming — the source of the final property (the related entity), the final
property key, its data type, an operator and the coerced value; the service resolves the
path above the port, so an adapter receives only valid, fully resolved conditions and
never a key to interpret. A sort is a property key plus a direction; a text search is
a string plus the list of property keys to match it against. No fragment of any query
language enters or leaves the port. The one exception is the validated query object,
described below, which is opaque rather than textual.

**Driver exceptions never escape.** Every failure the adapter cannot express as a domain
condition surfaces as the single storage error, carrying a generated id and no storage
detail. The adapter logs the original — vendor name, driver code, message, stack —
against that id. Expected conditions are not exceptions: a missing row is an empty result
or an absent value, and a failed delete is a false return. See the error table in
[architecture.md](architecture.md).

**An adapter declares the type keys it reserves, as plain keys.** Two sets, one for entity
type keys and one for relation type keys. They are returned as schema-level keys, never
as physical names, so the modeling service can reject a colliding key without knowing what
it would collide with. An adapter with no collisions returns two empty sets.

One further caution, because it is invisible from the signatures: the port carries a
discriminator distinguishing an entity type from a relation type — as the owner of a
property definition, and as the target of a scope inclusion. Its two literal values are
`EntityType` and `RelationType`. They are fixed strings on the wire, not a licence to name
physical objects that way; a new adapter accepts them and maps them to whatever it stores.

## Lifecycle

| Operation | Obligation |
|---|---|
| Initialize | Open connections, verify the database is reachable, create every **server-wide** constraint and index the adapter needs, and hand out the registry and the two bound-store factories. Per-ontology storage is provisioned by registry create, never at initialization. Failure prevents the server from serving. |
| Close | Release connections. Idempotent. |
| Ensure semantic indexes | Given a vector width, create every vector index the current schemas imply, for **every ontology the registry lists** — doing nothing when there are none. Called at startup only when an embedding provider is configured. |

## The two store surfaces

Two stores, matching the modeling/runtime split, each bound to one ontology. Neither
knows about the other. Operations are grouped by capability below; each group states the
shape of the data and the rules the adapter must honour, not per-operation signatures.
"Unique" in this section always means unique within the bound ontology.

Internal identifiers appear in this section because they are the store's own currency.
They never reach a caller — see the keys-not-identifiers rule in
[decisions.md](decisions.md).

### Schema side

**Lens management.** Create with a caller-supplied internal id, key, name and optional
description. List all. Read by internal id, by key, and by name — the last two exist
separately because both are unique and both are used to detect a conflict before a write.
Update name and description. Delete.

**Type management.** Entity types: create with id, key, display name, description; list;
read by id; read by key; update display name and description; delete. Relation types: the
same, plus the source and target entity type keys supplied at creation and never
updatable, and returned on every read. One extra predicate is required on the entity type
side: whether any relation type currently names a given entity type as an endpoint. It
backs the rule that an entity type in use cannot be deleted.

**Property management.** A property definition is owned by exactly one type, addressed by
the owner's internal id plus the owner-kind discriminator. Create with id, key, display
name, description, data type, required flag and optional default. List for an owner. Read
by id and by key. Delete. Update carries a subtlety a reimplementer must not flatten:
display name, description, required and default are each *optional* — absent means leave
unchanged — and clearing a default is a separate explicit flag, because an absent default
and a default of nothing are different intentions.

**Scope inclusion management.** An inclusion joins one lens to one type and optionally
carries a property allowlist; an absent allowlist means all properties, and is not the
same as an empty one. Add an inclusion, list the inclusions of one kind for a lens,
update its allowlist, remove one. Beyond the plain lifecycle, four operations
exist purely to serve the cascade protocol and must be provided:

- Remove every inclusion referring to a given type, across all lenses.
- List the lens keys that include a given type.
- List the lens keys whose inclusion for a given type carries an explicit allowlist
  that does **not** name a given property — lenses with no allowlist auto-track the
  type's properties and must not be reported.
- Add, or remove, a property key across every explicit allowlist that names a given type,
  returning how many were changed.

**Full-schema retrieval.** One operation returns the ontology's entire schema in a single
call: every entity type with its properties, every relation type with its properties and
its endpoint keys, and every lens with its inclusions. It backs validation, export and
cross-cutting checks, and must be a coherent snapshot rather than a walk the caller
stitches together.

**Agent and saved-query storage.** Both belong to a lens and are addressed by key
within it. For each: list for a lens, upsert, delete, and a list-for-export variant
that returns the full stored form rather than the summary. Upsert
reports whether it created or updated, because the interface layer distinguishes the two.
An agent carries name, description, system prompt and a tool allowlist. A saved query
carries name, description, and its steps and parameters as serialized text — the store
does not interpret them. A saved query also accepts an embedding of its description, and
the key of its owning lens alongside it, so that a search over descriptions can be
narrowed to one lens without a join.

**Embedding maintenance.** Backing the rebuild operation: list every entity type with its
property keys; set the embedding vector on one entity by id; list every saved query with
enough identity to re-embed it; set the embedding on one saved query. Plus the vector
index operations under obligations, below.

**Reserved-key reporting.** Alongside the two declared sets, one operation scans stored
types and returns those whose key is now reserved, as kind-and-key pairs. Startup reports
them; nothing rewrites them.

**Document-property cleanup.** Delete every chunk belonging to a given entity type and
document property. Invoked when the property, or its owning type, is removed.

### Data side

**Schema reading.** The runtime side reads the schema for itself rather than calling the
modeling side. Three operations, all keyed by lens key within the binding: the full
schema as that lens sees it — all of the ontology's types, plus that lens's inclusions,
so the caller can compute the scope — its agent configurations, and its saved queries.
The first returns nothing at all when no lens has that key, which is how an unknown lens
is detected. The runtime store also exposes the ontology key it is bound to, because the
schema cache keys its entries by ontology plus lens.

**Entity lifecycle.** Create with the type key, a caller-supplied instance id, the
validated property map and an optional embedding vector. Read by type key and id; read by
id alone, when the type is not known; read a batch by ids, returned as a map keyed by id.
The by-id reads carry property definitions alongside — the adapter's guide for converting
stored values back to their port forms on the way out, mirroring the definitions every
write already carries for the conversion inward; an adapter whose storage distinguishes
those forms natively may ignore them. Update takes the properties to set and the property keys to remove as two separate inputs,
plus an optional embedding and an explicit flag saying whether the embedding is part of
this update — again because "no new vector" and "clear the vector" must be
distinguishable. Delete by type key and id, returning whether anything was deleted, and
removing the entity's document chunks with it.

Listing is the one read with real machinery. It takes the type key, the scoped property
definitions, the parsed filter conditions, an optional text-search string with the string
property keys to match, a validated sort property and direction, and a limit and offset.
It returns the page together with the total matching count — both, from one call.

The adapter must set and maintain the system properties on every write: the instance id,
the type key, the creation timestamp on create, and the update timestamp on create and on
every update. Stored embedding vectors must never appear in a returned row.

**Write-value constraints.** Before a write whose property values will become
vector-index filter metadata, one operation lets the adapter reject a value it cannot
store, as a domain validation error naming the property. An adapter whose storage imposes
no such limit treats the operation as a no-op — the same pattern as reserved keys: the
constraint is the adapter's, the enforcement point is shared.

**Relation lifecycle.** Create with the relation type key, an instance id, the two
endpoint entity ids and the property map. Read by type key and id. Update, with the same
set/remove split as entities. Delete. List, taking the same filter, sort, pagination and
count contract as entity listing, plus optional endpoint filters — restrict to relations
leaving a given entity, or arriving at one, or both. Every relation read returns its two
endpoint ids alongside its properties; endpoints are never updatable.

**Traversal.** Given an entity id, a direction of incoming, outgoing or both, an optional
relation type key filter, a limit, and property definitions keyed by type key — the same
row-conversion guide the by-id reads carry, covering whatever types the neighbourhood may
touch — return the adjacent relations paired with the entities at the far end. Each result is marked with the direction it was traversed. For
the combined direction the limit is a single budget: outgoing edges are taken first and
incoming edges receive only what remains, so the two are not independently limited. What
that costs a caller is in
[capabilities/instance-data.md](capabilities/instance-data.md#traversal).

**Document chunk management.** Chunks are internal and never addressed directly. Four
operations: return the existing chunk text to vector mapping for one entity's document
property, so that re-chunking can reuse the vectors of unchanged text; delete all chunks
of one entity's document property; create a batch of chunks for one entity's document
property; and search one document property's chunks by vector. A chunk carries its own
id, its owning entity id, the entity type key, the property key, its ordinal, its start
offset and character length, its text, and optionally its vector. The adapter stores that
payload as given and returns it unchanged except for stripping the vector.

**Search.** Three kinds, all by vector, all returning a similarity score with each hit and
honouring a result limit. Entity search and saved-query search also honour an optional
minimum score; document-chunk search takes none at the port — its floor is applied above
the port.

| Kind | Input | Returns |
|---|---|---|
| Entities | A query vector, and either one entity type key with its scoped property definitions and optional filter conditions, or nothing — meaning all of the ontology's types at once | Entities with scores |
| Document chunks | A query vector, an entity type key and a document property key | Chunks with scores |
| Saved queries | A query vector and a lens key | Saved-query summaries with scores |

The per-type entity search accepts the same parsed filter conditions that listing does and
must apply them as part of the search, not after it, so that the limit counts filtered hits.
Cross-type entity search takes no filter; narrowing to a lens happens above the port —
but never crosses the binding: through a bound store, "all types" means all of that
ontology's types, and another ontology's better-matching entity must never appear.
Saved-query search is always narrowed to a single lens.

Literal text matching is not a separate operation — it is the search string on the listing
operations, matched case-insensitively as a substring against the named string properties,
any one of which matching admits the row. See
[capabilities/search.md](capabilities/search.md).

**Validated-query execution.** Take a validated query object and an optional parameter
map, compile, execute read-only, and return the ordered column names together with the
rows. Each row maps column name to a converted value. Nodes and relationships become plain
property maps; temporals are converted; vectors are stripped; conversion recurses through
lists of one element type, and nothing driver-shaped survives at any depth. What a map
literal or a mixed list carries back is each adapter's own shape — recorded with the
divergences below.

## Obligations beyond storage

An adapter is not only a set of writes and reads. Seven responsibilities sit entirely inside
it, and a new adapter that implements the operations but skips these is not a working
adapter.

**Physical naming, and the reserved keys it implies.** The adapter alone decides how a
type key becomes a physical object. Whatever that transformation is, it must then declare
every schema-level key whose transformed form would collide with the adapter's own
storage objects. The declaration is what makes the collision rejectable at the service
layer, in a message naming neither vendor nor physical name. Names the adapter reserves
for internal use are safe without declaration only if they cannot be produced by the
transformation at all — a leading underscore is such a case, since no valid key starts with
one.

**Uniqueness.** The store is the last line, not the first. Services pre-check for
conflicts, but the store must itself enforce, within each ontology, uniqueness of: each
lens's internal id, key and name; each entity type's internal id and key; each relation
type's internal id and key; each property definition's internal id; each agent
configuration's internal id; each saved query's internal id; and each entity instance's
id — and, server-wide, each ontology's key and display name. A concurrent pair of writes
must produce a conflict, not a duplicate. Lookup of instances by type key must be
indexed — every listing depends on it.

**Vector index lifecycle.** The adapter owns index creation and removal, and the port
exposes exactly the hooks the schema lifecycle needs: create the index for an entity type
at a given width, optionally naming the properties to be filterable inside it; drop it;
rebuild it against the type's current properties; create and drop the index for a document
property's chunks; ensure the saved-query index; and ensure all of them at once. All are
called at the points where the schema changes shape — adding a type, deleting a type,
adding or removing a property, adding or removing a document property — and are no-ops
when no embedding provider is configured. Indexes are per ontology like everything else:
created through a bound store, they serve that ontology alone, and registry delete
removes them with the rest.

**Vector index width reconciliation.** An index fixes its vector width when it is created,
and a create-if-absent is a no-op against an index that already exists — the failure mode
this produces, and why startup reports it instead of repairing it, are in
[decisions.md](decisions.md#behaviour) and
[capabilities/search.md](capabilities/search.md#vector-index-width-drift). The adapter's
obligation is threefold: before every create, read the existing index's configured width
and compare it; on the startup path — which walks every registered ontology — report a
mismatch and change nothing; on the rebuild path, which passes an explicit recreate flag,
drop and recreate at the new width. The
report must describe the index the way the API does — by entity type, by document property,
or by search scope — and never by its physical name.

**Building predicates from structured filters.** Filters arrive as parsed conditions, and
the adapter, dispatching on each condition's kind, must turn every condition into a
predicate the database can evaluate. The
operator vocabulary is fixed by the caller-facing surface, not by the adapter, and is
enumerated once in [interfaces.md](interfaces.md#listing-sorting-filtering); an adapter
supports all of it and invents none of it. Validation happens above the port: every filter
fault — an unknown property, an unknown operator, a value that will not coerce, a query
path that does not resolve — is collected there into one domain validation error,
identically on every backend, so the adapter receives only valid conditions and raises no
filter validation error of its own. Each condition's value is already coerced to the
property's declared data type; the substring operator is the exception, comparing
case-insensitively on the string form of both sides and carrying that string form as its
value. A path condition's predicate is existential and self-contained: it holds when at
least one relation of the type — leaving the listed instance for the outgoing direction,
arriving at it for the incoming one — reaches a related entity whose property satisfies
the comparison, evaluated per condition. One fault remains the adapter's to raise, as a
domain validation error and not a storage error — Neo4j-specific, raised on the write path
through the write-value constraint above: an indexed value exceeding the 32766-byte
ceiling, in an error naming the property. Every value must reach the database as a bound
parameter. Type keys, relation type keys and property keys may be interpolated into
generated query text — they originate from the stored schema, never from request input —
but values never may.

**Compiling a validated query.** The adapter turns the validated query into its native
dialect and runs it read-only. How it compiles is its own business — rewriting tokens in
place or walking the parse tree and emitting a fresh statement — but every type key and
property key must be mapped to the adapter's physical names, and the query's meaning must
be preserved exactly. Parameters are supplied separately and bound, never spliced.

**Translating errors.** Every path to the database goes through one place that catches
driver failures and converts them, so that no route into the store can bypass the
translation. The catch is narrow: it converts driver exceptions only, letting domain
exceptions raised inside the same scope — and ordinary programming errors — propagate
unchanged.

## The validated query

Exactly one non-primitive object crosses the port: the result of parsing and validating an
OQL query. It is opaque to services and meaningful only to the adapter, which compiles it.
Parsing and validating are storage-independent and happen above the port; compiling is the
adapter's private business. See [capabilities/oql.md](capabilities/oql.md).

The adapter **may** assume, without re-checking:

- The query parses.
- Every entity type key, relation type key and property key in it exists and is visible
  through the requesting lens.
- No write clause and no procedure call is present.
- No node pattern is unlabelled, and no internal label or internal relationship type
  appears.
- The object carries everything a compiler needs: the parse tree, the token stream, the
  analysis that locates every type-key token and marks whether it names a node or a
  relationship, the scoped schema it was validated against, and the original query text
  for diagnostics.

The adapter **must not** assume:

- That the query is a string it may manipulate textually. The text the object carries is
  for diagnostics and logging only; compilation works from the parse tree or the token
  positions the analysis provides.
- That any value in the query is a parameter. Parameters arrive separately, as a map.
- That the object is serializable, or survives leaving the process.
- That validation implies anything about cost. Limits and timeouts, if wanted, are the
  adapter's to impose.

Correspondingly, whatever the compilation style, the compiled statement must ask the
database exactly what the validated query asks — only the names are translated.
Results come back in schema vocabulary, so no reverse translation of names is required —
the compiled query returns whatever the caller asked for, converted per the value rules
above.

---

# Where the adapters diverge

Parsing and validation happen above the port, so the Neo4j and PostgreSQL adapters accept
exactly the same queries and reject invalid ones identically. Beyond acceptance, the known
divergences between them are enumerated here. Two deviations stand with the rules they
attach to in Part 1 rather than here: the datetime text form on the two point reads
(PostgreSQL), and the indexed-value size ceiling (Neo4j). One is structural and stands
with the registry contract: Neo4j caps the registry at one ontology, so the
multi-ontology conformance tier runs on PostgreSQL only.

- **Decoding through a shared type key.** An entity type and a relation type may share a
  key; if both declare the same property key at different data types, the traversal read
  and the batch read behind cross-type document search can decode the value through the
  wrong definition, silently. A known limitation, accepted.
- **Substring matching against non-string values.** The substring filter compares text
  forms. PostgreSQL renders them as the documented behaviour states — numbers as
  printed, booleans as `true`/`false`, datetimes as their ISO-8601 string — while
  Neo4j's temporal and float rendering is its own, so a substring match against a
  non-string value can differ between the adapters.
- **String sort order.** PostgreSQL sorts strings by the database's default collation,
  dictionary-style, as the documented behaviour states; Neo4j sorts by Unicode code
  points, capitals before lowercase.
- **Vector-index removal on drop.** On PostgreSQL, a dropped entity type's or document
  property's vector index survives as an orphan until the next ensure-all pass sweeps it;
  on Neo4j the drop removes it immediately.
- **Width drift blocks writes, not just search.** While a vector index of a stale width
  stands, PostgreSQL rejects every write that carries a vector — entity or chunk, of any
  type — until the widths are reconciled; on Neo4j the mismatched vector is left
  unindexed and the write succeeds.
- **Faults only execution can see.** A query fault the compiler itself detects — an
  un-aliased `WITH` item that is not a plain variable, a missing parameter, a variable
  used as a node or relationship when it is bound to neither — is a domain validation
  error on PostgreSQL; Neo4j surfaces the same query as a storage error. A clean client
  error on one adapter is a generic failure on the other.
- **Reading a property of a `WITH` alias that cannot be verified against the schema.**
  An error on PostgreSQL, per the documented behaviour; Neo4j does not reject it — the
  access silently yields null, leaking past the lens.
- **Aggregates versus projection on temporal properties.** On PostgreSQL, `min` and `max`
  over a date or datetime property return a decoded temporal value where a plain
  projection of the same property returns its stored text — the two forms disagree about
  the property's type; on Neo4j they agree.
- **Map literals and mixed lists in query results.** Conversion recurses through lists of
  one element type only; a map literal, or a list mixing element types, comes back in
  each adapter's own shape — converted temporals on Neo4j, the stored text on PostgreSQL.
  The conformance suite pins both shapes.
- **An empty leading `OPTIONAL MATCH`.** When it matches nothing, Neo4j returns one row
  of nulls; PostgreSQL returns no row.
- **Out-of-range float literals.** A float literal beyond double range, such as `1e400`,
  executes with correct comparison semantics on PostgreSQL; Neo4j refuses the query with
  a storage error, its engine rejecting the value as out of range.

One gap is shared rather than divergent: a float literal whose fraction is a bare
trailing zero, such as `1.0`, cannot be written — it parses as a property access and is
rejected — so an equality across the integer/float divide written as `1 = 1.0` is
inexpressible on both adapters alike. `1.5` is unaffected.

---

# Part 2 — The PostgreSQL adapter (non-normative)

> Everything below describes how the **PostgreSQL** adapter — the default deployment —
> satisfies Part 1. It is illustration, not contract. No name, convention or structure in
> this part is part of the port, and a different adapter is free to share none of it.

## How ontologies are isolated

One PostgreSQL namespace (schema, in the engine's own vocabulary) per ontology, named
`ont_` plus the ontology key — the reason ontology keys are capped at 59 characters: the
engine truncates identifiers at 63, and the key is immutable, so a namespace never
renames. Isolation is structural: an ontology's tables and vector indexes live in its
own namespace, all DDL and queries run unqualified against the transaction's search
path, and no statement can name another ontology's namespace.

`public` is the server-wide home. It holds the registry table `ontology` — one row per
ontology, carrying the id, key, display name, timestamps and the namespace name — and
nothing ontology-scoped; `ont_*` namespaces hold only ontology-scoped data. The registry
table, not the engine's catalog, is the authoritative ontology list; the catalog is
consulted only to sweep orphaned namespaces.

Boot DDL creates only the `public` objects. **Registry create** is one transaction:
the registry row first — so a concurrent same-key create dies on the named constraint as
a conflict — then the fresh namespace, the ten tables below and, when an embedding width
is given, the fixed vector indexes inside it. **Registry delete** is one transaction:
the registry row out, the namespace dropped in one cascade. A bound store applies its
ontology's namespace to the search path per statement, inside the shared transaction
machinery.

## Logical to physical mapping

Schema objects are plain relational tables, one per object kind, joined by foreign keys —
per namespace:

| Logical | Table | Joined by |
|---|---|---|
| Lens | `lens` | referenced by its inclusions, agents and saved queries |
| Entity type | `entity_type` | referenced by its property definitions and inclusions |
| Relation type | `relation_type` | endpoint entity type keys as deletion-restricted references to `entity_type`; referenced by its property definitions and inclusions |
| Property definition | `property_def` | exactly one of two owner columns — entity type or relation type — enforced by a check constraint |
| Scope inclusion | `lens_includes` | its lens plus exactly one of two type columns; the optional property allowlist is an array column, and an absent allowlist is stored as null, never as an empty array |
| Agent configuration | `ai_agent_config` | its lens |
| Saved query | `saved_query` | its lens, with the denormalized lens key alongside |

Every schema row carries a `uuid` primary key. That is load-bearing beyond identity: the
name of a dynamically created vector index embeds the uuid of the schema row that causes
it to exist (naming, below).

Deleting a schema object cascades through the foreign keys — property definitions,
inclusions, agents and saved queries die with their owner. The DDL carries structure
only, per the rule in [decisions.md](decisions.md#storage): identity, referential
integrity, exactly-one-owner and uniqueness, with no backstop for the business rules the
service validates. The uniqueness constraints on type keys act per namespace, which is
exactly the per-ontology key scoping the contract requires.

## Naming transformations

There is no naming transformation. A type key never becomes a table, column or index
name — it is a value in a `type_key` column, appearing at most as a quoted literal
inside a partial-index predicate. Both reserved key sets are therefore empty: no key can
collide with an adapter object.

The one mechanical naming rule covers the dynamically created vector indexes:
`vec_<table>_<id>`, where `<id>` is the 32-hex-character uuid, hyphens stripped, of the
schema row that causes the index to exist — the entity type row for a per-type index,
the property-definition row for a document property's chunk index. The name is
reversible in both directions with no registry: name to uuid to schema row to type key,
and type to uuid to name, so index names are never stored. The `vec_` prefix is barred
to every fixed adapter object, keeping the dynamic and static namespaces disjoint by
construction — the two fixed vector indexes live outside it.

## How instance data is stored

Two generic tables per namespace hold all of an ontology's instance data, however many
types its schema declares: `entity` and `relation`. Each row carries its `uuid` id, its
type key, its user properties as one `jsonb` document, and its timestamps; an entity row
additionally carries its embedding vector in a dedicated dimensionless column, never
inside the properties document. A schema change — a new type, a new property — is
therefore pure data: no DDL ever runs against a live database. The deliberation behind
this mapping is [adr/0015](adr/0015-generic-jsonb-instance-tables.md); the binding rule
is in [decisions.md](decisions.md#storage).

Chunks live in a third table, `document_chunk` — one row per passage with its owning
entity, type and property keys, ordinal, offsets, text and optional vector.

The silent-cascade contract on entity deletion is translated into foreign keys:
relations reference their two endpoint entities, and chunks their owning entity, all
with cascading deletes. Deleting an entity removes its relations in either direction and
its chunks in the same statement, and a dangling endpoint is unrepresentable. The
instance tables' type-key columns carry no foreign key to the schema tables — deleting a
type deliberately orphans its instances, matching the documented deletion behaviour.

Five B-tree indexes back the hot paths: entity rows by type key; relation rows by type
key, by source entity and by target entity; chunk rows by owning entity and property
key. Filters, sorts and text search evaluate jsonb expressions that cast a property to
its declared data type; property keys and values are both bound parameters, never SQL
text. A path condition is an existential subquery over the relation table — anchored on
the listed row's id at the near endpoint column, joined to the related row at the far
one, the relation type key bound like a property key — with the comparison evaluated on
the related row's properties; the endpoint indexes serve it.

## Index inventory

Created only when an embedding provider is configured — all HNSW over the embedding
column cast to the provider's width, all cosine, all per namespace:

| Vector index | Form | Scope |
|---|---|---|
| One per entity type | partial index on `entity`, predicated on the type key | that type's rows |
| One per document property | partial index on `document_chunk`, predicated on the entity type key and property key | that property's passages |
| One across all entity types | full-table on `entity`, fixed name | cross-type entity search within the ontology |
| One for saved queries | full-table on `saved_query`, fixed name | description search within the ontology |

The two fixed-name indexes exist once per namespace — cross-type search and saved-query
search are ontology-scoped by construction, because a bound store's search can only see
its own namespace's index.

An index's width is read back from its own indexed column type in the catalog — the
`vector(D)` of the cast expression — and that is what width reconciliation compares,
namespace by namespace across the registry. Builds are plain, transactional index
creation; a failed or interrupted build leaves nothing behind, so no failed-index defence
exists or is needed. The filterable-property
list a caller may pass on index creation is accepted and ignored: property values are
never index metadata here, so every property filters semantic search, always, with no
declaration and no rebuild.

Search behaviour: the similarity returned is `1 − cosine_distance / 2` — algebraically
identical to the Neo4j adapter's cosine index score, the same 0-to-1 scale, pinned by a
fixed-vector conformance case. Every vector query runs as a strict-order iterative scan,
so a result limit counts rows that passed the filters, delivered in exact distance
order. A minimum score is applied after the limit, so a page may shrink — including when
the iterative scan gives up at its tuple cap.

## Engine constraints worth knowing

**A row's properties are one jsonb value, bounded at roughly 255 MB.** The bound is the
engine's, sits far beyond any practical property map, and is the only size limit on a
property document — the documents capability rightly states none.

**Listing order is fully deterministic.** Every listing's ordering carries a trailing
tie-break on the row id, so pagination among equal sort values is stable. That
determinism is this adapter's own; the port does not promise it.

**String ordering follows the database's default collation.** No collation is ever set
explicitly; strings sort dictionary-style under the deployment's default collation,
which is the behaviour the shared documentation states.

---

# Part 3 — The Neo4j adapter (non-normative)

> Everything below describes how the **Neo4j** adapter satisfies Part 1. It is
> illustration, not contract. No name, convention or structure in this part is part of
> the port, and a different adapter is free to share none of it.

## Capped at one ontology

The Neo4j adapter implements the full port but its registry holds **at most one
ontology**: the first create succeeds, a second is rejected as a domain conflict, and
deleting the one ontology returns the adapter to zero — after which a create works
again. With a single ontology, the label derivation and Cypher below are exactly what a
single-database deployment implies, and no per-ontology qualification exists anywhere.
The adapter passes the contract conformance tier; the multi-ontology tier does not run
against it.

The registry entry lives on a single internal node labelled `_OntologyRegistry` —
underscore-internal, like every physical name no key can produce. Registry create
pre-checks the cap, creates the fixed vector indexes when an embedding width is given
(index DDL cannot share a transaction with data writes in this engine; a mid-way failure
leaves nothing observable through the port), then writes the registry node with a
single-statement conditional create as the in-transaction backstop. Registry delete
wipes the whole graph — schema nodes, instance nodes, chunks, and the registry node —
and drops every vector index, so no width or filter-property imprint of the deleted
schema survives; the boot-time constraints stay.

## Logical to physical mapping

Schema objects are nodes, joined by relationships:

| Logical | Node label | Joined by |
|---|---|---|
| Lens | `Ontology` — a physical name exempt from the vocabulary lock ([decisions.md](decisions.md#ontologies)) | `INCLUDES_TYPE` to a type node, carrying the optional property allowlist |
| Entity type | `EntityType` | `HAS_PROPERTY` to its property nodes |
| Relation type | `RelationType` | `HAS_PROPERTY`, plus `RELATES_FROM` and `RELATES_TO` to its endpoint entity types |
| Property definition | `PropertyDefinition` | — |
| Agent configuration | `AiAgentConfig` | `HAS_AI_AGENT` from its lens |
| Saved query | `SavedQuery` | `HAS_SAVED_QUERY` from its lens |

Instance data lives in the same database, distinguished by underscore-prefixed internal
names:

| Logical | Physical |
|---|---|
| Entity | A node with the marker label `_Entity` plus its type label |
| Relation | A native relationship between two entity nodes |
| Chunk | A node with the marker label `_Chunk` plus a virtual label per document property, linked from its entity by `_HAS_CHUNK` |

## Naming transformations

Entity type keys become PascalCase labels: `research_paper` becomes `ResearchPaper`.
Relation type keys become upper snake case relationship types: `works_for` becomes
`WORKS_FOR`. A document property's chunks get a virtual label built from both keys —
entity type `person` with document property `bio` yields `PersonDocumentBio`.

These transformations are what generate the adapter's reserved key sets. An entity type
key is reserved when its PascalCase form is one of the six schema node labels, giving
`ontology`, `entity_type`, `relation_type`, `property_definition`, `ai_agent_config` and
`saved_query` — the first of those derives from the kept `Ontology` lens label. A
relation type key is reserved when its upper-snake form is one of the six schema
relationship types, giving `includes_type`, `has_property`, `relates_from`,
`relates_to`, `has_ai_agent` and `has_saved_query`. The internal names `_Entity`,
`_Chunk`, `_HAS_CHUNK` and `_OntologyRegistry` need no reservation, since no valid key
can produce a leading underscore.

## How instance data is stored

Entity properties are stored as native node properties, not as a serialized blob, so that
the engine's own filtering, ordering and indexing apply directly. The data types map
one-to-one: string, integer, float, boolean, date and datetime to their native
counterparts, and a document property to a string.

Relations are native relationships rather than intermediate nodes. That choice buys
natural traversal patterns, the engine's optimised relationship storage, and compatibility
with its graph algorithms and visualization tooling — at the cost noted under engine
constraints below. A path condition is an existential pattern predicate: one relationship
of the type from the listed node, in the resolved direction, to the related node, with the
comparison on that node's properties.

Chunks are separate nodes rather than a nested structure, because each needs its own
vector and its own place in a vector index. Deleting an entity removes its chunk nodes in
the same statement.

## Index inventory

Created at startup, unconditionally:

| Kind | On | Purpose |
|---|---|---|
| Uniqueness constraint | `Ontology` internal id, key, name | Lens identity |
| Uniqueness constraint | `EntityType` internal id, key | Entity type key uniqueness |
| Uniqueness constraint | `RelationType` internal id, key | Relation type key uniqueness |
| Uniqueness constraint | `PropertyDefinition` internal id | Property identity |
| Uniqueness constraint | `AiAgentConfig` internal id | Agent identity |
| Uniqueness constraint | `SavedQuery` internal id | Saved-query identity |
| Uniqueness constraint | `_Entity` instance id | Instance identity |
| Index | `_Entity` type key | Every listing filters on it |

With the registry capped at one ontology, per-database uniqueness and per-ontology
uniqueness are the same thing.

Created only when an embedding provider is configured — the fixed pair at registry
create, the dynamic ones as the schema changes shape:

| Vector index | On | Filterable in-index |
|---|---|---|
| One per entity type | The type's own label | All of the type's non-document property keys |
| One across all entity types | The `_Entity` marker label | — |
| One per document property | That property's virtual chunk label | — |
| One for saved queries | `SavedQuery` | The owning lens key |

All use cosine similarity. The per-entity-type indexes are rebuilt whenever the type's
property set changes, so their in-index filter list stays in step with the schema. A
document property's chunk index is created the moment the property is added and dropped
when the property or its type is removed.

## Engine constraints worth knowing

**Indexed string values have a size ceiling.** Because a per-type vector index stores the
type's property values as filter metadata, indexed string values are subject to the
engine's indexed-property size limit of 32766 bytes. Writes exceeding it are rejected with
a validation error before persistence, phrased without naming the engine. Document
property values are exempt — they are never part of an entity's embedding or its filter
metadata. The same mechanism is why a saved query carries its owning lens key as a
node property: the vector index can filter on node properties but not across
relationships, so the key is denormalized onto the node.

**Community Edition has no relationship property indexes.** Looking up a relation by its
id therefore scans the relationships of that type. Acceptable at expected volumes; a
secondary lookup structure would be the remedy if it stops being.

**A failed index is silently useless.** Before recreating a vector index the adapter
checks for an index left in a failed state and drops it first, since a create-if-absent
would otherwise skip over it forever.

---

# Implementing a new adapter

Provide, in this order:

1. **Connection lifecycle, physical isolation and physical naming.** Decide how an
   ontology's data is kept apart from its neighbours', and how a type key becomes a
   physical object, before writing a single query — every later decision depends on
   both. Derive and declare the two reserved key sets from the naming transformation
   immediately. If the isolation mapping cannot hold more than one ontology, cap the
   registry as a domain conflict rather than pretending.
2. **Error translation.** Build the single choke point through which all database access
   passes, before any operation exists to bypass it.
3. **The registry.** Create with atomic provisioning, list, read, rename, delete as one
   cascade. Nothing else works until an ontology can exist.
4. **Constraints and indexes.** Everything under the uniqueness obligation — the
   server-wide part at initialization, the per-ontology part at registry create.
5. **The schema side.** Lenses, types, properties, inclusions, full-schema retrieval,
   agents and saved queries. Nothing on the data side is useful until the schema can be
   read back.
6. **The data side.** Entities, relations, traversal, chunks.
7. **Filters, sorts and text search.** The predicate builder, shared by listing and by
   filtered vector search.
8. **Vector indexes and search**, including width reconciliation.
9. **Query compilation.** Last, because it needs the naming transformation from step 1 and
   nothing else.

Three traps, each of which produces a system that passes casual testing and fails later:

**Reserved keys derive from *your* physical naming.** They are not a fixed list to be
copied from another adapter. Work out every key whose transformed form could collide with
your own storage objects, and declare exactly those. Declare too few and a user can create
a type that overwrites your schema; declare too many and you reject keys for no reason.

**A vector index fixes its width when it is created.** Creating-if-absent will not widen
one, and the stale index reports itself as healthy. Reconcile widths on every create path,
report on startup, and repair only when the caller explicitly asked for a rebuild.

**The error contract is not optional.** A driver exception that escapes the port puts
vendor vocabulary into a client response and breaks the guarantee the whole boundary
exists to provide. Equally, do not over-catch: a domain exception raised inside a database
scope must keep its identity, and a bug must still look like a bug.
