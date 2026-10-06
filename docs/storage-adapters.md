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
An adapter that stores search indices adds a fourth: a search-index store, bound the same
way ([below](#the-search-index-store)).

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
| Create | Given an internal id, a key, an optional display name and an optional embedding width, create the registry entry **and provision the ontology's physical home atomically** — a failed create leaves no entry and no home. When a width is given, the home carries the fixed semantic indexes at that width; when none is given, it carries no vector indexes. |
| List | Every ontology, as registry rows. |
| Read by key | One row, or an absent result. |
| Read by display name | One row, or an absent result — display names are unique server-wide, and the pre-write conflict check needs the lookup. |
| Rename | Set the display name; the key never changes. Absent result when not found. |
| Delete | Hard cascade: the ontology's physical home and its registry entry go together — schema, lenses, agents, saved queries, retrievers, instances, chunks, and every search index. False when not found. |

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

Six rules govern the boundary itself. They hold for every operation without exception.

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

**An adapter declares the type keys it reserves, as plain keys.** Two sets, one for entity
type keys and one for relation type keys. They are returned as schema-level keys, never
as physical names, so the modeling service can reject a colliding key without knowing what
it would collide with. An adapter with no collisions returns two empty sets.

**An adapter declares whether its search evaluates relation conditions** — path
conditions and relation existence conditions alike. One plain
flag on the runtime store, in the same spirit as the reserved keys: the constraint is the
adapter's, the enforcement point is shared. The runtime service reads it before any search
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
They never reach a caller — see the keys-not-identifiers rule in
[decisions.md](decisions.md).

**Own search storage is optional.** An adapter that stores no search indices keeps search
data of its own instead — per-entity vectors, document chunks and the vector indexes over
them — and the operations marked *own search storage* below serve it. Exactly such an
adapter provides them; one that stores search indices provides none, and nothing above
the port calls them on it. What that storage holds and when it changes is in
[Own search storage](#own-search-storage).

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

**Retriever configuration storage.** Lens-local list/read/upsert/delete preserve config
version and payload even when unsupported or invalid.
Owner/key uniqueness is enforced atomically. Copy creates an independent id; move
preserves id and atomically changes owner/key, never overwriting a conflict. Both compare
the source version/payload with the validated snapshot before changing storage. Lens
delete cascades to these definitions. No vector or conversation state is part of this
resource.

**Search-data maintenance.** Backing the rebuild operation: list every saved query with
enough identity to re-embed it; set the embedding on one saved query. Own search storage
adds: list every entity type with its property keys; set one entity's vector by id — a
vector that may be absent, because the rebuild runs without an embedding provider. Plus
the vector index operations under obligations, below.

**Reserved-key reporting.** Alongside the two declared sets, one operation scans stored
types and returns those whose key is now reserved, as kind-and-key pairs. Startup reports
them; nothing rewrites them.

**Document-property cleanup** (own search storage). Delete every chunk belonging to a
given entity type and document property. Invoked when the property, or its owning type, is removed.

### Data side

**Schema reading.** The runtime side reads the schema for itself rather than calling the
modeling side. The runtime store exposes three operations, each keyed by lens key within
its binding. One returns the full schema together with the lens and its inclusion rows,
one returns the lens's agent configurations, and one returns the lens's saved queries. The
caller uses the inclusion rows to compute the scoped schema. An adapter that stores
search indices adds to the first the keys of the search indices the lens includes, in key
order. The first returns nothing at all when no lens has that key, which is how an unknown lens
is detected. The runtime store also exposes the ontology key it is bound to, because the
schema cache keys its entries by ontology plus lens.

**Entity lifecycle.** Create with the type key, a caller-supplied instance id, the
validated property map and — own search storage only — an optional embedding vector; an
adapter that stores search indices never receives one. Read by type key and id; read by
id alone, when the type is not known; read a batch by ids, returned as a map keyed by id.
The by-id reads carry property definitions alongside — the adapter's guide for converting
stored values back to their port forms on the way out, mirroring the definitions every
write already carries for the conversion inward; an adapter whose storage distinguishes
those forms natively may ignore them. Update takes the properties to set and the property keys to remove as two separate inputs,
plus an optional embedding and an explicit flag saying whether the embedding is part of
this update — again because "no new vector" and "clear the vector" must be
distinguishable. Delete by type key and id, returning whether anything was deleted, and
removing the entity's own search data with it, where the adapter keeps any.

Listing is the one read with real machinery. It takes the type key, the scoped property
definitions, the parsed filter conditions, an optional text-search string with the string
property keys to match, a validated sort property and direction, and a limit and offset.
It returns the page together with the total matching count — both, from one call.

The adapter must set and maintain the system properties on every write: the instance id,
the type key, the creation timestamp on create, and the update timestamp on create and on
every update. Stored embedding vectors must never appear in a returned row.

**Write-value constraints** (own search storage). Before a write whose property values will become
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

**Document chunk management** (own search storage). Chunks are always stored, independently of embedding
availability. They carry id, entity id, type key, property key, ordinal, character offset
and length, text and an optional vector. Maintenance reads reusable vectors, deletes a
property's chunks and writes its replacement batch; ordinary results omit vectors.

**Search.** The runtime store declares whether search can rank by keyword — through its
search-index store, on an adapter that stores search indices
([below](#the-search-index-store)) — and declares path-condition support for all search
strategies. The service ranks through the search-index store where the adapter stores
search indices, and through the semantic rankings of
[own search storage](#own-search-storage) otherwise; fusion belongs above the port either
way. Neither a bound store nor a query carries a language: a keyword generation stems in
its own language set.
Semantic scores are pinned to `(1 + cosine) / 2`, higher is better; arbitrary native
scores must not be labeled semantic similarity. A keyword score is the adapter's native
ranking measurement, higher is better, its scale unpinned; the runtime passes it through
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
literal or a mixed list carries back is each adapter's own shape — recorded with the
divergences below.

## The search-index store

**An adapter declares whether it stores search indices** — one plain flag on the adapter,
in the same spirit as the declarations above; the server's feature report carries it
([interfaces.md](interfaces.md)). Only an adapter declaring support provides the store,
and asking one that declares none for it is a programming error, not a domain condition.
The runtime store of such an adapter also hands out the search-index store of its own
ontology, so a write can plan its search work without a second binding, and so does its
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
that include it already, and returns how many it was added to. Three serve one lens's
inclusions: list the keys of the indices it includes, in key order — none for an unknown
lens; include one index by key, checking no scope rule — absent when the lens or the
index does not exist, a conflict when the lens includes it already; and remove one —
absent when the lens does not include it.

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
adapter's native keyword measurement. The keyword query is built from the adapter's own
tokenizer output for the text in each language of the generation's set — the terms of
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
whose deletion removes its entries. An adapter that stores search indices applies the plan
**in the write's own transaction**: an index stands for every building or ready generation
of it, and the work is queued exactly when the write commits — only when a create or
update touched a row. A deletion removes the entity's or relation's entries and queued
work in every generation, together with those of the relations that cascade with a
deleted entity, so it is applied before the rows go. An adapter that stores no search
indices receives no plan.

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

## Own search storage

An adapter that stores no search indices keeps search data of its own, written with the
instance data, and ranks over it. It holds, per ontology:

- per entity, one vector over a composed text ([below](#what-gets-embedded)), present
  only when an embedding provider is configured;
- per document property value, its chunks — cut by the chunking rules in
  [capabilities/documents.md](capabilities/documents.md#chunking) — each with its
  ordinal, character offset and length, text and optional vector;
- with an embedding provider, the vector indexes over those vectors — at least one per
  entity type and one per document property's chunks, kept through the lifecycle hooks
  under [obligations](#obligations-beyond-storage).

No keyword representation belongs to it: keyword ranking exists only through search
indices, so such an adapter offers semantic ranking alone.

**Rankings.** Two rankings take the complete searched set in one call and return rows in
exact score order:

| Ranking | Input | Returns |
|---|---|---|
| Property semantic | searched types, query vector, limit | entities and scores |
| Document semantic | searched document properties, query vector, limit | passages and scores |

A searched type carries its key, property definitions and parsed filter conditions. A
searched document property carries its type key, property key and parsed conditions on
its parent. Filters apply within ranking, so the limit counts filtered units. The
service computes lens scope and filter narrowing once, and fuses above the port; how
ranked search composes the two is recorded with the adapters that diverge
([below](#where-the-adapters-diverge)).

### What gets embedded

An entity's vector comes from one composed text: the entity type key, then each `string`
property that has a value, written as `key=value`, in the order the schema declares them.

```
person: name=Alice Chen, role=Distributed Systems Engineer
```

- **Only `string` properties contribute.** Integers, floats, booleans, dates and datetimes
  are excluded.
- **`document` properties are excluded.** They are chunked and embedded separately, so a
  document's content never influences its own entity's vector, and a very long document
  cannot drown out the entity's short identifying fields.
- Properties with no value are skipped. An entity with no string values embeds as its type
  key alone.
- **The text is composed from the full schema, not from the lens.** Two lenses exposing
  different subsets of a type still see identical vectors.
- The composed text is capped at 30 000 characters and truncated at the cap.
- Composition is deterministic, so re-embedding an unchanged entity reproduces the same
  text.

### Keeping search data current

Document chunks are recomputed with every write that changes the value; vectors are added
when a provider is configured:

- on entity creation, always;
- on entity update, whenever the update touches any `string` property — the vector is
  recomputed from the merged post-update state, not from the submitted fragment;
- for document properties, per changed property: its chunks are discarded, the value is
  re-chunked, and the new chunks are embedded. A new chunk whose text is byte-identical to
  one of the old ones keeps that vector, and only the rest are embedded afresh — so
  editing part of a large document re-embeds only the chunks the edit touched. A vector
  of any other width is never reused: it came from a different embedding model, and no
  index of the current width could be built over it. That check is also what makes a
  rebuild after a model switch re-embed at all, since the text is unchanged there.

Chunks go with what they belong to: an emptied value leaves none, a deleted entity takes
its chunks along, and deleting a document property — or its entity type — drops every
chunk of that property with its vector index. Rewriting one document property never
disturbs another property's chunks.

Not recomputed, and all three are traps:

- **A schema change refreshes nothing.** Adding a string property to an entity type leaves
  every existing entity's vector reflecting the schema as of its last write. The property
  contributes only for entities written afterwards.
- **Deleting a string property leaves its values behind.** Deleting the definition does not
  delete stored values, and a vector does not record which property a word came from, so
  an entity keeps matching on a value the schema no longer declares — until the next
  rebuild ([decisions.md](decisions.md#interfaces)).
- **A failed embedding does not fail the write.** The entity or chunk is stored without
  a vector. The failure is logged, not returned.

All three are repaired by the rebuild.

### Rebuilding it

On such an adapter the search-data rebuild
([capabilities/search.md](capabilities/search.md#rebuild)) covers this storage too, in the
same three phases. Its first phase drops every vector index whose width no longer
matches — per type and per document property as well as the saved-query one. Before the
saved-query descriptions, it then recomposes and rewrites each entity's optional vector
and discards and re-chunks every document property value, embedding every chunk whose
stored vector is not already of the provider's width — after a model switch that is all
of them. Its last phase builds every vector index the schema calls for and does not have.
The progress records carry each entity type's key as their group, and the summary adds
per-type processed and failed counts; an entity whose embedding call fails is counted as
failed.

Without a provider the run still re-chunks every document, which needs no model, and
stores the entities without vectors. Rebuild therefore also repairs here: missing indexes,
entities and chunks that were never embedded, vectors stale with respect to a schema
change — including the values of a deleted string property — and chunking stale with
respect to changed chunk-size configuration.

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
configuration's internal id; each saved query's internal id; each search index's key; and
each entity instance's id — and, server-wide, each ontology's key and display name. A concurrent pair of writes
must produce a conflict, not a duplicate. Lookup of instances by type key must be
indexed — every listing depends on it.

**Vector index lifecycle.** The adapter owns index creation and removal, and the port
exposes exactly the hooks the lifecycle needs: ensure the saved-query index; drop every
index whose width no longer matches; and ensure all of them at once. Own search storage
adds the hooks of the schema lifecycle: create the index for an entity type at a given
width, optionally naming the properties to be filterable inside it; drop it; rebuild it
against the type's current properties; create and drop the index for a document
property's chunks. Those are called at the points where the schema changes shape —
adding a type, deleting a type, adding or removing a property, adding or removing a
document property — and are no-ops when no embedding provider is configured.
Indexes are per ontology like everything else: created through a bound store, they serve
that ontology alone, and registry delete removes them with the rest.

**Vector index width reconciliation.** An index fixes its vector width when it is created,
and a create-if-absent is a no-op against an index that already exists — the failure mode
this produces, and why startup reports it instead of repairing it, are in
[decisions.md](decisions.md#behaviour) and
[capabilities/search.md](capabilities/search.md#vector-index-width-drift). The adapter's
obligation is threefold: before every create, read the existing index's configured width
and compare it; on the startup path — which walks every registered ontology — report a
mismatch and change nothing; on the rebuild path, drop every index whose width no longer
matches before any vector is regenerated, then — once every vector has the new width —
create every missing index at that width. The report must describe the index the way the
API does — by entity type, by document property, or by search scope — and never by its
physical name.

**Building predicates from structured filters.** Filters arrive as parsed conditions, and
the adapter, dispatching on each condition's kind, must turn every condition into a
predicate the database can evaluate. The
operator vocabulary is fixed by the caller-facing surface, not by the adapter, and is
enumerated once in [interfaces.md](interfaces.md#listing-sorting-filtering); an adapter
supports all of it and invents none of it. Validation happens above the port: every filter
fault — an unknown property, an unknown operator, a value that will not coerce, a query
path or relation subject that does not resolve — is collected there into one domain
validation error,
identically on every backend, so the adapter receives only valid conditions and raises no
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
relation or the related instance read or compared. One fault remains the adapter's to raise, as a
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
  can decode the value through the wrong definition, silently. A known limitation, accepted.
- **Substring matching against non-string values.** The substring filter compares text
  forms. PostgreSQL renders them as the documented behaviour states — numbers as
  printed, booleans as `true`/`false`, datetimes as their ISO-8601 string — while
  Neo4j's temporal and float rendering is its own, so a substring match against a
  non-string value can differ between the adapters.
- **String sort order.** PostgreSQL sorts strings by the database's default collation,
  dictionary-style, as the documented behaviour states; Neo4j sorts by Unicode code
  points, capitals before lowercase.
- **Keyword ranking on Neo4j.** The adapter declares no keyword support, so it offers
  only semantic search with a provider and no ranked search without one; without a
  provider it stores chunks without vectors.
- **Search indices on Neo4j.** The adapter declares no support: it provides no
  search-index store and no wake-ups, its writes carry no search work, and no worker
  runs. It keeps [own search storage](#own-search-storage) instead, embedding and
  chunking inside each write, and ranked search there ranks it through its two semantic
  rankings — the only ones it offers — with these differences from the search over index entries the
  search capability describes: a hit carries no `matched`; a lens's index inclusions
  play no part; property search ranks one composed text per entity across all searched
  types in one ranking; document search ranks passages, its budget doubling until the
  ranking is exhausted, and collapses them to entities, each document property keeping
  its best passage; and when both kinds run their rankings are summed by reciprocal rank,
  or, over more than one searched type, combined by the best reciprocal kind rank
  ([decisions.md](decisions.md#interfaces)). A floor drops semantic candidates — entities
  or passages — before fusion.
- **Path and relation existence conditions on search.** PostgreSQL declares support and
  evaluates them in both rankings; Neo4j declares none, so a query path or a relation
  existence test on search is rejected above the port with a validation error naming the
  entity list — where both work on both adapters.
- **Filtered passage pages.** PostgreSQL applies filter conditions inside the ranking of
  passage entries, on the owning entity under the iterative scan, so a page holds the
  requested number of matching passages; Neo4j applies them after its index lookup, so a
  filtered passage page may come back short.
- **Width drift blocks writes, not just search.** While the saved-query description index
  of a stale width stands, PostgreSQL rejects every saved-query write that carries a
  description vector until the widths are reconciled; on Neo4j the mismatched vector — of
  a saved query, an entity or a chunk — is left unindexed and the write succeeds.
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
last. The steps and both version constants live in the storage-version module beside the
DDL. Before that transaction the adapter logs the pgvector version — the installed one,
or the one the extension would install — and warns when it predates 0.7, which has no
`halfvec`: the search entry table cannot then be created, so an upgrade of an existing
namespace and every ontology creation fail.

The current storage version is 3 and the oldest upgradable one is 2: version 3 is a major
step. It adds `entity_type.name_property`, gives every existing entity type its name
property by the derivation the `5.0` transfer import uses
([capabilities/transfer.md](capabilities/transfer.md#the-format-version)) — creating a
`string` property where a type has none, with property creation order as the declaration
order — and then makes the column mandatory and adds its reference. The same step creates
the search-index tables and gives `lens_includes` its third inclusion column (both below),
writes a row for every managed index the namespace's schema implies, and includes each in
every scoped lens exposing its root type, as the search-index store's inclusion operation
does; the worker's first start then builds their generations from all existing entities.
An upgraded namespace's keyword language set is the single text-search language its
registry row carried. Last, the step drops the per-entity search storage the managed
indices replace: the `entity` table's search columns — vector, composed text, keyword
text and segments, and the generated tsvector — and the `document_chunk` table, each with
its keyword and vector indexes. Once every namespace has its set, the step's server-wide
statement drops that language column from the registry table.

**Registry create** is one transaction:
the registry row first — so a concurrent same-key create dies on the named constraint as
a conflict — then the fresh namespace, the fifteen tables below with the search settings
row and, when an embedding width is given, the fixed saved-query vector index inside it. **Registry delete** is one
transaction: the registry row out, the namespace dropped in one cascade. A bound store applies its
ontology's namespace to the search path per statement, inside the shared transaction
machinery.

## Logical to physical mapping

Schema objects are plain relational tables, one per object kind, joined by foreign keys —
per namespace:

| Logical | Table | Joined by |
|---|---|---|
| Lens | `lens` | referenced by its inclusions, agents, saved queries and retrievers |
| Entity type | `entity_type` | referenced by its property definitions and inclusions; its name property's key in `name_property`, a reference to `property_def` by entity type and key, checked at commit |
| Relation type | `relation_type` | endpoint entity type keys as deletion-restricted references to `entity_type`; referenced by its property definitions and inclusions |
| Property definition | `property_def` | exactly one of two owner columns — entity type or relation type — enforced by a check constraint |
| Scope inclusion | `lens_includes` | its lens plus exactly one of three columns — entity type, relation type or search index; the optional property allowlist is an array column, and an absent allowlist is stored as null, never as an empty array. Search-index rows reach the runtime schema read as index keys; the type-inclusion reads skip them |
| Agent configuration | `ai_agent_config` | its lens |
| Saved query | `saved_query` | its lens, with the denormalized lens key alongside |
| Retriever configuration | `retriever_config` | lens foreign key with delete cascade; unique lens/key |

Every schema row carries a `uuid` primary key.

Deleting a schema object cascades through the foreign keys — property definitions,
inclusions, agents, saved queries and retrievers die with their owner. The DDL carries
structure only, per the rule in [decisions.md](decisions.md#storage): identity, referential
integrity, exactly-one-owner and uniqueness, with no backstop for the business rules the
service validates. The search-index tables are the one exception: they check their closed
vocabularies — index kind, representation, generation state. The uniqueness constraints on type keys act per namespace, which is
exactly the per-ontology key scoping the contract requires.

The name-property reference pins an entity type's name property to one of that type's own
property definitions — the entity type id is part of the reference. It is deferred,
because a type and its name property are created in one transaction and each references
the other. Deleting the name property alone violates it at commit, which the error
translation reports as the same conflict the service raises; that the name property is a
`string` property is the service's check, not the database's.

## Naming transformations

There is no naming transformation. A type key never becomes a table, column or index
name — it is a value in a `type_key` column. Both reserved key sets are therefore empty:
no key can collide with an adapter object.

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

The silent-cascade contract on entity deletion is translated into foreign keys:
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
(semantic) or a `tsvector` (keyword). As on `saved_query`, the vector column has no
width: it lives only in the partition's index. A keyword entry's `tsvector` is built in
the insert statement — `to_tsvector` of the text in every language of the generation's
set, concatenated; languages reach SQL only from the closed list.

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
  transaction for the instance statement and its plan: after the statement, and only when
  it touched a row, for creates and updates; before it for deletes, while the relations
  that cascade with a deleted entity still exist — their entries and queued items are
  found through them.
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
  `1 − distance / 2`. Keyword: the query's lexemes from `to_tsvector` in each language of
  the generation's set, quoted with a prefix marker, joined by `|` or `&` per language and
  the languages by `|`, matched against `tsv` and ranked by `ts_rank_cd`, ties broken by
  the entry key. Filter conditions run as an `EXISTS` on the owning `entity` row, the same
  predicate fragments the instance listings use; the relation and target type lists as
  `relation_type` and `target_type` predicates that let other parts pass.
- **Wake-ups** are `pg_notify('ontoforge_search_work', <ontology key>)`, issued in every
  transaction that queued something; PostgreSQL delivers the notification only at commit.
  One channel serves the whole database. Each process `LISTEN`s on a dedicated connection
  outside the pool — a pooled connection would go back to the pool with the subscription
  on it; a lost connection is logged and ends the subscription.

## Index inventory

Beyond the uniqueness constraints and the B-tree indexes above, and the search-index
tables' own indexes, one vector index exists per namespace: an HNSW index, cosine, over
`saved_query`'s dimensionless `embedding` column cast to the provider's width — a fixed
name, full-table, for description search within the ontology. Registry create builds it
when an embedding width is given, and the startup ensure when a provider is configured.
Lens scoping is a plain query-time predicate, so the index needs no scoping of its own.

Its width is read back from its own indexed column type in the catalog — the `vector(D)`
of the cast expression — and that is what width reconciliation compares, namespace by
namespace across the registry. A query repeats the same cast expression, its width read
from the index, or the planner ignores the index. Builds are plain, transactional index
creation; a failed or interrupted build leaves nothing behind, so no failed-index defence
exists or is needed.

Search behaviour: the similarity returned is `1 − cosine_distance / 2` — algebraically
identical to the Neo4j adapter's cosine index score, the same 0-to-1 scale, pinned by a
fixed-vector conformance case. Every vector query runs as a strict-order iterative scan,
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
pre-checks the cap, creates the fixed saved-query vector index when an embedding width is
given (index DDL cannot share a transaction with data writes in this engine; a mid-way
failure leaves nothing observable through the port), then writes the registry node with a
single-statement conditional create as the in-transaction backstop. Registry delete
wipes the whole graph — schema nodes, instance nodes, chunks, and the registry node —
and drops every vector index, so no width or filter-property imprint of the deleted
schema survives; the boot-time constraints stay.

## Logical to physical mapping

Schema objects are nodes, joined by relationships:

| Logical | Node label | Joined by |
|---|---|---|
| Lens | `Ontology` — a physical name exempt from the vocabulary lock ([decisions.md](decisions.md#ontologies)) | `INCLUDES_TYPE` to a type node, carrying the optional property allowlist |
| Entity type | `EntityType` | `HAS_PROPERTY` to its property nodes; its name property's key as the node property `nameProperty` |
| Relation type | `RelationType` | `HAS_PROPERTY`, plus `RELATES_FROM` and `RELATES_TO` to its endpoint entity types |
| Property definition | `PropertyDefinition` | — |
| Agent configuration | `AiAgentConfig` | `HAS_AI_AGENT` from its lens |
| Saved query | `SavedQuery` | `HAS_SAVED_QUERY` from its lens |
| Retriever configuration | `_RetrieverConfig` | `_HAS_RETRIEVER` from its lens; ownerLensId for lens/key uniqueness |

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
`relates_to`, `has_ai_agent` and `has_saved_query`. The internal names `_RetrieverConfig`, `_HAS_RETRIEVER`, `_Entity`,
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
comparison on that node's properties — or, for a property of the relation itself, on the
relationship's properties, the related node left anonymous.

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
| Uniqueness constraint | `_RetrieverConfig` internal id; `ownerLensId` and key together | Retriever identity and lens-local key |
| Uniqueness constraint | `_Entity` instance id | Instance identity |
| Index | `_Entity` type key | Every listing filters on it |

The Neo4j adapter carries no storage version: every startup creates the objects above
if absent, and gives every entity type node without `nameProperty` its name property by
the derivation the `5.0` transfer import uses
([capabilities/transfer.md](capabilities/transfer.md#the-format-version)) — creating a
`string` property where a type has none, with property creation order as the declaration
order. That is its whole upgrade path. Nothing in the graph enforces the name property;
the service's checks are its only guard.

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

**The in-index filter sees the indexed node alone.** A vector search's WHERE can name
properties of the node being searched and nothing beyond it — no pattern, no neighbouring
node. Path conditions on semantic search are therefore declared unsupported and rejected
above the port; the entity list evaluates them as a graph traversal. A plain filter on the
passage search is applied after the index lookup, by matching the chunk's parent entity
and evaluating the conditions on it, so a filtered passage page may come back short.

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
   agents, saved queries and retrievers. Nothing on the data side is useful until the schema can be
   read back.
6. **The data side.** Entities, relations, traversal.
7. **Filters, sorts and text search.** The predicate builder, shared by listing and by
   filtered vector search.
8. **Search** — either the search-index store with its queue and wake-ups, or own search
   storage with its chunks, vectors and vector indexes — and the saved-query vector
   index, including width reconciliation.
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
