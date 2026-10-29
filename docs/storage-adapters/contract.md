# The contract (normative)

## Bound stores and the registry

The port has four surfaces: a modeling store, a runtime store
([the two store surfaces](stores.md)) and a search-index store
([its contract](search-index-store.md)), each obtained **bound to one ontology**, and an
**ontology registry** that manages ontologies as whole units.

**Stores are bound.** A store is requested for an ontology key and every operation on it
resolves within that binding. The binding check happens above the adapter — the port
accessors verify the key against the registry and fail with not found before the adapter
is asked for a store — so an adapter may hand out bound stores without checking. All
store operations in this contract are written as if the ontology were the whole world, because
through a bound store it is.

**Isolation is total.** An operation on a store bound to one ontology must never
observe, return, or affect another ontology's data — schema, instances, vectors, or
search indexes. "One request, one ontology" is structural above the adapter and
physical inside it: *how* the data of two ontologies is kept apart is each adapter's
private business, described only in its own non-normative file, and nothing above the
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
| Delete | Hard cascade: the ontology's physical home and its registry entry go together — schema, lenses, agents, saved queries, retrievers, navigators, instances, rulesets, changesets, and every search index. False when not found. |

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
only valid, fully resolved conditions and never a key to interpret. This keeps fault
reporting independent of storage and makes the lens the complete horizon for resolving
the path. A sort is a property
key plus a direction; a text search is
a string plus the list of property keys to match it against. No fragment of any query
language enters or leaves the port. The one exception is the validated query object,
described below, which is opaque rather than textual.

**Driver exceptions never escape.** Every failure the adapter cannot express as a domain
condition surfaces as the single storage error, carrying a generated id and no storage
detail. The adapter logs the original — vendor name, driver code, message, stack —
against that id. Expected conditions are not exceptions: a missing row is an empty result
or an absent value, and a failed delete is a false return. See the shared error contract
in [interfaces/](../interfaces/README.md#errors).

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
| Initialize | Open connections, verify the database is reachable, create every **server-wide** constraint and index the adapter needs, bring storage of an older storage version up to date, and hand out the registry and the bound-store factories. Per-ontology storage is provisioned by registry create; at initialization only an upgrade reaches into it. Failure prevents the server from serving. |
| Close | Release connections. Idempotent. |
| Ensure semantic indexes | Given a vector width, create every vector index the current schemas imply, for **every ontology the registry lists** — doing nothing when there are none. Called at startup only when an embedding provider is configured. |

Storage carries its own version; the server upgrades older storage at startup before it
serves, rather than requiring an operator to run migrations. The release defines the
storage layout, and only a storage-version upgrade changes it, except for vector indexes
recreated by a rebuild and the entry storage of search-index generations, which have their
own lifecycles. A release that raises the storage version starts only after all older
servers have stopped. The upgrade may cause downtime rather than requiring two releases
to work against the same storage. Within a major release line, upgrade steps only add; renaming,
removing or rewriting stored data waits for a major release, which keeps none of the
earlier steps. Additive steps also let an older server left running by mistake keep
working within that major line.

## The ruleset store

The ruleset store holds an ontology's [rulesets](../capabilities/rulesets.md): per key, the
value of each rule — the anchor's entity, its type key and id, or none, and the write
access — and timestamps. List, ordered by key; read by key, absent when unknown; save, an
upsert that creates the ruleset or changes it and returns the record as written, writing
each rule the patch names and keeping the others, a new ruleset with no anchor and write
access `full`; delete, false when the key is absent. Every record read also says whether
the anchor's entity is still stored under that type key. The store checks no value on
save and never decides a state — the service does — so a deleted entity leaves the
anchors that name it in place. The runtime store hands out the ruleset store of its own
ontology. Rulesets are not part of any export read, and registry delete removes them.

## The design revision

Each ontology's [design revision](../architecture.md#design-revision) is created with the
ontology. Its identity is never reused: an ontology deleted and created again under its
key starts its number again under a new identity, so only the pair tells two designs
apart.

## Transactions

The runtime store runs a unit of work on a store bound to one transaction, on one
connection, with read-committed isolation: it commits when the work returns and rolls back
when it throws. The transaction first holds the ontology's design shared — design changes
wait for it, other data writes do not — and fails with a conflict unless the design
revision is still the one the caller names, so nothing commits against a design that
changed. Every operation of that store, and of the ruleset and changeset stores it hands
out, runs on that connection; this and a design change are the exceptions to every
operation owning its connection. Anything that would take a second connection inside the
work — a nested unit of work, the full-schema retrieval, the search-index or navigator
store — fails as a programming error, so the work can never wait for a connection it holds
itself. Every data write uses it, a changeset's commit included.

## The changeset store

The changeset store holds an ontology's [changesets](../capabilities/changesets.md): per
changeset its id, its lens, its number, the ruleset key of the URL that started it or none, a version, a
note, the time it was submitted or none, and timestamps; per staged object its id, kind,
type key, action, a relation's two ends, and the
time it was first touched; per staged
value its property key, the value, the recorded before or none, and its size in bytes,
all kept as given. The store evaluates no rule — the service does — except the state and
version a change needs, which it judges in the statement that writes, so a submit racing
a change is never overwritten.

- **Reads.** Start, with the number one above the highest of its lens, or 1, never shared
  by two concurrent starts; read one through its binding — a changeset of another lens, or bound
  to another ruleset, is absent, and no ruleset key reaches every changeset of the lens;
  list them bound the same way, by number, lowest first, with
  their counts per action and kind and the type keys they name; their staged objects
  with their values by first touch, paged; the staged objects of given ids; the staged
  relations with an end at a given entity; its staged entity creates and updates of a type
  key that stage a value under at least one of given keys and, under each of them they
  stage, exactly the given value, with their values; its staged entity objects of a type
  key with their values under given keys only; its staged relation objects of a type key
  whose ends, source to target, are one of given pairs, without values; the summed size of
  its staged values.
- **Changes.** Apply one change to a draft changeset at the version the service read, all
  or none: remove objects with their values, remove values, add objects or change their
  action, and write values whole; submit, a compare-and-set on the version of a draft
  changeset, setting the submitted time and the note; unsubmit a submitted one, with a
  note; discard a draft one with its staged objects. Each takes the changeset without
  waiting — one held elsewhere is a conflict at once — raises its version and refreshes
  its last change, and answers absent when the changeset is gone, in the other state, or
  at another version.
- **Upkeep.** Touch refreshes the last change alone; sweep deletes the draft changesets
  unchanged for a given duration, measured by the database's clock that stamps the last
  change. Both skip a changeset held elsewhere rather than wait or fail.
- **The commit**, inside a unit of work only: take the ontology's commit lock without
  waiting, then the changeset without waiting — either held elsewhere is a conflict — and
  from then on wait at most five seconds for a row another transaction holds, then fail
  as a conflict; finally delete the changeset with its staged objects.

Deleting a lens deletes its changesets, deleting a ruleset leaves them, and registry
delete removes them. Changesets are not part of any export read.

## The navigator store

The navigator store holds an ontology's [navigators](../capabilities/navigators.md): per lens
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
each entity instance's id; each entity's identity within its type key — and, server-wide, each ontology's key and display name. A concurrent pair of writes
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
[capabilities/search.md](../capabilities/search.md#vector-index-width-drift). The adapter's
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
enumerated once in [interfaces/](../interfaces/README.md#listing-sorting-filtering); an adapter
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
unchanged. A violated identity uniqueness is the identity conflict, not the storage error
([entity identity](../capabilities/entity-identity.md#in-a-changeset)). Concurrent writes can
take an identity between the service's pre-check and the write; the database's final
uniqueness check must tell the caller that the identity is taken, not that storage failed.
Expected violations of other named constraints guarded by a service pre-check also
translate to that check's domain error when a race defeats it; unanticipated constraint
violations remain storage errors. A lock the adapter cannot have — one taken without waiting, or one waited
for past a bounded wait — is the conflict error, not the storage error.

## The validated query

Exactly one non-primitive object crosses the port: the result of parsing and validating an
OQL query. It is opaque to services and meaningful only to the adapter, which compiles it.
Parsing and validating are storage-independent and happen above the port; compiling is the
adapter's private business. See [capabilities/oql.md](../capabilities/oql.md).

The adapter **may** assume, without re-checking:

- The query parses.
- Every entity type key, relation type key and property key in it exists and is visible
  through the requesting lens.
- No write clause and no procedure call is present.
- No node pattern that introduces a variable is unlabelled, and no internal label or
  internal relationship type appears.
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
database exactly what the validated query asks — only the names are translated. A node
pattern without a label and a relationship pattern without a type match only the types of
their kind that the scoped schema shows, never one the lens hides.
Results come back in schema vocabulary, so no reverse translation of names is required —
the compiled query returns whatever the caller asked for, converted per the value rules
above.
