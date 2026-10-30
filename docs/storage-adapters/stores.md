# The two store surfaces

Two stores, matching the modeling/runtime split, each bound to one ontology. Neither
knows about the other. Operations are grouped by capability below; each group states the
shape of the data and the rules the adapter must honour, not per-operation signatures.
"Unique" in this section always means unique within the bound ontology.

Internal identifiers appear in this section because they are the store's own currency.
Runtime and MCP address schema and design objects by key; modeling REST may use internal
identifiers ([interface addressing](../interfaces/README.md#what-a-path-segment-identifies)).

## Schema side

**Lens management.** Create with a caller-supplied internal id, key, name and optional
description. List all. Read by internal id, by key, and by name — the last two exist
separately because both are unique and both are used to detect a conflict before a write.
Update name and description. Delete.

**Type management.** Entity types: create with id, key, display name, description; list;
read by id; read by key; update display name and description; delete. Relation types: the
same, plus the source and target entity type keys supplied at creation and never
updatable, and the relation rules — an optional parent end, source or target, and one per
pair — written by the rules write below; all four are returned on every read, one per pair
read as on whenever a parent end is set. One extra predicate is required on the entity type
side: whether any relation type currently names a given entity type as an endpoint. It
backs the rule that an entity type in use cannot be deleted.

**The identity.** An entity type carries its [identity](../capabilities/entity-identity.md)
properties, an ordered key list or none, written by a write of its own after the service
checked it. Two operations serve it: read every stored entity of a type key, by id, with
the stored values of given property keys; and write the derived identity of listed
entities, or clear it on every entity of the type key. The identity's uniqueness is
checked when the design change ends, so a write may pass through a duplicate, as when two
entities swap identities. Deleting an entity type clears its orphaned entities' identities.

**The relation rules.** A relation type's rules are written on create and by its own rules
write, which takes the whole new rule set: the parent end and one per pair. Both check the
rules they set or turn on
([capabilities/schema-modeling.md](../capabilities/schema-modeling.md#relation-rules))
against the stored relations, in one transaction, before they write. A parent end set or
flipped is checked under a reading of every stored parent relation — relation type key to
parent end — with the written key's new end in place of its stored one. Under it they
count the entities that are the child end of more than one stored relation, and the
entities on a cycle, a self-loop included. One per pair turned on counts the pairs, source
to target, that more than one stored relation of the key links. When a count is not zero
they return each broken rule with its count and its first five entities, ordered by type
and id — a pair by its source — and write nothing. Clearing counts nothing and is never
refused. The counts must end on any stored data, cycles included, and take no lock. A
read-only variant counts the same for a given set of readings, each a key's rules, and
writes nothing; import's validation runs it before any write.

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

**Named-search storage.** A named search belongs to a lens and is addressed by key within
it: list for a lens, upsert — reporting whether it created or updated — and delete. It
carries name, description and its tree as JSON the store does not interpret.

**Design changes.** The modeling store runs a unit of work as one design change: one
transaction that holds the ontology's design exclusively — data writes and other design
changes wait for it — and advances the ontology's [design revision](contract.md#the-design-revision),
committing when the work returns and rolling back, the revision included, when it throws.
Every operation of the store handed to the work, and of the search-index and navigator
stores it hands out, runs on that transaction; the generation lifecycle, which needs
connections of its own, fails there as a programming error. Work started on a store
already inside a design change runs within it.

**Search-data maintenance.** Backing the rebuild operation: list every saved query with
enough identity to re-embed it; set the embedding on one saved query. Plus the vector
index operations under obligations, below.

## Data side

**Schema reading.** The runtime side reads the schema for itself rather than calling the
modeling side. The runtime store exposes four operations, each keyed by lens key within
its binding. One returns the full schema together with the lens and its inclusion rows,
one returns the lens's agent configurations, one returns the lens's saved queries, and one
returns the lens's named searches — key, name, description and the tree as stored — in key
order. The caller uses the inclusion rows to compute the scoped schema. The first also carries the
keys of the search indices the lens includes, in key order, and the design revision of the
same snapshot. The first returns nothing at all when no lens has that key, which is how an unknown lens
is detected. The runtime store also exposes the ontology key it is bound to, because the
schema cache keys its entries by ontology plus lens, and reads the current design revision
alone, taking no lock.

**Entity lifecycle.** Create with the type key, a caller-supplied instance id and the
validated property map. Read by type key and id; read by
id alone, when the type is not known; read a batch by ids, returned as a map keyed by id.
The by-id reads carry property definitions alongside — the adapter's guide for converting
stored values back to their port forms on the way out, mirroring the definitions every
write already carries for the conversion inward; an adapter whose storage distinguishes
those forms natively may ignore them. Update takes the properties to set and the property
keys to remove as two separate inputs. Delete by type key and id, returning whether
anything was deleted.

Create and update also take an entity's identity, built by the service — never by the
store. Rows carry it as `_identity` when the entity has one. The store enforces its
uniqueness within the type key: a write that would duplicate one, a concurrent one
included, raises the identity conflict, naming the type key and the identity, and writes
nothing. Two reads serve it: the entity of a type key with exactly a given identity, and
the ids and identities of a type key's entities holding any of given identities. Within a
transaction the identity check may be deferred to its end, and made immediate again;
the commit of a changeset defers it, so its phases may pass through a duplicate, and a
check makes it immediate before it rolls back.

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
endpoint ids alongside its properties; endpoints are never updatable. Two operations serve
one per pair: the stored relations of a type that link one of a set of pairs, source to
target, as id and ends; and, inside a transaction, a lock on each of a set of pairs of a
type until the transaction ends, taken in one fixed order before it answers the stored
relations of the type linking them. The lock is what makes two concurrent creates of a
pair, on any servers, take turns.

**Batch writes.** Inside a transaction, six operations write many instances of one kind at
once, as the commit of a changeset applies its phases: entity creates, entity updates,
entity deletes, relation creates, relation updates and relation deletes. Each row is what
the single write takes, its own search write plan included, and the batch behaves as those
writes one after the other would: the system properties set, the identity written when
given, each plan queued exactly when its row is written, a delete's before it. Every batch
but the entity create answers the ids it wrote; a row whose target is gone, or a relation
create whose source or target entity does not exist, is left out rather than failing the
batch. An adapter may write a batch in one statement or in many; the commit's speed comes
from the former.

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

**Commit reads.** Six reads serve a changeset's checks and its commit validation, and
none evaluates a rule. Two take readings as the hierarchy reads do: the parent links whose
child end is one of a set of ids, and those whose parent end is — the latter optionally
locking those entities and the links it finds until the transaction ends, so no child can
attach meanwhile. The third locks the entities and relations of a set of ids until the
transaction ends and returns their stored properties as stored; the fourth returns the
entities of a set of ids as the batch read by ids does without property definitions; the
fifth the relations of a set of ids, of any type, as the read by type and id does. The
third and fourth take the document property keys of each entity type and return a
document value as its fingerprint, never its text: the hex SHA-256 of its UTF-8 bytes
and its length in characters. The sixth returns the type key of each entity of a set of
ids and reads none of its properties. An unknown id is left out; an id that cannot be an
instance id matches nothing.

**Traversal.** Given an entity id, a direction of incoming, outgoing or both, an optional
relation type key filter, a limit, and property definitions keyed by type key — the same
row-conversion guide the by-id reads carry, covering whatever types the neighbourhood may
touch — return the adjacent relations paired with the entities at the far end. Each result is marked with the direction it was traversed. For
the combined direction the limit is a single budget: outgoing edges are taken first and
incoming edges receive only what remains, so the two are not independently limited. What
that costs a caller is in
[capabilities/instance-data.md](../capabilities/instance-data.md#traversal).

**Search.** The runtime store declares whether search can rank by keyword — through its
search-index store ([below](search-index-store.md#the-search-index-store)) — and declares path-condition
support for every search method. The service ranks through the search-index store;
fusion belongs above the port. Neither a bound store nor a query carries a language: a keyword generation stems in
its own language set.
Semantic scores are pinned to `(1 + cosine) / 2`, higher is better; arbitrary native
scores must not be labeled semantic similarity. A keyword score is the number of distinct
query words the entry contains plus, as a fraction below one, the adapter's native
ranking measurement, higher is better
([capabilities/search.md](../capabilities/search.md#ranking)). A keyword-ranked entry
establishes a positive match, while non-membership in a limited ranking establishes no
negative evidence.

Saved-query discovery is a separate vector ranking over descriptions, scoped to one
lens, with its own absolute score, limit and optional minimum score.

Literal text matching is not a separate operation — it is the search string on the listing
operations, matched case-insensitively as a substring against the named string properties,
any one of which matching admits the row. See
[capabilities/search.md](../capabilities/search.md).

**Validated-query execution.** Take a validated query object and an optional parameter
map, compile, execute read-only, and return the ordered column names together with the
rows. Each row maps column name to a converted value. Nodes and relationships become plain
property maps; temporals are converted; vectors are stripped; conversion recurses through
lists of one element type, and nothing driver-shaped survives at any depth. What a map
literal or a mixed list carries back is the adapter's own shape — recorded with the
known limitations below.
