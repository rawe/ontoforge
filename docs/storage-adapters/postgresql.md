# The PostgreSQL adapter (non-normative)

> Everything below describes how the **PostgreSQL** adapter — the one `DB_BACKEND`
> selects — satisfies [the contract](README.md). It is illustration, not contract. No name, convention or structure in
> this file is part of the port, and a different adapter is free to share none of it.

Business rules are validated in the service. The PostgreSQL DDL carries primary keys,
referential integrity, exactly-one-owner and uniqueness constraints, plus the search-index
tables' checks on their closed vocabularies; it does not backstop other business rules.
Keyword search uses PostgreSQL's stock text-search configurations without an added
compound or other dictionary, so a deployment needs no custom database image.

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
storage version is 12. Before that
transaction the adapter logs the pgvector version — the installed one, or the one the
extension would install — and warns when it predates 0.7, which has no
`halfvec`: the search entry table cannot then be created, so an upgrade of an existing
namespace and every ontology creation fail.

**Registry create** is one transaction:
the registry row first — so a concurrent same-key create dies on the named constraint as
a conflict — then the fresh namespace, the twenty-one tables below with the search
settings row and the design revision row and, when an embedding width is given, the fixed
saved-query vector index inside it. **Registry delete** is one
transaction: the registry row out, the namespace dropped in one cascade. A bound store applies its
ontology's namespace to the search path per statement, inside the shared transaction
machinery.

## Logical to physical mapping

Schema objects are plain relational tables, one per object kind, joined by foreign keys —
per namespace:

| Logical | Table | Joined by |
|---|---|---|
| Lens | `lens` | referenced by its inclusions, agents, saved queries, retrievers, navigators and changesets |
| Entity type | `entity_type` | referenced by its property definitions and inclusions; its name property's key in `name_property`, a reference to `property_def` by entity type and key, checked at commit; its identity property keys in order in the nullable array `identity_properties` |
| Relation type | `relation_type` | endpoint entity type keys as deletion-restricted references to `entity_type`; referenced by its property definitions and inclusions; its parent end in the nullable `parent` column, `source` or `target`, with no check; one per pair in `one_per_pair`, read as on while `parent` is set |
| Property definition | `property_def` | exactly one of two owner columns — entity type or relation type — enforced by a check constraint |
| Scope inclusion | `lens_includes` | its lens plus exactly one of three columns — entity type, relation type or search index; the optional property allowlist is an array column, and an absent allowlist is stored as null, never as an empty array. Search-index rows reach the runtime schema read as index keys; the type-inclusion reads skip them |
| Agent | `assistant_agent` | its lens |
| Saved query | `saved_query` | its lens, with the denormalized lens key alongside |
| Retriever | `assistant_retriever` | its lens, with delete cascade; unique per lens and key; configuration and warnings as `jsonb` |
| Navigator | `assistant_navigator` | its lens, with delete cascade; unique per lens and key; configuration as `jsonb` |

Every schema row carries a `uuid` primary key.

Deleting a schema object cascades through the foreign keys — property definitions,
inclusions, agents, saved queries, retrievers, navigators and changesets die with their
owner. The DDL enforces the structural constraints described at the start of this part;
it does not add another layer of business-rule validation. The
closed vocabularies the search-index tables check are index kind, representation and
generation state. The uniqueness constraints on type keys act per namespace, which is
exactly the per-ontology key scoping the contract requires.

The name-property reference pins an entity type's name property to one of that type's own
property definitions — the entity type id is part of the reference. It is deferred,
because a type and its name property are created in one transaction and each references
the other. Deleting the name property alone violates it at commit, which the error
translation reports as the same conflict the service raises; that the name property is a
`string` property is the service's check, not the database's.

## How the design is guarded

The design revision is the one row of `design_revision` in the namespace: the ontology's
id from the registry and an `integer` revision, starting at 1. The design lock is a
transaction-scoped advisory lock on a key hashed from the namespace —
`pg_advisory_xact_lock_shared` for a data write, `pg_advisory_xact_lock` for a design
change and a generation create — always the first lock its transaction takes, after
`lock_timeout` is set to five seconds for the transaction. The revision is read in a
statement of its own after the lock is granted; a design change advances it with an
`UPDATE` in the same transaction. Shared holders never wait for each other, while an
exclusive request queues new shared ones behind it, so steady writes cannot starve a
design change. A lock not granted in time, `55P03`, translates to the conflict error.

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
type key, its user properties as one `jsonb` document, its timestamps, and on `entity` the
derived `identity`, text, null for a type without one — nothing
else: an entity carries no search data, which lives in the search-index tables alone
(below). A schema change — a new type, a new property — is therefore pure data for
instance storage: no table or column is ever created per type or property. The only DDL
that follows a schema change is the entry table, with its indexes, of a search generation
it starts (below). The deliberation behind this mapping is
[adr/0015](../adr/0015-generic-jsonb-instance-tables.md).

The cascade contract on entity deletion is translated into foreign keys:
relations reference their two endpoint entities with cascading deletes. Deleting an
entity removes its relations in either direction in the same statement, and a dangling
endpoint is unrepresentable. The
instance tables' type-key columns carry no foreign key to the schema tables — deleting a
type deliberately orphans its instances, matching the documented deletion behaviour.

The identity's uniqueness is the constraint `entity_identity_unique`,
`UNIQUE (type_key, identity)`, `DEFERRABLE INITIALLY IMMEDIATE`; nulls never collide, so
types without an identity are unaffected. A design change that writes identities, and the
commit of a changeset, set it `DEFERRED` for their transaction; a check sets it `IMMEDIATE`
before it rolls back. Its violation, `23505` on that constraint, translates to the identity
conflict, the type key and identity read from the violation's detail. A violation the
deferred check finds at `COMMIT` fails the commit as a conflict.

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
same columns. The pair lock is a transaction-scoped advisory lock keyed by the namespace,
the relation type key and the two ends, and the pair read joins the pairs to `relation` by
both ends. The parent flag's count is one statement: the relation rows of the reading as
child-to-parent edges, `two_parents` grouping them by child, `cycle` a recursive walk up
from every entity that is also a parent, with the same path-array guard. The create with a
parent relation inserts the entity, applies its plan, inserts the relation and applies its
plan, in one transaction; the relation's foreign key holds the parent.

## How rulesets are stored

One table per namespace, `ruleset`: the key as primary key, the anchor's `anchor_type_key`
and `anchor_id`, both null for no anchor, timestamps, and `write_access`, text, not null,
with the default `full`. It carries no foreign key to `entity` and no check, so deleting an entity
leaves the row, and the anchor then reads as no longer stored. Every read is the row
left-joined to `entity` on the anchor's id and type key. A save is one
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, read back through the same join, setting
`updated_at` on every save; a rule the patch leaves out keeps its stored value, or takes
its default on insert.

## How changesets are stored

Three tables per namespace. `changeset` holds one row per changeset, its `lens_id` a foreign
key to `lens` with delete cascade, its `ruleset_key` plain text with no foreign key, so a
ruleset delete leaves the row; `submitted_at` is null for a draft; `number` an `integer`.
`changeset_object` holds one row per staged object under the primary key
`(changeset_id, object_id)`, its changeset a foreign key with delete cascade; `kind`,
`type_key` and `action` are text, `from_id` and `to_id` a relation's ends, null for an
entity, and `first_touched_at` the clock at its insert, so the objects one change adds
keep their order. `changeset_value` holds one row per staged value under the primary key
`(changeset_id, object_id, property_key)`, its object a foreign key with delete cascade;
`value` is `jsonb`, JSON null removing the property; `before` is `jsonb`, `{"value": …}`
for a stored value, `{}` for a key the target lacked and SQL null for a value of a
create; the size `bytes` an `integer`. Three B-tree indexes serve them besides the primary
keys: changesets by lens, staged objects by changeset and first touch, and staged values by
changeset, property key and the `md5` of the value's text, so that a long document value
fits. The staged entities that stage given values are found through that last index, one
equality per key, so a put costs the same in an empty changeset as in a full one. The
staged relations at an entity are found by a scan of the changeset's own objects, and its
staged relations of given pairs by a scan of its own objects, matched in the database, so
only the matches are read out.

Every change takes the changeset row `FOR UPDATE NOWAIT`, and states its state condition —
`submitted_at IS NULL`, or not null for unsubmit — in the same statement, an applied
change and a submit with the version the service read; touch and sweep
take it `FOR UPDATE SKIP LOCKED`. A start takes `pg_advisory_xact_lock` on a key hashed
from its lens before it reads the highest number. The commit lock is
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
  transaction, which first holds the design exclusively and checks the revision, then
  holds the index row locked so generation changes of one index serialize; a generation
  still building for the same index and representation retires in that transaction. The table carries B-tree indexes on entity id and part id, for the
  deletes that reach it while it fills, and a CHECK matching its future partition bound,
  so the attach needs no validation scan.
- **Writes** go to the generation's table by name, attached or not. Each takes the
  generation row `FOR SHARE` and checks its state, so a state change waits for writers
  in flight and no table is touched after the change that leads to its drop. Deleting an
  entity's or relation's entries in every generation goes through the parent for attached
  partitions and to each building generation's table directly.
- **Finish** first builds the search index in a transaction of its own, under a
  transaction-scoped advisory try-lock keyed by the generation — a process that finds it
  taken skips the build, and a later pass finds it done — HNSW over
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
  Deleting an index runs it, after its design change commits. **Retire** holds the design
  shared, checks the revision, sets the state and deletes the queued work in one
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
  `FOR UPDATE SKIP LOCKED` on the queue rows; the `UPDATE` sets `lease_until` to now plus
  the lease length and returns each row's attempts, token and `lease_until` as text — the
  lease. It commits on its own, so no transaction is held while the worker composes
  and calls the embedding provider. A claim takes a row only once its lease has passed,
  so the new lease is always the later one.
- **Holding a claim.** Entry writes, complete, fail and release first lock, `FOR UPDATE`,
  the claimed rows whose `lease_until` still equals the claim's lease, for the rest of
  their transaction: a takeover skips the locked rows, and a write that deletes or queues
  one again waits for it.
- **Complete** deletes the held rows whose `enqueued_at` still equals the token and
  clears the lease of the other held rows; **fail** increments attempts, records the error
  and its time and sets the earliest retry on the held rows whose token still matches, and
  clears the lease of every held row; **release** clears it alone. Rows no longer held are
  left untouched.
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
  on it; a lost connection is logged and ends the subscription. That connection may go to
  an address of its own, since a transaction-mode pooler in front of the pool cannot hold
  a subscription.

## Index inventory

Beyond the uniqueness constraints and the B-tree indexes above — the instance tables' four
and the changeset tables' three — and the search-index tables' own indexes, one vector index
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
