# Storage adapters

Everything OntoForge persists crosses one boundary: the persistence port. Above it,
services speak ontology vocabulary only — keys, property definitions, structured filters,
instance identifiers. Below it, exactly one adapter knows a database.

This document is the contract an adapter must satisfy. Concepts and vocabulary:
[README.md](README.md). Where the port sits in the system:
[architecture.md](architecture.md). The rules that put it there:
[decisions.md](decisions.md).

**Two parts, and the difference matters.** Part 1 is normative: it binds every adapter.
Part 2 describes the reference adapter and binds nothing — it is named technology,
included so the contract has a worked example. Nothing in Part 2 may be relied on by code
above the port, and nothing in it constrains a second adapter.

---

# Part 1 — The contract (normative)

## What crosses the port

Five rules govern the boundary itself. They hold for every operation without exception.

**Only JSON-safe values cross.** Scalars, strings, booleans, numbers, lists, maps. No
driver objects, no cursors, no result handles, no lazily-evaluated streams. An operation
returns materialised data.

**Temporals cross as language-native date and datetime values.** Whatever temporal
representation the driver uses is the adapter's private business, converted in both
directions at the boundary. A service must never receive a value it has to recognise as
belonging to a particular database client. Datetimes carry a timezone; naive values are
treated as UTC.

**Filters, sorts and searches cross as structured values, never as query text.** A filter
is a list of parsed conditions — property key, declared data type, operator, and the value
already coerced to that type; a sort is a property key plus a direction; a text search is
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
type keys and one for relation type keys. They are returned as ontology-level keys, never
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
| Initialize | Open connections, verify the database is reachable, create every constraint and index the adapter needs, and return the two store surfaces. Failure prevents the server from serving. |
| Close | Release connections. Idempotent. |
| Ensure semantic indexes | Given a vector width, create every vector index the current schema implies. Called at startup only when an embedding provider is configured. |
| Wipe | Delete all stored data. Test support only; nothing in the running system calls it. |

## The two store surfaces

Two stores, matching the modeling/runtime split. Neither knows about the other. Operations
are grouped by capability below; each group states the shape of the data and the rules the
adapter must honour, not per-operation signatures.

Internal identifiers appear in this section because they are the store's own currency.
They never reach a caller — see the keys-not-identifiers rule in
[decisions.md](decisions.md).

### Schema side

**Ontology management.** Create with a caller-supplied internal id, key, name and optional
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

**Scope inclusion management.** An inclusion joins one ontology to one type and optionally
carries a property allowlist; an absent allowlist means all properties, and is not the
same as an empty one. Add an inclusion, list the inclusions of one kind for an ontology,
update its allowlist, remove one. Beyond the plain lifecycle, four operations
exist purely to serve the cascade protocol and must be provided:

- Remove every inclusion referring to a given type, across all ontologies.
- List the ontology keys that include a given type.
- List the ontology keys whose inclusion for a given type carries an explicit allowlist
  that does **not** name a given property — ontologies with no allowlist auto-track the
  type's properties and must not be reported.
- Add, or remove, a property key across every explicit allowlist that names a given type,
  returning how many were changed.

**Full-schema retrieval.** One operation returns the entire global schema in a single
call: every entity type with its properties, every relation type with its properties and
its endpoint keys, and every ontology with its inclusions. It backs validation, export and
cross-cutting checks, and must be a coherent snapshot rather than a walk the caller
stitches together.

**Agent and saved-query storage.** Both belong to an ontology and are addressed by key
within it. For each: list for an ontology, read one by key, upsert, delete, and a
list-for-export variant that returns the full stored form rather than the summary. Upsert
reports whether it created or updated, because the interface layer distinguishes the two.
An agent carries name, description, system prompt and a tool allowlist. A saved query
carries name, description, and its steps and parameters as serialized text — the store
does not interpret them. A saved query also accepts an embedding of its description, and
the key of its owning ontology alongside it, so that a search over descriptions can be
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
modeling side. Three operations, all keyed by ontology key: the full schema as that lens
sees it — all types globally, plus that ontology's inclusions, so the caller can compute
the scope — its agent configurations, and its saved queries. The first returns nothing at
all when no ontology has that key, which is how an unknown lens is detected.

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
| Entities | A query vector, and either one entity type key with its scoped property definitions and optional filter conditions, or nothing — meaning all types at once | Entities with scores |
| Document chunks | A query vector, an entity type key and a document property key | Chunks with scores |
| Saved queries | A query vector and an ontology key | Saved-query summaries with scores |

The per-type entity search accepts the same parsed filter conditions that listing does and
must apply them as part of the search, not after it, so that the limit counts filtered hits.
Cross-type entity search takes no filter; narrowing to a lens happens above the port.
Saved-query search is always narrowed to a single ontology.

Literal text matching is not a separate operation — it is the search string on the listing
operations, matched case-insensitively as a substring against the named string properties,
any one of which matching admits the row. See
[capabilities/search.md](capabilities/search.md).

**Validated-query execution.** Take a validated query object and an optional parameter
map, compile, execute read-only, and return the ordered column names together with the
rows. Each row maps column name to a converted value. Nodes and relationships become plain
property maps; temporals are converted; vectors are stripped; lists and maps are converted
recursively so nothing driver-shaped survives at any depth.

## Obligations beyond storage

An adapter is not only a set of writes and reads. Seven responsibilities sit entirely inside
it, and a new adapter that implements the operations but skips these is not a working
adapter.

**Physical naming, and the reserved keys it implies.** The adapter alone decides how a
type key becomes a physical object. Whatever that transformation is, it must then declare
every ontology-level key whose transformed form would collide with the adapter's own
storage objects. The declaration is what makes the collision rejectable at the service
layer, in a message naming neither vendor nor physical name. Names the adapter reserves
for internal use are safe without declaration only if they cannot be produced by the
transformation at all — a leading underscore is such a case, since no valid key starts with
one.

**Uniqueness.** The store is the last line, not the first. Services pre-check for
conflicts, but the store must itself enforce uniqueness of: each ontology's internal id,
key and name; each entity type's internal id and key; each relation type's internal id and
key; each property definition's internal id; each agent configuration's internal id; each
saved query's internal id; and each entity instance's id. A concurrent pair of writes must
produce a conflict, not a duplicate. Lookup of instances by type key must be indexed —
every listing depends on it.

**Vector index lifecycle.** The adapter owns index creation and removal, and the port
exposes exactly the hooks the schema lifecycle needs: create the index for an entity type
at a given width, optionally naming the properties to be filterable inside it; drop it;
rebuild it against the type's current properties; create and drop the index for a document
property's chunks; ensure the saved-query index; and ensure all of them at once. All are
called at the points where the schema changes shape — adding a type, deleting a type,
adding or removing a property, adding or removing a document property — and are no-ops
when no embedding provider is configured.

**Vector index width reconciliation.** An index fixes its vector width when it is created,
and a create-if-absent is a no-op against an index that already exists — the failure mode
this produces, and why startup reports it instead of repairing it, are in
[decisions.md](decisions.md#behaviour) and
[capabilities/search.md](capabilities/search.md#vector-index-width-drift). The adapter's
obligation is threefold: before every create, read the existing index's configured width
and compare it; on the startup path report a mismatch and change nothing; on the rebuild
path, which passes an explicit recreate flag, drop and recreate at the new width. The
report must describe the index the way the API does — by entity type, by document property,
or by search scope — and never by its physical name.

**Building predicates from structured filters.** Filters arrive as parsed conditions, and
the adapter must turn every condition into a predicate the database can evaluate. The
operator vocabulary is fixed by the caller-facing surface, not by the adapter, and is
enumerated once in [interfaces.md](interfaces.md#listing-sorting-filtering); an adapter
supports all of it and invents none of it. Validation happens above the port: the three
filter faults — an unknown property, an unknown operator, a value that will not coerce —
are raised there as domain validation errors, identically on every backend, so the adapter
receives only valid conditions and raises no filter validation error of its own. Each
condition's value is already coerced to the property's declared data type; the substring
operator is the exception, comparing case-insensitively on the string form of both sides
and carrying that string form as its value. One fault remains the adapter's to raise, as a
domain validation error and not a storage error — Neo4j-specific, raised on the write path
through the write-value constraint above: an indexed value exceeding the 32766-byte
ceiling, in an error naming the property. Every value must reach the database as a bound
parameter. Type keys and property keys may be interpolated into generated query text —
they originate from the stored schema, never from request input — but values never may.

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
Results come back in ontology vocabulary, so no reverse translation of names is required —
the compiled query returns whatever the caller asked for, converted per the value rules
above.

---

# Part 2 — The reference adapter (non-normative)

> Everything below describes how the one shipped adapter, built on **Neo4j**, satisfies
> Part 1. It is illustration, not contract. No name, convention or structure in this part
> is part of the port, and a different adapter is free to share none of it.

## Logical to physical mapping

Schema objects are nodes, joined by relationships:

| Logical | Node label | Joined by |
|---|---|---|
| Ontology | `Ontology` | `INCLUDES_TYPE` to a type node, carrying the optional property allowlist |
| Entity type | `EntityType` | `HAS_PROPERTY` to its property nodes |
| Relation type | `RelationType` | `HAS_PROPERTY`, plus `RELATES_FROM` and `RELATES_TO` to its endpoint entity types |
| Property definition | `PropertyDefinition` | — |
| Agent configuration | `AiAgentConfig` | `HAS_AI_AGENT` from its ontology |
| Saved query | `SavedQuery` | `HAS_SAVED_QUERY` from its ontology |

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
`saved_query`. A relation type key is reserved when its upper-snake form is one of the six
schema relationship types, giving `includes_type`, `has_property`, `relates_from`,
`relates_to`, `has_ai_agent` and `has_saved_query`. The internal names `_Entity`, `_Chunk`
and `_HAS_CHUNK` need no reservation, since no valid key can produce a leading underscore.

## How instance data is stored

Entity properties are stored as native node properties, not as a serialized blob, so that
the engine's own filtering, ordering and indexing apply directly. The data types map
one-to-one: string, integer, float, boolean, date and datetime to their native
counterparts, and a document property to a string.

Relations are native relationships rather than intermediate nodes. That choice buys
natural traversal patterns, the engine's optimised relationship storage, and compatibility
with its graph algorithms and visualization tooling — at the cost noted under engine
constraints below.

Chunks are separate nodes rather than a nested structure, because each needs its own
vector and its own place in a vector index. Deleting an entity removes its chunk nodes in
the same statement.

## Index inventory

Created at startup, unconditionally:

| Kind | On | Purpose |
|---|---|---|
| Uniqueness constraint | `Ontology` internal id, key, name | Ontology identity |
| Uniqueness constraint | `EntityType` internal id, key | Global entity type key uniqueness |
| Uniqueness constraint | `RelationType` internal id, key | Global relation type key uniqueness |
| Uniqueness constraint | `PropertyDefinition` internal id | Property identity |
| Uniqueness constraint | `AiAgentConfig` internal id | Agent identity |
| Uniqueness constraint | `SavedQuery` internal id | Saved-query identity |
| Uniqueness constraint | `_Entity` instance id | Instance identity |
| Index | `_Entity` type key | Every listing filters on it |

Created only when an embedding provider is configured:

| Vector index | On | Filterable in-index |
|---|---|---|
| One per entity type | The type's own label | All of the type's non-document property keys |
| One across all entity types | The `_Entity` marker label | — |
| One per document property | That property's virtual chunk label | — |
| One for saved queries | `SavedQuery` | The owning ontology key |

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
metadata. The same mechanism is why a saved query carries its owning ontology key as a
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

1. **Connection lifecycle and physical naming.** Decide how a type key becomes a physical
   object before writing a single query — every later decision depends on it. Derive and
   declare the two reserved key sets from that transformation immediately.
2. **Error translation.** Build the single choke point through which all database access
   passes, before any operation exists to bypass it.
3. **Constraints and indexes.** Everything under the uniqueness obligation, created at
   initialization.
4. **The schema side.** Ontologies, types, properties, inclusions, full-schema retrieval,
   agents and saved queries. Nothing on the data side is useful until the schema can be
   read back.
5. **The data side.** Entities, relations, traversal, chunks.
6. **Filters, sorts and text search.** The predicate builder, shared by listing and by
   filtered vector search.
7. **Vector indexes and search**, including width reconciliation.
8. **Query compilation.** Last, because it needs the naming transformation from step 1 and
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
