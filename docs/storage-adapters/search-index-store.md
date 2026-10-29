# The search-index store

The search-index store holds an ontology's search indices, their generations, entries and
queued work, and its retrievers. The runtime store also hands out the search-index store
of its own ontology, so a write can plan its search work without a second binding, and so does its
modeling store, so a schema change can keep the managed indices in step. Registry delete
removes everything the store holds. The pipeline that uses this store is described in
[architecture.md](../architecture.md#search-indexing).

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

**Retrievers.** [Retrievers](../capabilities/retrievers.md) search the
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
| Create | Start a building generation, holding the ontology's design exclusively, so no data write falls between the backfill and the generation taking new work. One still building for the same index and representation is superseded: it retires. Given a root entity type to backfill, queue every entity of that type — one whole-entity item each — in the same transaction and set the total to their count, so a generation never appears with a queue not yet filled. Absent result, nothing created, when the index does not exist, when the design revision is no longer the one the caller names, or — unless forced — when a building or ready generation of the index and representation already matches. |
| Read, list | One by id; all, or those of one index, oldest first. |
| Record progress | Add to the counters. |
| Finish | Make a building generation the active one in a single step: the previous active one retires. False when the generation is no longer building. |
| Fail | Mark a building generation failed. False when it is no longer building. |
| Retire | Retire a building or active generation no definition wants any more. False when it is neither, or when the design revision is no longer the one the caller names. |
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
one kind and group except a list to keep. Upsert and both deletes take an optional claim
(below): given one, they act only for the entities whose claimed items the claim still
all holds, and leave the others as they are. Delete an entity's entries, or a relation's,
in every generation of the ontology. The worker composes against the ontology's full
schema, which the store reads for it — every type and property, unscoped — with the index
definitions and the design revision of the same snapshot. The store also reads the current
design revision alone, taking no lock.

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
its attempts start afresh, and it carries a new token. A claim's lease is its fencing
token: every claim of an item writes a later lease than the one it takes over, and a claim
holds an item only while the item still carries its lease. Settling a claim — complete,
fail, release — and the entry writes made for it act only on the items it holds, and only
for entities whose claimed items it all holds; what it lost was taken over after its lease
ran out, or withdrawn by a write that deleted it, and what it would have done is dropped.
The worker's surface:

| Operation | Obligation |
|---|---|
| Queue a type | Queue every entity of a type, as one whole-entity item each, into the given generations — those neither building nor ready are skipped. Returns the count. |
| Claim | Lease up to a limit of claimable items — due, not leased or with an expired lease, attempts below the maximum, of a building or ready generation — keyword items first, then oldest first; semantic items only of generations of the given model id. Items another claim holds are skipped, never waited for. The lease commits with the claim. Each item carries its attempts, its token and its lease. |
| Complete | Remove the held items — except one queued again since its claim (its token changed): that one stays, released for the next claim, like every other held item it does not remove. A write during a lease is never lost. Returns the count removed and the count no longer held. |
| Fail | Record a failed attempt on the held items — attempts plus one, the error and its time, the lease released, the item held back by its delay. An item queued again since its claim is not charged. Returns each charged item's attempts and the count no longer held. |
| Release | Release the held items without charging them, so the next claim takes them at once. Returns the count released. |
| Statistics | Per generation with queued items: pending and failed counts, and the errors of failed or retrying items — the newest item per distinct message, newest first, at most ten, each with its entity, part kind, message and time. |

An item whose attempts reached the maximum is failed for good and never claimed again; a
new write of its entity, or a rebuild, gives it a fresh start. The delays, the maximum and
the lease length are the caller's.

**Wake-ups.** The adapter offers a subscription that calls back, with the ontology key,
whenever search work was queued in any server process on the same database — after the
queueing transaction commits, never before. A subscription may end on its own, a lost
connection for instance; it then says so and the subscriber subscribes again. Polling
above the port covers the time without one.
