# Storage adapters

Everything OntoForge persists crosses one boundary: the persistence port. Above it,
services speak schema vocabulary only — keys, property definitions, structured filters,
instance identifiers — through stores bound to one ontology and a small registry port.
Below it, exactly one adapter knows a database.

This document is the contract an adapter must satisfy. Concepts and vocabulary:
[README.md](README.md). Where the port sits in the system:
[architecture.md](architecture.md). The rules that put it there:
[decisions.md](decisions.md).

**One part binds; one describes.** Part 1 is normative: it binds every adapter. Part 2
describes the adapter OntoForge ships — PostgreSQL, the only value `DB_BACKEND` accepts —
in named technology. It binds nothing: nothing in it may be relied on by code above the
port, and nothing in it constrains another adapter. The known limitations in observable
behaviour are enumerated in one place, between the contract and the adapter part.

---

# Part 1 — The contract (normative)

## Bound stores and the registry

The port has four surfaces: a modeling store, a runtime store and a search-index store
([below](#the-search-index-store)), each obtained **bound to one ontology**, and an
**ontology registry** that manages ontologies as whole units.

**Stores are bound.** A store is requested for an ontology key and every operation on it
resolves within that binding. The binding check happens above the adapter — the port
accessors verify the key against the registry and fail with not found before the adapter
is asked for a store — so an adapter may hand out bound stores without checking. All
store operations below are written as if the ontology were the whole world, because
through a bound store it is.

**Isolation is total.** An operation on a store bound to one ontology must never
observe, return, or affect another ontology's data — schema, instances, vectors, or
search indexes. "One request, one ontology" is structural above the adapter and
physical inside it: *how* the data of two ontologies is kept apart is each adapter's
private business, described only in its own non-normative part, and nothing above the
port may depend on the mechanism.

**The registry manages ontologies as whole units.** Its rows carry the internal id, the
key, the optional display name and timestamps. Six operations:

| Operation | Obligation |
|---|---|
| Create | Given an internal id, a key, an optional display name and an optional embedding width, create the registry entry **and provision the ontology's physical home atomically** — a failed create leaves no entry and no home. When a width is given, the home carries the fixed semantic indexes at that width; when none is given, it carries no vector indexes. |
| List | Every ontology, as registry rows. |
| Read by key | One row, or an absent result. |
| Read by display name | One row, or an absent result — display names are unique server-wide, and the pre-write conflict check needs the lookup. |
| Rename | Set the display name; the key never changes. Absent result when not found. |
| Delete | Hard cascade: the ontology's physical home and its registry entry go together — schema, lenses, agents, saved queries, retrievers, navigators, instances, anchors, changesets, and every search index. False when not found. |

The registry — not the database's own catalog — is the authoritative list of ontologies.
The store must enforce server-wide uniqueness of the ontology key and the display name;
a concurrent pair of creates must produce a conflict, not a duplicate.

The conformance suite covers everything in this part, at a scale of one ontology and of
several at once — independent same-key schemas, disjoint instance data, cross-ontology
search silence.

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
is a list of parsed conditions, each tagged with its kind, in two families. The comparison
conditions carry an operator and a value: the property condition names a property key,
its declared data type, the operator, and the value already coerced to that type; the
path condition carries a relation type key, an explicit direction — outgoing or incoming
— the source of the final property (the related entity, or the relation itself), the
final property key, its data type, the operator and the coerced value. The existence
conditions carry no value, only whether the subject must be present: the property
existence condition names a property key; the path existence condition carries the same
resolved path as a comparison path, minus the data type, operator and value; the relation
existence condition carries a relation type key and an explicit direction alone. The
service resolves every path and relation subject above the port, so an adapter receives
only valid, fully resolved conditions and never a key to interpret. A sort is a property
key plus a direction; a text search is
a string plus the list of property keys to match it against. No fragment of any query
language enters or leaves the port. The one exception is the validated query object,
described below, which is opaque rather than textual.

**Driver exceptions never escape.** Every failure the adapter cannot express as a domain
condition surfaces as the single storage error, carrying a generated id and no storage
detail. The adapter logs the original — vendor name, driver code, message, stack —
against that id. Expected conditions are not exceptions: a missing row is an empty result
or an absent value, and a failed delete is a false return. See the error table in
[architecture.md](architecture.md).

**An adapter declares whether its search evaluates relation conditions** — path
conditions and relation existence conditions alike. One plain
flag on the runtime store: the constraint is the adapter's, the enforcement point is
shared. The runtime service reads it before any search
runs. On an adapter declaring support, a query path or relation subject on search resolves
exactly as on the entity list and crosses the port as its condition with every ranking; on
one declaring none, it is rejected above the port as a validation error naming the entity
list as the alternative — after resolution, so a malformed key is still reported as
malformed — and no search ever receives a path or relation existence condition.

One further caution, because it is invisible from the signatures: the port carries a
discriminator distinguishing an entity type from a relation type — as the owner of a
property definition, and as the target of a scope inclusion. Its two literal values are
`EntityType` and `RelationType`. They are fixed strings on the wire, not a licence to name
physical objects that way; a new adapter accepts them and maps them to whatever it stores.

## Lifecycle

| Operation | Obligation |
|---|---|
| Initialize | Open connections, verify the database is reachable, create every **server-wide** constraint and index the adapter needs, bring storage of an older storage version up to date ([decisions.md](decisions.md#storage)), and hand out the registry and the bound-store factories. Per-ontology storage is provisioned by registry create; at initialization only an upgrade reaches into it. Failure prevents the server from serving. |
| Close | Release connections. Idempotent. |
| Ensure semantic indexes | Given a vector width, create every vector index the current schemas imply, for **every ontology the registry lists** — doing nothing when there are none. Called at startup only when an embedding provider is configured. |

## The two store surfaces

Two stores, matching the modeling/runtime split, each bound to one ontology. Neither
knows about the other. Operations are grouped by capability below; each group states the
shape of the data and the rules the adapter must honour, not per-operation signatures.
"Unique" in this section always means unique within the bound ontology.

Internal identifiers appear in this section because they are the store's own currency.
They never reach a caller ([decisions.md](decisions.md#naming)).

### Schema side

**Lens management.** Create with a caller-supplied internal id, key, name and optional
description. List all. Read by internal id, by key, and by name — the last two exist
separately because both are unique and both are used to detect a conflict before a write.
Update name and description. Delete.

**Type management.** Entity types: create with id, key, display name, description; list;
read by id; read by key; update display name and description; delete. Relation types: the
same, plus the source and target entity type keys supplied at creation and never
updatable, and an optional parent end, source or target, written by the flag write below;
all three are returned on every read. One extra predicate is required on the entity type
side: whether any relation type currently names a given entity type as an endpoint. It
backs the rule that an entity type in use cannot be deleted.

**The parent flag.** A relation type's parent end is written on create and by its own flag
write, which sets, changes or clears it. Both check the parent rules
([capabilities/schema-modeling.md](capabilities/schema-modeling.md#parent-relations))
against the stored relations, in one transaction, before they write. The reading is every
stored parent relation — relation type key to parent end — with the written key's new end
in place of its stored one. Under it they count the entities that are the child end of
more than one stored relation, and the entities on a cycle, a self-loop included; when either count is
not zero they return each broken rule with its count and its first five entities, ordered
by type and id, and write nothing. Clearing counts nothing and is never refused. The count
must end on any stored data, cycles included, and takes no lock. A read-only variant
counts the same for a given set of readings and writes nothing; import's validation runs
it before any write.

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

**Search-data maintenance.** Backing the rebuild operation: list every saved query with
enough identity to re-embed it; set the embedding on one saved query. Plus the vector
index operations under obligations, below.

### Data side

**Schema reading.** The runtime side reads the schema for itself rather than calling the
modeling side. The runtime store exposes three operations, each keyed by lens key within
its binding. One returns the full schema together with the lens and its inclusion rows,
one returns the lens's agent configurations, and one returns the lens's saved queries. The
caller uses the inclusion rows to compute the scoped schema. The first also carries the
keys of the search indices the lens includes, in key order. The first returns nothing at all when no lens has that key, which is how an unknown lens
is detected. The runtime store also exposes the ontology key it is bound to, because the
schema cache keys its entries by ontology plus lens.

**Entity lifecycle.** Create with the type key, a caller-supplied instance id and the
validated property map. Read by type key and id; read by
id alone, when the type is not known; read a batch by ids, returned as a map keyed by id.
The by-id reads carry property definitions alongside — the adapter's guide for converting
stored values back to their port forms on the way out, mirroring the definitions every
write already carries for the conversion inward; an adapter whose storage distinguishes
those forms natively may ignore them. Update takes the properties to set and the property
keys to remove as two separate inputs. Delete by type key and id, returning whether
anything was deleted.

Listing is the one read with real machinery. It takes the type key, the scoped property
definitions, the parsed filter conditions, an optional text-search string with the string
property keys to match, a validated sort property and direction, and a limit and offset.
It returns the page together with the total matching count — both, from one call.

A second read lists, for a type key and one property key, up to a given number of that
property's distinct stored values as text, in ascending order; an entity without the
property, or with an empty value, contributes none. A retriever's planner sees them
when they are few.

The adapter must set and maintain the system properties on every write: the instance id,
the type key, the creation timestamp on create, and the update timestamp on create and on
every update. Stored embedding vectors must never appear in a returned row.

**Relation lifecycle.** Create with the relation type key, an instance id, the two
endpoint entity ids and the property map. Read by type key and id. Update, with the same
set/remove split as entities. Delete. List, taking the same filter, sort, pagination and
count contract as entity listing, plus optional endpoint filters — restrict to relations
leaving a given entity, or arriving at one, or both. Every relation read returns its two
endpoint ids alongside its properties; endpoints are never updatable.

**Hierarchy.** Three operations serve the parent relations. Each read takes the parent
relations to follow as readings — relation type key to parent end — and with none answers
without touching storage; so does an id that cannot be an instance id.

- **The ancestor walk.** An entity's parent, the parent's parent and so on up to a
  hierarchy root, nearest first, each as type key and id, the entity itself never
  included and a root answering an empty list. Each ancestor appears once, at its nearest
  level; on data with two parents one level can hold several, ordered by type and id. The
  walk must end on any stored data, cycles included.
- **The children lookup.** Whether the entity is the parent end of at least one relation
  of the readings.
- **The create with a parent relation.** One write of an entity and the relation that
  names its parent, each with its own search write plan, in one transaction: the entity
  and its plan first, then the relation and its plan. A parent that vanished in between
  fails the whole write as not found, and nothing is written. It takes no lock: nothing
  can reference the new entity before commit.

**Commit reads.** Three reads serve a changeset's commit validation, and none evaluates a
rule. Two take readings as the hierarchy reads do: the parent links whose child end is one
of a set of ids, and those whose parent end is — the latter optionally locking those
entities and the links it finds until the transaction ends, so no child can attach
meanwhile. The third locks the entities and relations of a set of ids until the
transaction ends and returns their stored properties as stored; an unknown id is left
out. An id that cannot be an instance id matches nothing.

**Traversal.** Given an entity id, a direction of incoming, outgoing or both, an optional
relation type key filter, a limit, and property definitions keyed by type key — the same
row-conversion guide the by-id reads carry, covering whatever types the neighbourhood may
touch — return the adjacent relations paired with the entities at the far end. Each result is marked with the direction it was traversed. For
the combined direction the limit is a single budget: outgoing edges are taken first and
incoming edges receive only what remains, so the two are not independently limited. What
that costs a caller is in
[capabilities/instance-data.md](capabilities/instance-data.md#traversal).

**Search.** The runtime store declares whether search can rank by keyword — through its
search-index store ([below](#the-search-index-store)) — and declares path-condition
support for all search strategies. The service ranks through the search-index store;
fusion belongs above the port. Neither a bound store nor a query carries a language: a keyword generation stems in
its own language set.
Semantic scores are pinned to `(1 + cosine) / 2`, higher is better; arbitrary native
scores must not be labeled semantic similarity. A keyword score is the number of distinct
query words the entry contains plus, as a fraction below one, the adapter's native
ranking measurement, higher is better
([capabilities/search.md](capabilities/search.md#ranking)); the runtime passes it through
as evidence unchanged. A keyword-ranked entry establishes a positive match, while
non-membership in a limited ranking establishes no negative evidence.

Saved-query discovery is a separate vector ranking over descriptions, scoped to one
lens, with its own absolute score, limit and optional minimum score.

Literal text matching is not a separate operation — it is the search string on the listing
operations, matched case-insensitively as a substring against the named string properties,
any one of which matching admits the row. See
[capabilities/search.md](capabilities/search.md).

**Validated-query execution.** Take a validated query object and an optional parameter
map, compile, execute read-only, and return the ordered column names together with the
rows. Each row maps column name to a converted value. Nodes and relationships become plain
property maps; temporals are converted; vectors are stripped; conversion recurses through
lists of one element type, and nothing driver-shaped survives at any depth. What a map
literal or a mixed list carries back is the adapter's own shape — recorded with the
known limitations below.

## The search-index store

The search-index store holds an ontology's search indices, their generations, entries and
queued work, and its retrievers. The runtime store also hands out the search-index store
of its own ontology, so a write can plan its search work without a second binding, and so does its
modeling store, so a schema change can keep the managed indices in step. Registry delete
removes everything the store holds. The pipeline that uses this store is described in
[architecture.md](architecture.md#search-indexing).

**Settings.** One per ontology, read and replaced whole: the keyword language set every
keyword generation stems in, and a map of switched-off indices the store keeps without
interpreting. A new ontology starts with German and English.

**Index definitions.** Each carries an id, a key unique within the ontology, a kind —
`default`, `passage` or `custom` — and the definition as an opaque structured value that
names its root entity type. Create, list in key order, read by key, replace the
definition with the key unchanged, delete. Create and replace return an absent result
when the root entity type does not exist; a taken key is a conflict. Deleting an index
deletes its generations, their queued work and entries, and its lens inclusions; deleting
the root entity type deletes the index. One more operation includes an index in every
scoped lens that exposes its root entity type — by an entity inclusion of the type, or,
in a lens with relation inclusions only, because every type is exposed — skipping lenses
that include it already, and returns how many it was added to; a `passage` index also
needs its document property exposed, by an inclusion without an allowlist or with one
naming the document. Three serve one lens's inclusions: list the keys of the indices it
includes, in key order — none for an unknown lens; include one index by key, checking no scope rule — absent when the lens or the
index does not exist, a conflict when the lens includes it already; and remove one —
absent when the lens does not include it.

**Retrievers.** [Retrievers](capabilities/retrievers.md) search the
indices, so this store keeps them. Each belongs to a lens, is addressed by key within it
and is deleted with it. It carries an id, the key, a name, an optional description, a
configuration version, the configuration as an opaque structured value kept exactly as
given — a version or shape the service cannot run included — the warnings of a
conversion as a list of strings, and timestamps. List a lens's agents by name, then key;
read one by key. Save creates an agent or replaces its name, description, version,
configuration and warnings, its id and creation time unchanged, and reports whether it
created; in create-only mode an existing key is a conflict, and a missing lens is not
found. Writes to one lens's agents are serialized, so lens and key stay unique. Delete
answers false when the key is absent. Transfer copies an agent under a new id, or moves
it with its id, to another lens and key in one step, warnings included: a taken target
key is a conflict, never overwritten, and so is a source that no longer holds the
version and configuration the caller validated. No vector or conversation state is
stored.

**Modeling reads.** Two reads serve the modeling of indices. One lists the keys of the
lenses that include an index, sorted — the lenses its deletion names in a cascade
refusal. The other measures what a full build of an index would hold, for the cost
preview, from aggregates over the stored instances, never reading a document into
memory. It takes the root entity type, whether entities get an own entry, the document
property passages are cut from with the chunk size and overlap, and per relation group
the relation type, the end the root entity is on and the target types that count (any,
when none are named). It answers the number of root-type entities, own entries (that
number, or none), relation entries — the relations of each group's type whose root end
is a root-type entity and whose other end is of a counted type — and passages,
estimated per document as one up to the chunk size and one more per further chunk size
less overlap.

**Generations.** A generation is one build of one representation — semantic or keyword —
of one index. It carries the definition hash it was built from, the model id and vector
width (semantic) or the keyword language set (keyword), a state — `building`, `ready`,
`retired` or `failed` — and progress counters for total, done and failed parts. At most
one generation per index and representation is building, and at most one is ready: the
active one. Retired and failed generations keep their record; their queued work and
entries go.

| Operation | Obligation |
|---|---|
| Create | Start a building generation. One still building for the same index and representation is superseded: it retires. Given a root entity type to backfill, queue every entity of that type — one whole-entity item each — in the same transaction and set the total to their count, so a generation never appears with a queue not yet filled. Absent result when the index does not exist. |
| Read, list | One by id; all, or those of one index, oldest first. |
| Record progress | Add to the counters. |
| Finish | Make a building generation the active one in a single step: the previous active one retires. False when the generation is no longer building. |
| Fail | Mark a building generation failed. False when it is no longer building. |
| Retire | Retire a building or active generation no definition wants any more. False when it is neither. |
| Sweep | Remove the entry storage of every generation neither building nor ready — what an interrupted removal left behind. Idempotent. |

**Entries.** An entry is identified within its generation by entity id, part kind — the
entity's own fields, one relation, or one passage of a document — a group number, and a
part id: the relation id of a relation part, the chunk ordinal of a passage. It carries
the relation type and target of a relation part, the code-point offset and length of a
passage, its text, the text's hash and, in a semantic generation, its vector. The text
arrives capped at 8,000 code points and the hash — SHA-256 over text, representation
and the generation's model id (semantic) or keyword language set (keyword), as hex — is
computed above the port; the store keeps both as given. A
keyword generation receives no vector: the store derives the keyword representation from
the text in the generation's language set.

Entry writes address a generation by id wherever it is in its lifecycle. Upsert by
identity, refused — false, nothing written — once the generation is neither building
nor ready; a vector whose width differs from the generation's is a programming error.
Read the stored hashes of given parts. Delete given parts; delete an entity's parts of
one kind and group except a list to keep. Delete an entity's entries, or a relation's,
in every generation of the ontology. The worker composes against the ontology's full
schema, which the store reads for it — every type and property, unscoped.

**Ranking entries.** One operation ranks the entries of one generation, best first, and
returns nothing unless the generation is ready. A semantic generation takes a query vector
of its width and ranks by nearest vector, the score pinned to `(1 + cosine) / 2`; a
keyword generation takes the query text and the keyword matching and ranks by the
keyword score: the distinct query words an entry contains, then the adapter's native
keyword measurement as a fraction below one. The keyword query is built from the
adapter's own tokenizer output for the text in each language of the generation's set — the terms of
one language joined as any or all, each matching as a prefix, the languages as
alternatives — so search text never reaches query syntax, and a text yielding no term
matches nothing. Filter conditions apply to the entity owning each entry, inside the
ranking, so the limit counts entries that pass them. Two optional type lists restrict
relation entries only: one ranks only when its relation type is in the first and its
target type in the second. Each ranked entry carries its identity, the relation type and
target of a relation part, a passage's offset and length, its text and its score.

**Search work of a write.** Every entity and relation write of the runtime store — create,
update, delete — takes an optional search write plan, derived above the port from the
index definitions. It names, by index, the parts to compose again: parts of one entity;
the part of one relation, owned by its source end or its target end; and the parts of
every relation of a type that has a given entity at its other end — the fan-out of a
changed target, resolved by the adapter in one step. It also names an entity or relation
whose deletion removes its entries. The adapter applies the plan
**in the write's own transaction**: an index stands for every building or ready generation
of it, and the work is queued exactly when the write commits — only when a create or
update touched a row. A deletion removes the entity's or relation's entries and queued
work in every generation, together with those of the relations that cascade with a
deleted entity, so it is applied before the rows go.

**The queue.** A queued item names a generation, an entity and a part — one part, or
the whole entity (an entity created, a field every part renders changed, a backfill); a
passage item with an empty part id stands for all of the entity's passages, re-chunked.
Queueing an item already queued refreshes it instead of duplicating it: it is due at once,
its attempts start afresh, and it carries a new token. The worker's surface:

| Operation | Obligation |
|---|---|
| Queue a type | Queue every entity of a type, as one whole-entity item each, into the given generations — those neither building nor ready are skipped. Returns the count. |
| Claim | Lease up to a limit of claimable items — due, not leased or with an expired lease, attempts below the maximum, of a building or ready generation — keyword items first, then oldest first; semantic items only of generations of the given model id. Items another claim holds are skipped, never waited for. The lease commits with the claim. Each item carries its attempts and its token. |
| Complete | Remove claimed items — except one queued again since its claim (its token changed): that one stays, released for the next claim. A write during a lease is never lost. |
| Fail | Record a failed attempt — attempts plus one, the error and its time, the lease released, the item held back by its delay. An item queued again since its claim is not charged. |
| Statistics | Per generation with queued items: pending and failed counts, and the errors of failed or retrying items — the newest item per distinct message, newest first, at most ten, each with its entity, part kind, message and time. |

An item whose attempts reached the maximum is failed for good and never claimed again; a
new write of its entity, or a rebuild, gives it a fresh start. The delays, the maximum and
the lease length are the caller's.

**Wake-ups.** The adapter offers a subscription that calls back, with the ontology key,
whenever search work was queued in any server process on the same database — after the
queueing transaction commits, never before. A subscription may end on its own, a lost
connection for instance; it then says so and the subscriber subscribes again. Polling
above the port covers the time without one.

## The anchor store

The anchor store holds an ontology's [anchors](capabilities/anchors.md): per key, the
entity it points at — its type key and id — or none, the staged-only flag, and timestamps.
List, ordered by key; read by key, absent when unknown; save, an upsert that creates the
anchor or re-points it and returns the record as written, writing the flag when given and
otherwise keeping it, off for a new anchor; delete, false when the key is absent. Every
record read also says whether its entity is still stored under that type key. The store
never checks the pointer on save and never decides a state — the service does — so a
deleted entity leaves its anchors in place. The runtime store hands out the anchor store
of its own ontology. Anchors are not part of any export read, and registry delete removes
them.

## Transactions

The runtime store runs a unit of work on a store bound to one transaction, on one
connection, with read-committed isolation: it commits when the work returns and rolls back
when it throws. Every operation of that store, and of the anchor and changeset stores it
hands out, runs on that connection — the one exception to every operation owning its
connection. Anything that would take a second connection inside the work — a nested unit
of work, the full-schema retrieval, the search-index or navigator store — fails as a
programming error, so the work can never wait for a connection it holds itself. Only a
changeset's commit uses it.

## The changeset store

The changeset store holds an ontology's [changesets](capabilities/changesets.md): per
changeset its id, its lens, the anchor key of the URL that started it or none, a version, a
note, the time it was submitted or none, and timestamps; per staged write its seq, the
operation, its arguments, the id a create minted, the type key, the target id, an
update's before and its size in bytes, all kept as given. The store evaluates no rule —
the service does — except the state a write needs, which it judges in the statement that
writes, so a submit racing a change is never overwritten.

- **Reads.** Start; read one through its binding — a changeset of another lens, or bound
  to another anchor, is absent, and no anchor key reaches every changeset of the lens;
  list them bound the same way, submitted first, then by last change, newest first, with
  their counts per operation and the type keys they name; their staged writes by seq,
  paged; the staged create that minted a given id; the summed size of its staged writes.
- **Changes.** Append staged writes to a draft changeset, all or none, in order, each with
  a seq higher than every earlier one; unstage one by seq from a draft changeset; submit,
  a compare-and-set on the version of a draft changeset, setting the submitted time and
  the note; unsubmit a submitted one, with a note; discard a draft one with its staged
  writes. Each takes the changeset without waiting — one held elsewhere is a conflict at
  once — raises its version and refreshes its last change, and answers absent when the
  changeset is gone or in the other state.
- **Upkeep.** Touch refreshes the last change alone; sweep deletes the draft changesets
  unchanged since a given time. Both skip a changeset held elsewhere rather than wait or
  fail.
- **The commit**, inside a unit of work only: take the ontology's commit lock without
  waiting, then the changeset without waiting — either held elsewhere is a conflict — and
  from then on wait at most five seconds for a row another transaction holds, then fail
  as a conflict; finally delete the changeset with its staged writes.

Deleting a lens deletes its changesets, deleting an anchor leaves them, and registry
delete removes them. Changesets are not part of any export read.

## The navigator store

The navigator store holds an ontology's [navigators](capabilities/navigators.md): per lens
and key, a name, an optional description, a configuration version and the configuration as
given. The store never interprets a configuration — the navigator's check does. A save
creates the navigator or replaces its name, description and configuration, keeping its
identity and creation time; a create-only save refuses a taken key as a conflict, and a
missing lens is not found. Lists are ordered by name, then key. Deleting a lens deletes its
navigators. Both the modeling and the runtime store hand out the navigator store of their
own ontology.

## Obligations beyond storage

An adapter is not only a set of writes and reads. Seven responsibilities sit entirely inside
it, and a new adapter that implements the operations but skips these is not a working
adapter.

**Physical naming without collisions.** The adapter alone decides how a type key becomes
a physical object. Whatever that transformation is, no valid key may produce a name that
collides with the adapter's own storage objects: nothing above the port rejects such a
key. A name the transformation cannot produce at all is safe — a leading underscore is
such a case, since no valid key starts with one — and so is any key that is stored as a
value rather than turned into a name.

**Uniqueness.** The store is the last line, not the first. Services pre-check for
conflicts, but the store must itself enforce, within each ontology, uniqueness of: each
lens's internal id, key and name; each entity type's internal id and key; each relation
type's internal id and key; each property definition's internal id; each agent
configuration's internal id; each saved query's internal id; each search index's key; and
each entity instance's id — and, server-wide, each ontology's key and display name. A concurrent pair of writes
must produce a conflict, not a duplicate. Lookup of instances by type key must be
indexed — every listing depends on it.

**Vector index lifecycle.** The adapter owns index creation and removal, and the port
exposes exactly the hooks the lifecycle needs: ensure the saved-query index; drop every
index whose width no longer matches; and ensure all of them at once.
Indexes are per ontology like everything else: created through a bound store, they serve
that ontology alone, and registry delete removes them with the rest.

**Vector index width reconciliation.** An index fixes its vector width when it is created,
and a create-if-absent is a no-op against an index that already exists — the failure mode
this produces, and why startup reports it instead of repairing it, are in
[decisions.md](decisions.md#deployment) and
[capabilities/search.md](capabilities/search.md#vector-index-width-drift). The adapter's
obligation is threefold: before every create, read the existing index's configured width
and compare it; on the startup path — which walks every registered ontology — report a
mismatch and change nothing; on the rebuild path, drop every index whose width no longer
matches before any vector is regenerated, then — once every vector has the new width —
create every missing index at that width. The report must describe the index the way the
API does, never by its physical name.

**Building predicates from structured filters.** Filters arrive as parsed conditions, and
the adapter, dispatching on each condition's kind, must turn every condition into a
predicate the database can evaluate. The
operator vocabulary is fixed by the caller-facing surface, not by the adapter, and is
enumerated once in [interfaces.md](interfaces.md#listing-sorting-filtering); an adapter
supports all of it and invents none of it. Validation happens above the port: every filter
fault — an unknown property, an unknown operator, a value that will not coerce, a query
path or relation subject that does not resolve — is collected there into one domain
validation error, so the adapter receives only valid conditions and raises no
filter validation error of its own. Each comparison condition's value is already coerced
to the
property's declared data type; the substring operator is the exception, comparing
case-insensitively on the string form of both sides and carrying that string form as its
value. A missing property satisfies no comparison, the not-equal operator included: the
predicate must fail, not hold, where there is no value. An existence condition compares
nothing: its predicate is the presence of the property — the service stores no null, so
a stored key is a present value — or its absence. A path condition's predicate is
existential and self-contained: it holds when at
least one relation of the type — leaving the listed instance for the outgoing direction,
arriving at it for the incoming one — satisfies the comparison, or the existence test,
evaluated per condition:
on the related entity's property when the property source is the related entity, on the
relation's own property when the source is the relation, in which case the related
entity is never read. A relation existence condition is the anti-existence predicate the
runtime semantics require: it holds when at least one relation of the type leaves or
arrives at the listed instance, or — for absence — when none does, with nothing about the
relation or the related instance read or compared. Every value must reach the database
as a bound parameter. Type keys, relation type keys and property keys may be interpolated into
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
unchanged. A lock the adapter cannot have — one taken without waiting, or one waited
for past a bounded wait — is the conflict error, not the storage error.

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

# Known limitations

Parsing and validation happen above the port, so which queries are accepted, and how an
invalid one is rejected, does not depend on the adapter. Beyond acceptance, the known
limitations of the PostgreSQL adapter's observable behaviour are enumerated here. One
deviation stands with the rule it attaches to in Part 1 rather than here: the datetime
text form on the two point reads.

- **Decoding through a shared type key.** An entity type and a relation type may share a
  key; if both declare the same property key at different data types, the traversal read
  can decode the value through the wrong definition, silently. A known limitation, accepted.
- **Width drift blocks writes, not just search.** While the saved-query description index
  of a stale width stands, every saved-query write that carries a description vector is
  rejected until the widths are reconciled.
- **Aggregates versus projection on temporal properties.** `min` and `max` over a date or
  datetime property return a decoded temporal value where a plain projection of the same
  property returns its stored text — the two forms disagree about the property's type.
- **Map literals and mixed lists in query results.** Conversion recurses through lists of
  one element type only; a map literal, or a list mixing element types, comes back in the
  adapter's own shape, its temporals as the stored text. The conformance suite pins that
  shape.
- **An empty leading `OPTIONAL MATCH`.** When it matches nothing, the query returns no
  row rather than one row of nulls.
- **A float literal with a bare trailing zero.** A literal such as `1.0` cannot be
  written — it parses as a property access and is rejected — so an equality across the
  integer/float divide written as `1 = 1.0` is inexpressible. `1.5` is unaffected.

---

# Part 2 — The PostgreSQL adapter (non-normative)

> Everything below describes how the **PostgreSQL** adapter — the one `DB_BACKEND`
> selects — satisfies Part 1. It is illustration, not contract. No name, convention or structure in
> this part is part of the port, and a different adapter is free to share none of it.

## How ontologies are isolated

One PostgreSQL namespace (schema, in the engine's own vocabulary) per ontology, named
`ont_` plus the ontology key — the reason ontology keys are capped at 59 characters: the
engine truncates identifiers at 63, and the key is immutable, so a namespace never
renames. Isolation is structural: an ontology's tables and indexes live in its own
namespace, all DDL and queries run unqualified against the transaction's search
path, and no statement can name another ontology's namespace.

`public` is the server-wide home. It holds the registry table `ontology` — one row per
ontology, carrying the id, key, display name, timestamps and the namespace name — the
one-row table `storage_version`, and nothing ontology-scoped; `ont_*` namespaces hold only ontology-scoped data. The registry
table, not the engine's catalog, is the authoritative ontology list; the catalog is
consulted only to sweep orphaned namespaces.

**Boot** is one transaction under a database-wide advisory lock, so servers starting
together against one database serialize on it. It reads the storage version — storage
from before the `storage_version` table counts as version 1 — then creates the `public`
objects if absent. An empty database is recorded at the current version. Storage newer
than the code, or older than the oldest upgradable version, fails the boot before
anything is written. Older storage holds the registry table against concurrent creates,
runs each missing upgrade step inside every `ont_*` namespace — then the step's
server-wide statements, if it has any, once in `public` — and records the new version
last. The upgrade is logged, and the server never backs up storage itself. The steps and
both version constants live in the storage-version module beside the DDL; the current
storage version is 8. Before that
transaction the adapter logs the pgvector version — the installed one, or the one the
extension would install — and warns when it predates 0.7, which has no
`halfvec`: the search entry table cannot then be created, so an upgrade of an existing
namespace and every ontology creation fail.

**Registry create** is one transaction:
the registry row first — so a concurrent same-key create dies on the named constraint as
a conflict — then the fresh namespace, the nineteen tables below with the search settings
row and, when an embedding width is given, the fixed saved-query vector index inside it. **Registry delete** is one
transaction: the registry row out, the namespace dropped in one cascade. A bound store applies its
ontology's namespace to the search path per statement, inside the shared transaction
machinery.

## Logical to physical mapping

Schema objects are plain relational tables, one per object kind, joined by foreign keys —
per namespace:

| Logical | Table | Joined by |
|---|---|---|
| Lens | `lens` | referenced by its inclusions, agents, saved queries, retrievers, navigators and changesets |
| Entity type | `entity_type` | referenced by its property definitions and inclusions; its name property's key in `name_property`, a reference to `property_def` by entity type and key, checked at commit |
| Relation type | `relation_type` | endpoint entity type keys as deletion-restricted references to `entity_type`; referenced by its property definitions and inclusions; its parent end in the nullable `parent` column, `source` or `target`, with no check |
| Property definition | `property_def` | exactly one of two owner columns — entity type or relation type — enforced by a check constraint |
| Scope inclusion | `lens_includes` | its lens plus exactly one of three columns — entity type, relation type or search index; the optional property allowlist is an array column, and an absent allowlist is stored as null, never as an empty array. Search-index rows reach the runtime schema read as index keys; the type-inclusion reads skip them |
| Agent | `assistant_agent` | its lens |
| Saved query | `saved_query` | its lens, with the denormalized lens key alongside |
| Retriever | `assistant_retriever` | its lens, with delete cascade; unique per lens and key; configuration and warnings as `jsonb` |
| Navigator | `assistant_navigator` | its lens, with delete cascade; unique per lens and key; configuration as `jsonb` |

Every schema row carries a `uuid` primary key.

Deleting a schema object cascades through the foreign keys — property definitions,
inclusions, agents, saved queries, retrievers, navigators and changesets die with their
owner. What the DDL may carry is a rule in [decisions.md](decisions.md#storage); the
closed vocabularies the search-index tables check are index kind, representation and
generation state. The uniqueness constraints on type keys act per namespace, which is
exactly the per-ontology key scoping the contract requires.

The name-property reference pins an entity type's name property to one of that type's own
property definitions — the entity type id is part of the reference. It is deferred,
because a type and its name property are created in one transaction and each references
the other. Deleting the name property alone violates it at commit, which the error
translation reports as the same conflict the service raises; that the name property is a
`string` property is the service's check, not the database's.

## Naming transformations

There is no naming transformation. A type key never becomes a table, column or index
name — it is a value in a `type_key` column, so no key can collide with an adapter
object.

The one mechanical naming rule covers the dynamically created tables: a search
generation's entry table is `se_<id>`, where `<id>` is the generation's 32-hex-character
uuid, hyphens stripped, and its indexes and constraints are named after the table. The
name is derived, never stored. No fixed object starts with `se_`, so the sweep finds the
tables by name.

## How instance data is stored

Two generic tables per namespace hold all of an ontology's instance data, however many
types its schema declares: `entity` and `relation`. Each row carries its `uuid` id, its
type key, its user properties as one `jsonb` document, and its timestamps — nothing
else: an entity carries no search data, which lives in the search-index tables alone
(below). A schema change — a new type, a new property — is therefore pure data for
instance storage: no table or column is ever created per type or property. The only DDL
that follows a schema change is the entry table, with its indexes, of a search generation
it starts (below). The deliberation behind this mapping is
[adr/0015](adr/0015-generic-jsonb-instance-tables.md); the binding rule is in
[decisions.md](decisions.md#storage).

The cascade contract on entity deletion is translated into foreign keys:
relations reference their two endpoint entities with cascading deletes. Deleting an
entity removes its relations in either direction in the same statement, and a dangling
endpoint is unrepresentable. The
instance tables' type-key columns carry no foreign key to the schema tables — deleting a
type deliberately orphans its instances, matching the documented deletion behaviour.

Four B-tree indexes back the hot paths: entity rows by type key; relation rows by type
key, by source entity and by target entity. Filters, sorts and text search evaluate jsonb expressions that cast a property to
its declared data type; property keys and values are both bound parameters, never SQL
text. Property existence is jsonb key presence, the key bound. A path condition is an
existential subquery over the relation table — anchored on
the listed row's id at the near endpoint column, joined to the related row at the far
one, the relation type key bound like a property key — with the comparison, or the
presence test, evaluated on
the related row's properties; the endpoint indexes serve it. For a property of the
relation itself the subquery joins no entity row: the predicate is evaluated on the
relation row's own properties. A relation existence condition is the same subquery
without a join and without a predicate, under `EXISTS` or `NOT EXISTS`.

The hierarchy reads use no index beyond those four. The ancestor walk is one recursive
statement: each level is a `LATERAL` union of two probes, on the target entity for
`source` readings and on the source entity for `target` readings, and a path array stops
a branch at an entity already on it. The children lookup is two `EXISTS` probes on the
same columns. The parent flag's count is one statement: the relation rows of the reading as
child-to-parent edges, `two_parents` grouping them by child, `cycle` a recursive walk up
from every entity that is also a parent, with the same path-array guard. The create with a
parent relation inserts the entity, applies its plan, inserts the relation and applies its
plan, in one transaction; the relation's foreign key holds the parent.

## How anchors are stored

One table per namespace, `anchor`: the key as primary key, the entity type key, the entity
id, the boolean `staged_only` and timestamps. It carries no foreign key to `entity` and no
check, so deleting an entity leaves the row, and the record then reads as no longer
stored. Every read is the row left-joined to `entity` on id and type key. A save is one
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, read back through the same join, setting
`updated_at` on a re-point; a flag not given is coalesced to the stored one, or to false
on insert.

## How changesets are stored

Two tables per namespace. `changeset` holds one row per changeset, its `lens_id` a foreign
key to `lens` with delete cascade, its `anchor_key` plain text with no foreign key, so an
anchor delete leaves the row; `submitted_at` is null for a draft. `changeset_write` holds
one row per staged write under the primary key `(changeset_id, seq)`, its changeset a
foreign key with delete cascade; `arguments` and `before` are `jsonb`, the size `bytes` an
`integer`. Two B-tree indexes serve them: changesets by lens, and staged writes by
changeset and minted id.

Every change takes the changeset row `FOR UPDATE NOWAIT`, and states its state condition —
`submitted_at IS NULL`, or not null for unsubmit — in the same statement; touch and sweep
take it `FOR UPDATE SKIP LOCKED`. A seq is the changeset's version at the append, which
every change of the changeset raises, so a seq is never reused. The commit lock is
`pg_try_advisory_xact_lock` on a key hashed from the namespace, so it holds across server
instances and ends with the transaction; the commit first sets `lock_timeout` to five
seconds for its transaction. A lock that is not available, `55P03`, translates to the
conflict error.

## How search indices are stored

Five tables per namespace hold search indices:

| Table | Holds |
|---|---|
| `search_settings` | One row, pinned by a check on its boolean key: the keyword language set as an array, the switched-off indices as `jsonb` |
| `search_index` | One row per index: key, kind, the root entity type as a reference with delete cascade, the definition as `jsonb` |
| `search_generation` | One row per generation: index reference with delete cascade, representation, definition hash, model id and dimensions or languages, state, counters. Two partial unique indexes — one over `building` rows, one over `ready` — allow one of each per index and representation |
| `search_queue` | A generation's parts awaiting composition, keyed like an entry, with the time it was last queued, attempts, earliest retry, lease, and the last error with its time (`last_error_at`); deleted with its generation, and cleared when the generation retires or fails. B-tree indexes on the earliest retry, the entity id and the part id |
| `search_entry` | The entries, list-partitioned by generation |

An entry row carries its identity — generation, entity, part kind, group number, part id,
together the primary key — the relation type and target of a relation part, a passage's
offset and length, the text, its hash as bytes, and either an untyped `halfvec`
(semantic) or a `tsvector` (keyword). Half precision halves the heap and the vector
indexes, which a large ontology needs kept in memory for fast search. As on `saved_query`,
the vector column has no width: it lives only in the partition's index. A keyword entry's
`tsvector` is built in the insert statement — `to_tsvector` of the text in every language
of the generation's set, concatenated; languages reach SQL only from the closed list.

Each generation's entries live in a table of its own (naming, above), which joins
`search_entry` as a partition when the generation becomes active:

- **Create** inserts the `building` row and creates the standalone table in one
  transaction, holding the index row locked so generation changes of one index
  serialize; a generation still building for the same index and representation retires
  in that transaction. The table carries B-tree indexes on entity id and part id, for the
  deletes that reach it while it fills, and a CHECK matching its future partition bound,
  so the attach needs no validation scan.
- **Writes** go to the generation's table by name, attached or not. Each takes the
  generation row `FOR SHARE` and checks its state, so a state change waits for writers
  in flight and no table is touched after the change that leads to its drop. Deleting an
  entity's or relation's entries in every generation goes through the parent for attached
  partitions and to each building generation's table directly.
- **Finish** first builds the search index in a transaction of its own — HNSW over
  `embedding::halfvec(D)`, cosine, at the generation's width; or GIN over the
  `tsvector` — then, in one transaction, retires the previous `ready` generation,
  attaches the table, drops the bound CHECK and marks the generation `ready`. The
  previous generation serves until that commit.
- **Removal** of a retired or failed generation's table follows the committed state
  change and is best-effort: an attached table is detached `CONCURRENTLY` — or a pending
  detach finalized — then dropped, each statement alone and namespace-qualified, since a
  concurrent detach cannot run in a transaction. What an interruption leaves, and what a
  cascade leaves — deleting an index or its root entity type removes rows, not tables —
  the sweep collects: every `se_` table whose generation is neither building nor ready.
  Deleting an index runs it. **Retire** sets the state and deletes the queued work in one
  transaction; the table goes the same best-effort way.

The queue works in plain SQL on `search_queue`:

- **Enqueue** is `INSERT … ON CONFLICT DO UPDATE` on the item's key: a conflicting row
  gets a new `enqueued_at` from `clock_timestamp()`, zero attempts, an earliest retry of
  now and no error, and keeps its lease. `enqueued_at`, read back as text, is the claim
  token. Each part of a write plan is one `INSERT … SELECT` joined to the index's
  `building` and `ready` generations — relation parts and the fan-out also to `relation`,
  which yields the owning end. A create's backfill is one `INSERT … SELECT` over `entity`
  by type key, in the creating transaction.
- **A write plan runs on the write's transaction.** The runtime store opens one
  transaction for the instance statement and its plan — inside a changeset's commit, the
  commit's own: after the statement, and only when it touched a row, for creates and
  updates; before it for deletes, while the relations that cascade with a deleted entity
  still exist — their entries and queued items are found through them.
- **Claim** is one statement: a CTE selects the claimable rows joined to their
  generation, ordered keyword first and then by `enqueued_at`, with the limit and
  `FOR UPDATE SKIP LOCKED` on the queue rows; the `UPDATE` sets `lease_until` and returns each row's attempts
  and token. It commits on its own, so no transaction is held while the worker composes
  and calls the embedding provider.
- **Complete** deletes the claimed rows whose `enqueued_at` still equals the token and
  clears the lease of the rest; **fail** increments attempts, records the error and its
  time and sets the earliest retry on the rows whose token still matches, and clears
  every claimed row's lease.
- **Statistics** is one statement per call: counts grouped by generation, and the
  newest row per generation and distinct `last_error` — an error without a recorded
  time takes `enqueued_at` as its time — ranked by time and cut at ten.
- **Measuring** an index's content counts `entity` rows of the root type, summing a
  passage estimate from the `char_length` of the document value, and one count over
  `relation` joined to both end entities per group.
- **Ranking** runs on the ready generation's table, the generation row held `FOR SHARE`
  so the table stays while it is read. Semantic: a strict-order iterative HNSW scan over
  `embedding::halfvec(D)` by cosine distance at the generation's width, the score
  `1 − distance / 2`. Keyword: the query's lexemes per token from `ts_debug` — which
  parses like `to_tsvector` — in each language of the generation's set, quoted with a
  prefix marker, joined by `|` or `&` per language and the languages by `|`, matched
  against `tsv`. One token's lexemes in every language, joined by `|`, form one word
  query, and equal word queries count once. The score is the number of word queries `tsv`
  matches plus `ts_rank_cd / (1 + ts_rank_cd)`; ties are broken by the entry key. Filter conditions run as an `EXISTS` on the owning `entity` row, the same
  predicate fragments the instance listings use; the relation and target type lists as
  `relation_type` and `target_type` predicates that let other parts pass.
- **Wake-ups** are `pg_notify('ontoforge_search_work', <ontology key>)`, issued in every
  transaction that queued something; PostgreSQL delivers the notification only at commit.
  One channel serves the whole database. Each process `LISTEN`s on a dedicated connection
  outside the pool — a pooled connection would go back to the pool with the subscription
  on it; a lost connection is logged and ends the subscription.

## Index inventory

Beyond the uniqueness constraints and the B-tree indexes above — the instance tables' four
and the changeset tables' two — and the search-index tables' own indexes, one vector index
exists per namespace: an HNSW index, cosine, over `saved_query`'s dimensionless
`embedding` column cast to the provider's width — a fixed name, full-table, for
description search within the ontology. Registry create builds it when an embedding width
is given, and the startup ensure when a provider is configured. Lens scoping is a plain
query-time predicate, so the index needs no scoping of its own.

Its width is read back from its own indexed column type in the catalog — the `vector(D)`
of the cast expression — and that is what width reconciliation compares, namespace by
namespace across the registry. A query repeats the same cast expression, its width read
from the index, or the planner ignores the index. Builds are plain, transactional index
creation; a failed or interrupted build leaves nothing behind, so no failed-index defence
exists or is needed.

Search behaviour: the similarity returned is `1 − cosine_distance / 2` — algebraically
the pinned `(1 + cosine) / 2`, on its 0-to-1 scale, held by a fixed-vector conformance
case. Every vector query runs as a strict-order iterative scan,
so a result limit counts rows that passed the filters, delivered in exact distance
order. Saved-query discovery applies its minimum score after the limit.

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

# Implementing a new adapter

Provide, in this order:

1. **Connection lifecycle, physical isolation and physical naming.** Decide how an
   ontology's data is kept apart from its neighbours', and how a type key becomes a
   physical object, before writing a single query — every later decision depends on
   both. Choose a naming that no valid key can turn into a collision with your own
   storage objects.
2. **Error translation.** Build the single choke point through which all database access
   passes, before any operation exists to bypass it.
3. **The registry.** Create with atomic provisioning, list, read, rename, delete as one
   cascade. Nothing else works until an ontology can exist.
4. **Constraints and indexes.** Everything under the uniqueness obligation — the
   server-wide part at initialization, the per-ontology part at registry create.
5. **The schema side.** Lenses, types, properties, inclusions, full-schema retrieval,
   agents, saved queries and the navigator store. Nothing on the data side is useful
   until the schema can be read back.
6. **The data side.** Entities, relations, traversal, the hierarchy operations, the
   commit reads, the anchor store, units of work and the changeset store.
7. **Filters, sorts and text search.** The predicate builder, shared by listing and by
   filtered vector search.
8. **Search** — the search-index store with its queue, wake-ups and retrievers — and the
   saved-query vector index, including width reconciliation.
9. **Query compilation.** Last, because it needs the naming transformation from step 1 and
   nothing else.

Three traps, each of which produces a system that passes casual testing and fails later:

**Collisions derive from *your* physical naming.** Nothing above the port knows your
storage objects, so nothing there rejects a key that would collide with one. Work out
whether any valid key's transformed form could, and choose a naming where none can —
otherwise a user can create a type that overwrites your schema.

**A vector index fixes its width when it is created.** Creating-if-absent will not widen
one, and the stale index reports itself as healthy. Reconcile widths on every create path,
report on startup, and repair only when the caller explicitly asked for a rebuild.

**The error contract is not optional.** A driver exception that escapes the port puts
vendor vocabulary into a client response and breaks the guarantee the whole boundary
exists to provide. Equally, do not over-catch: a domain exception raised inside a database
scope must keep its identity, and a bug must still look like a bug.
