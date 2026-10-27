# Architecture

How OntoForge is put together. Concepts and vocabulary: [README.md](README.md). The rules
this document obeys: [decisions.md](decisions.md).

This document explains the system's components, boundaries, invariants and major flows.
Feature behaviour and interface details are described in the linked capability and
interface documents; physical ontology storage is described in the adapter documentation.

## Components

Four parts, two processes; with [authentication](#authentication-and-authorization) on,
two more.

**Server** — one deployable unit. Serves the ontology registry, the modeling API, the
runtime API, both MCP servers and the OpenAPI description. There is no mode switch and no
partial deployment: every instance serves everything, and any number of instances share one
database and one [shared state](#shared-state) — and, with authentication on, one access
database and one identity provider.

**Web client** — a separate static application talking to the server over REST only. It
holds no privileged path; anything it does can be done over the API. With authentication
on, it is served from the deployment's public address, which proxies the API to the
server, so the browser's session cookie reaches the server.

**Database** — one instance, holding every ontology's schema and instance data together.
Reached only through the persistence port.

**Storage adapter** — the single active implementation of that port. See
[storage-adapters.md](storage-adapters.md).

**Access database** — with authentication on, a PostgreSQL database of its own beside the
ontology database: principals, their identities, role assignments and the audit of every
change to them. Reached through the access store, a port of its own, never through the
persistence port; it carries its own storage version. Locally it is a second database in
the same PostgreSQL.

**Identity provider** — with authentication on, an external OpenID provider where people
and services sign in; Keycloak in development. It says who a caller is, never what it may
do.

```
   web client ────┐
   REST clients ──┤
   MCP clients ───┤
                  ▼
        ┌───────────────────────────────────────┐
        │  server                               │
        │                                       │
        │   REST routers      MCP servers       │
        │        └──────┬──────────┘            │
        │          service layer                │
        │   registry │ modeling │ runtime       │
        │               ▼                       │
        │        persistence port               │
        └───────────────┬───────────────────────┘
                        ▼
                  storage adapter
                        ▼
                    database
```

## Layers

Four layers, each with one job. Requests only ever move downward.

| Layer | Responsibility | Must not |
|---|---|---|
| Interface | Parse and shape requests; map errors to responses | Contain domain rules |
| Service | Enforce every domain rule and invariant | Know the storage technology |
| Port | Define the storage contract | Contain logic |
| Adapter | Speak one database | Be referenced from above the port |

The rule that matters most: **domain rules live in the service layer only.** REST and MCP
are two entrances to the same services, so a rule enforced in a router would apply to one
entrance and not the other. This is why MCP calls services directly rather than calling
REST — a second path would be a second contract.

## Bounded contexts

Five modules, with a deliberately acyclic dependency graph:

```
   registry ─┐
   server   ─┼─┬──▶ runtime ──▶ core
   modeling ─┘ │                  ▲
               └──────────────────┘
```

**Registry** manages ontologies as whole units: create, list, read, rename, delete. It
never looks inside one.

**Modeling** owns one ontology's schema: types, properties, lens definitions, search-index
definitions and settings, cascade rules, schema validation, transfer, search-data rebuild.

**Runtime** owns one ontology's instance data: entity and relation lifecycle, traversal,
documents, search, search indexing, query execution, saved-query pipelines, the
[assistants](#assistant-kinds) — agents, retrievers and navigators — and the
[thread store](#thread-store) holding their conversations.

**Server** carries the deployment's capability report — which optional providers this
deployment has. It belongs to neither modeling nor runtime and is the only surface that
is not ontology-scoped.

**Core** owns what the others need and none should define twice: the persistence port,
the exception taxonomy, the data-type and keyword language enumerations, embedding and
decision-model provider abstractions, OQL parsing and validation, and the storage-free
parts of search indexing — entry composition and the map of which writes affect which
entries.

Two more modules sit at the interface layer, beside these contexts: **auth** identifies the
caller — browser sign-in, sessions, access tokens — and **access** holds the authorization
service, the route table and user management. The routers of the contexts ask access what
a caller may see, and access reads runtime's operation table to tell reads from writes.

**Runtime never depends on modeling.** Everything runtime needs about the schema, it
reads through the port. This keeps the schema a *value* to runtime rather than a service
it calls, which is what makes the schema cache possible. Runtime uses core alone. The
other three may use runtime as well as core: modeling where it needs runtime's own view —
assembling a lens's schema, deriving the managed search indices of a changed schema, and
validating agent configurations, retrievers and navigators against what runtime offers;
server to report which search strategies the deployment offers.

## Ontology isolation

One server holds many ontologies, and isolation is total: no relation, query, lens or
agent ever spans two. The architecture makes that structural rather than checked:

- **Every ontology-scoped request names its ontology in the path**, and either addresses
  that ontology's schema (modeling) or its instance data through one lens (runtime) —
  never both. Three requests cross that line by a fixed amount, each named by its own
  address: a relation rules change, a modeling request, reads the stored relations to
  refuse and never writes them ([capabilities/schema-modeling.md](capabilities/schema-modeling.md#relation-rules));
  a lens delete, a modeling request, deletes the lens's changesets
  ([capabilities/changesets.md](capabilities/changesets.md#binding)); and ruleset
  maintenance is runtime state addressed without a lens, whose put reads whether the
  anchor's entity exists ([capabilities/rulesets.md](capabilities/rulesets.md#maintenance)).
  A ruleset mount adds a ruleset to a lens's address and narrows what it may do, never its
  reach. There is no other addressing channel: no header, no default, no fallback.
- **Every persistence operation runs through a store bound to exactly one ontology.**
  The service layer obtains a modeling or runtime store *for* an ontology key; every
  method of that store resolves within the binding, and binding an unknown key fails as
  not found before any other rule runs. Registry operations live on a separate registry
  port beside the bound stores, and the search indices sit in a third store, bound the
  same way.
- **The physical isolation mechanism is the adapter's private business.** Nothing above
  the port knows how an ontology's data is kept apart from its neighbours'; the contract
  and the adapter's mechanism are in [storage-adapters.md](storage-adapters.md).

The registry — not any storage catalog — is the authoritative list of ontologies. Zero
ontologies is a valid server state: a fresh server starts empty, nothing is auto-created
at boot, and the last ontology is deletable. Deleting an ontology is one hard cascade
over everything it contains — schema, lenses, saved queries, assistants,
instance data, rulesets, changesets and search indices.

## Logical data model

Physical representation is the adapter's business; this is the logical shape.

### Server level

| Kind | Identifier | Notable fields |
|---|---|---|
| Ontology | id, `key` unique server-wide | display name (optional, unique server-wide), timestamps |

The key is immutable; rename changes the display name only. Everything below belongs to
exactly one ontology.

### Schema level

Per ontology. "Unique" here always means unique within the owning ontology.

| Kind | Identifier | Notable fields |
|---|---|---|
| Lens | id, unique `key`, unique name | name, description, timestamps |
| Entity type | id, unique `key` | display name, description, name property, identity properties (optional), timestamps |
| Relation type | id, unique `key` | display name, source and target entity type keys, relation rules: parent end (optional), one per pair |
| Property definition | id, `key` unique within its owner | data type, required, default; owned by exactly one entity type or relation type |
| Search index | id, unique `key` | kind (default, passage or custom), root entity type, definition, timestamps |
| Search settings | one per ontology | keyword language set, managed indices switched off |
| Inclusion | lens + type, or lens + search index | a type inclusion's optional property allowlist; absent means all properties |
| Agent config | lens + `key` | name, description, system prompt, tool allowlist |
| Saved query | lens + `key` | name, description, ordered steps, parameters, bindings |
| Retriever | lens + `key` | name, description, configuration version, configuration, conversion warnings |
| Navigator | lens + `key` | name, description, configuration version, configuration |

Inclusions, agent configs, saved queries, retrievers and navigators are the five things
that belong *to a lens*. Types, properties and search indices never do. At instance level,
a changeset belongs to a lens too, and dies with it. The same type key, and the same
lens key, can exist independently in two ontologies.

### Instance level

| Kind | Identifier | Notable fields |
|---|---|---|
| Entity | `_id`; `_identity` unique within its type, when the type declares one | its type key, plus the properties its type defines |
| Relation | `_id` | its type key, its two endpoint ids, plus its properties |
| Ruleset | unique `key` | its rules: the anchor's entity (type key and id) or none, and the write access |
| Changeset | id | its lens, its number, the ruleset key of the URL that started it (optional), version, note, submitted time (absent for a draft), timestamps |
| Staged object | changeset + the entity or relation id | kind, type key, action, a relation's ends, the identity it gives an entity, first touch |
| Staged value | staged object + property key | the value, the before of an update |
| Chunk | internal | fragment of one document property, with its offset and length, kept as a passage entry |
| Search entry | internal | one indexed text of one entity in one generation of a search index — its own fields, one relation, or one chunk |

System properties are server-managed, always readable, never writable: `_id`,
`_createdAt`, `_updatedAt`, plus `_entityTypeKey` on entities and `_relationTypeKey` on
relations, and `_identity` on entities of a type with an identity — derived from the
identity properties' values, the one system property a lens can withhold
([entity identity](capabilities/entity-identity.md)). They are distinguished by a leading underscore, and since no user-defined key
may begin with one, the namespaces cannot collide.

That separation rests entirely on the key pattern being enforced, and one entry point does
not enforce it — see the invariants below.

Relation endpoint ids are the exception to the underscore convention: reads return them as
`fromEntityId` and `toEntityId`, without a prefix, even though they are as
server-managed as any other system property.

Embedding vectors and document length bookkeeping are internal. They are stored, but
never appear in a response.

### Access level

In the access database, with authentication on; nothing here belongs to an ontology.

| Kind | Identifier | Notable fields |
|---|---|---|
| Principal | id | kind (user or service), display name, email, username, status (active or disabled), last sign-in |
| Sign-in identity | issuer + subject, unique | its principal |
| Assignment | id | its principal, role, ontology id (ontology and lens roles), lens id (lens roles), who granted it |
| Audit entry | internal | who changed what, and when |

Assignments name ontologies and lenses by their never-reused ids; keys are resolved on
every request, and an assignment whose ontology or lens is gone is left out.

### Invariants

Enforced in the service layer on every write path, whichever interface it arrived by. This
is the summary; each one is stated with its consequences in
[capabilities/schema-modeling.md](capabilities/schema-modeling.md).

- Ontology keys follow the schema [key](README.md) rule and are at most 59 characters;
  ontology keys and display names are unique server-wide.
- Type and property keys follow the schema [key](README.md) rule and are at most 64
  characters, on every path that sets them — the modeling interfaces and import alike.
- Entity type keys, relation type keys, lens keys and lens names are unique within
  their ontology. Property keys are unique within their owning type.
- A relation type may only be created if both endpoint entity types exist.
- An entity type cannot be deleted while any relation type references it.
- `document` properties are permitted on entity types only, on creation and on import.
- Relation endpoints are fixed at creation. Properties may change; endpoints may not.

## Lens scoping

A lens with no type inclusions exposes its ontology's whole schema. A lens with them
exposes exactly what it declares, with one inference: naming entity types alone also
admits the relation types whose *both* endpoints are in scope, because a relation with an
invisible endpoint would be unusable. The full rules are in
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md).

Scoping cuts in three places: schema reads omit what is out of scope, writes reject it,
and read results are filtered — including individual columns of a query result.

One asymmetry is deliberate and easy to get wrong when reimplementing: writes validate
against the scoped schema but apply defaults from the full schema. Relation endpoint types are checked against the full schema for the same reason. The rule
and what it buys are in [decisions.md](decisions.md#schema-and-data); the three operations
that consult the full schema instead of the lens, and what each one costs a caller, are in
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md#the-lensfull-schema-asymmetry).

## Schema cache

Runtime reads the schema on nearly every request, so each lens is assembled once and held
in memory: its scoped schema, the full schema, its agent configurations and its saved
queries.

The cache is keyed by ontology plus lens — lens keys are unique only within their
ontology, so the lens key alone would be ambiguous. Beside the lenses, the cache holds one
entry per ontology for [search indexing](#search-indexing): its index definitions and the
map, derived from them and the schema, of which writes affect which entries.

Each server process holds its own cache. Every entry is tagged with the
[design revision](#design-revision) it was read with; every use reads the ontology's
current revision first and uses an entry only while it is still that revision, otherwise
builds it again. A design change made on any server is therefore seen by the next request
on every other, with no signal between them, and an ontology deleted and created again
under its key never meets its predecessor's entries. Each process bounds its cache;
eviction changes what it must rebuild, not which design revision a request may use.

## Design revision

Each ontology carries a design revision: its never-reused identity and a number every
design change advances. Every modeling change — an import and a cascade included — is one
design change: one transaction that holds the ontology's design exclusively and advances
the revision, committing whole or not at all. Every data write, immediate or a changeset's
commit, validates against the cached schema of the revision it read and then runs its
checks, the write and its search work in one transaction that holds the design shared and
first checks the revision is unchanged. Shared holds
never wait for each other; a design change waits for running writes, and writes arriving
meanwhile wait for it. When the revision moved, the write loads the schema again,
validates again and retries; a design that keeps moving, or a wait of more than five
seconds for the design or a row, answers a conflict and nothing is written.

An assistant turn already running is not stopped by a design change: each of its tool
calls reads and writes against the design current at that call.

## Shared state

Shared state is what every server must see alike but may lose: the assistants' threads
([thread store](#thread-store)) and, with authentication on, the browser sessions
([authentication](#authentication-and-authorization)). It sits beside the persistence port rather than behind it,
and one setting chooses where all of it lives:
memory, which serves one server process, or Valkey, shared by every server that names it.
A configured Valkey that does not answer, that would evict data rather than refuse it, or
that cannot run the scripts fails the boot; nothing falls back to memory. Falling back
would split shared state between servers without an obvious failure.

**What belongs there.** State another server must see, whose loss users recover from, and
that expires on its own. Durable or authoritative state, and state that must commit with
ontology data, belongs in the database; state a server can rebuild alone, such as the
[schema cache](#schema-cache), stays in that server.

**One concern, one interface.** Each concern has a narrow interface in its own terms, with
a memory and a Valkey adapter held to one contract; there is no general key-value or cache
interface. On Valkey every concern shares one connection, keeps its keys under its own
prefix, writes every key with an expiry, makes every check-and-write one atomic script,
and is refused rather than evicted when Valkey is full. A new concern brings its interface
and both adapters, never a setting of its own.

## Thread store

Assistants converse in threads the server holds: a client sends a new message and, to
continue, a thread id; the server continues from the state it kept. Every thread lives in
one thread store — one for every server, not per ontology — behind an interface of its
own, part of the [shared state](#shared-state).

**Registry.** Each thread has a random, unguessable id — knowing it is what lets a client
continue the thread — and a binding to exactly one assistant: ontology, lens, kind and key,
and with authentication on to the principal that started it. A thread is found only
through its own assistant, and only by its own principal; otherwise it is unknown. Nothing
cascades: a deleted ontology, lens or assistant leaves its threads to retention.

**State.** The store keeps one value per thread: its conversation state after its last
completed turn. A thread keeps at most 25 turns; older ones are removed. The model sees at
most the last 8. A thread's state takes at most 8 MiB; a turn that would exceed it fails.

**One turn per thread, atomic turns.** A turn holds its thread under a renewable lease;
a message to a thread whose lease is held, on any server,
is refused, never queued. The turn runs on a copy of the thread's state in its own process
and stores the result once, when it completes — only while it still holds the lease, and
ending the lease in the same step. A cancelled or failed turn stores nothing and releases
the lease. So a thread read during a turn shows its last completed turn, a thread only ever
holds complete turns, and an interrupted turn is asked again, never resumed. A server that
stops without ending its turn blocks the thread until the lease runs out.

**Retention.** A thread expires 24 hours after its last activity: a message accepted for
it or a turn completed. Reading a thread is not activity. Expiry removes its state and its
registry entry, with no background job. No thread is ever removed to make room: a full
store refuses new threads and completed turns as a storage failure. The memory adapter
holds at most 256 MiB; Valkey is bounded by its own memory limit.

**Loss.** Nothing is persisted. Threads are lost only when their store loses them: a
memory store with its server's restart, Valkey with its own reset. A client continuing a
lost thread is told it is not found and starts a new one.

## Assistant kinds

Agents, retrievers and navigators are each built end to end on their own: each kind has
its modeling and runtime routes under `assistants/<kind>`, its own storage, its own check
of a configuration, its built-in default and its place in transfer under the lens's
`assistants`. Every kind shares the
[thread store](#thread-store), the chat request and stream frame, and the one `entities`
event ([interfaces](interfaces.md#assistant-chat-and-threads)). Runtime's assistant kit holds the
kind-neutral helpers: the live trace of a fixed pipeline's steps, and the model calls —
structured output for a decision, a stream for the answer.

The [navigator](capabilities/navigators.md)'s turn is a fixed pipeline. It
announces its steps when the turn starts and traces each as it runs, in events prefixed
with the navigator's name, and streams the entities its answer may use before the answer
as the shared `entities` event ([interfaces.md](interfaces.md#assistant-chat-and-threads)).
Its model calls are never retried.

## Authentication and authorization

One startup setting turns authentication on for a server; every server of a deployment
shares it. Off, every request is trusted and
nothing below runs. What a caller experiences, and what each role allows:
[capabilities/authentication.md](capabilities/authentication.md).

**Who is calling.** A request proves itself by a bearer access token or by the browser's
session cookie, never both: a bearer header decides alone, and the MCP mounts take bearer
tokens only. A token is checked against the provider's published keys — issuer, audience,
OntoForge's scope, expiry, an asymmetric signature, and no nonce, which only an ID token
carries — and never sent to the provider to ask. Its sign-in identity, or
the session's, leads to the principal in the access database, read with its assignments
afresh on every request, with no cache: a revoked role or a disabled principal is refused
on the next request, on every server. A sign-in identity seen for the first time becomes a
principal with no role, created once however many first requests race.

**Browser sessions.** The server is the browser's OpenID client: authorization code with
PKCE, as a confidential client ([decisions.md](decisions.md#access)). A login in progress
keeps nothing on the server; it travels in a short-lived, sealed cookie that any server of
the deployment can open. The session lives in the shared state, keyed by a digest of the
cookie's random id, and expires after its idle time or at the latest 24 hours after
sign-in. Both cookies are HttpOnly, Secure and SameSite=Lax, named after the public
address's port. A cookie request that may change something must carry the public
address's origin, and cross-origin browser calls are allowed without credentials only.

**What a route needs.** Every route declares its need — public, any signed-in caller, a
platform role, the administrator or any member of the ontology in its path, a role on the
lens in its path for an operation, or user administration — when it is registered; a
route without one fails the boot. Runtime routes take their operation from the same table
that classifies a ruleset's writes, so one table says what writes. Public routes resolve no
caller and keep working whatever the provider or the access database does.

**One authorization service.** It judges a route's need before the request's body is read,
and tells handlers which ontologies and lenses a caller may see listed. The MCP mounts go
through it as REST does, and a runtime mount builds its tool list from the caller's role as
from a ruleset's level. An assistant's tool calls run inside its chat request, already
judged for that lens.

## Request lifecycle

A runtime write, which is the longest path:

```
  request
    → with authentication on: identify the caller and judge the route's need
      (no credential → unauthenticated, no role → not found or forbidden)
    → parse and validate shape
    → bind a runtime store to the ontology key (unknown key → not found)
    → resolve the lens key within that ontology
    → read the design revision; load lens and search context from the schema cache
      (build when missing or older)
    → reject unknown properties; check required; apply defaults
    → coerce each value to its declared data type
    → derive the search work the write causes, from the cached search context
    → cross the persistence port (one transaction holding the design shared: check the
      revision, then the write and its search work; a moved revision starts over)
    → adapter compiles and executes
    → filter response to the scoped properties
    → stub documents, apply field projection
  response
```

Two properties of the validation step are contractual rather than incidental, and both are
rules rather than implementation choices:

**All errors are collected, not the first one** — [decisions.md](decisions.md#schema-and-data).

**Coercion is strict.** Values are converted, never guessed. What each data type converts
and what it refuses is in
[capabilities/schema-modeling.md](capabilities/schema-modeling.md#data-types).

## Changeset commits

A [changeset](capabilities/changesets.md) is staged call by call, each call merged into
its set of staged objects and values and holding nothing afterwards; only its commit is
transactional.

**Where the rules run.** Every rule of a commit runs in the service, as for an immediate
write: the lock-free pass before anything is locked, then commit validation over the end
state, through neutral reads of the port that return stored parent links and lock
targets but judge nothing. The staged objects are applied through the same store writes
as the immediate path.

**One connection.** A commit runs, like every data write, on a store bound to one
database transaction: every operation of that store, and of the ruleset and changeset
stores it hands out, uses the transaction's one connection, and taking a second connection
inside it is a programming error
([storage-adapters.md](storage-adapters.md#transactions)).

**The commit lock.** Each ontology has one commit lock, held only by commits and checks
and only for their transaction; a second commit on the ontology is refused at once rather
than queued. Immediate writes, staging and submit never take it; an immediate write waits only
for a row a running commit has locked.

## Search indexing

Every search index keeps entries composed from the
current state of entities — their own fields, their relations together with the entities
at the other end, and the passages of their documents. Entries are built in the
background, never on the request path, so search over them is eventually consistent
([index lifecycle](capabilities/search-indices.md#lifecycle)).

**Every write queues its work in its own transaction.** Entity and relation writes —
create, update, delete, document edits — hand the store, with the write, the search work
they cause: which parts of which entities to compose again. The store queues it in the
write's transaction, so the work exists exactly when the write commits; the queue lives in
the same database, behind the persistence port, without an external queue or broker. A
deletion removes the affected entries with the write instead of queueing anything. A
change no index reads queues nothing.

**A worker in every server process drains the queue.** It claims a batch under a
time-limited lease — items another process holds are skipped, so any number of processes
share one queue — and composes each claimed part's text from current state, outside any
transaction. It skips parts whose text is unchanged, embeds the rest in provider batches,
writes the entries and completes the claim. The lease fences the claim: once it runs out
another process may take the items over, and from then on whatever the first worker
writes or settles for them is dropped and logged — as for an entity deleted while the
worker composed. A write that queues an item again while it is
claimed is never lost: completing the older claim leaves it queued. A failed batch is
retried with exponentially growing delays; after the configured number of attempts its
items count as failed and wait for a rebuild or a new write of their entity. The worker
sleeps until the database notifies it that work was queued in any process, and polls at a
configured interval in case a notification is missed.

**Entries belong to generations.** Each index is built once per representation —
semantic and keyword — as a generation identified by the definition it was built from
and, for semantic entries, the embedding model, for keyword entries the keyword language
set. When no generation matches, a new one is built from a full backfill beside the
active one, which keeps serving until the new one is complete and takes its place in one
step; one process at a time builds its search structure. An entry's semantic text is labelled with the schema's display names, unless the
index renders it from a template; its keyword text holds values only
([composition](capabilities/search-indices.md#composition)).

**Managed indices follow the schema.** After every schema change the modeling side derives
the managed indices again from the full schema — creating, updating and deleting their
definitions, including a new one in every scoped lens that exposes its root type (a
passage index: its document property too) — and brings the generations in line. A changed display name or name property, which no
definition captures, queues the entities of every index rendering that type again. The worker does the same for
every ontology when it starts, and brings an ontology's generations in line again whenever
its design revision moved since it last did: after a change this is best effort, so a
failure there is logged, never answered, and made good by the worker. Any number of servers may bring generations in line at
once: a generation is created or retired only while the design revision is the one that
was read, and none is created where a matching one already builds or serves. Creating one
holds the design exclusively, so no data write falls between its backfill and its taking
new work. Ranked search reads the ready generations
([capabilities/search-indices.md](capabilities/search-indices.md)).

## Error model

REST failures share an error envelope and a consistent taxonomy. MCP expresses the
same failures as tool errors. The interface contract, including error codes and details,
is in [Interfaces](interfaces.md#errors).

## Startup

Ordered, and failure at any step prevents serving:

1. Connect storage, verify reachability, ensure the server-wide constraints and indexes
   exist, and bring storage of an older storage version up to date
   ([storage lifecycle](storage-adapters.md#lifecycle)). Per-ontology storage is provisioned when an
   ontology is created; at boot only an upgrade reaches into it. Open the
   [shared state](#shared-state). With authentication on, open the access database:
   create it when it is missing and bring its schema up to date, once however many
   servers start together; a schema newer than the server understands fails the boot.
   Then discover the identity provider, waiting at most 10 seconds.
2. Initialize the embedding provider, if configured.
3. Initialize the language-model and decision-model providers, if configured.
4. If embeddings are enabled, compare the width of every registered ontology's
   saved-query description index with the provider's and warn on mismatch — see
   [capabilities/search.md](capabilities/search.md#vector-index-width-drift). Search
   indices need no such check: a changed model starts new generations in step 5.
5. Start the [search indexing](#search-indexing) worker. It runs in the background: it first brings every ontology's managed indices
   in line with its schema, removes what interrupted generation removals left behind and
   brings every ontology's generations in line with the current definitions, embedding
   model and keyword language sets — a changed model or language set starts its new
   generations here — then drains the queue. Its failures are logged
   and never prevent serving.
6. Start both MCP servers.

With authentication on, neither the access database nor the provider is optional: either
failing fails the boot, and nothing falls back to running without authentication
([decisions.md](decisions.md#access)). With it off, neither is touched.

The registry walks in steps 4 and 5 do nothing when no ontology exists — a zero-ontology
server boots clean. Note step 4 warns and does not repair — deliberately, for the reason
given in [decisions.md](decisions.md#deployment). Rebuild is where repair happens, one
ontology at a time.

The port opens only once these steps are done; from then on the liveness and readiness
probes answer ([interfaces.md](interfaces.md#probes)).

## Shutdown

A stopping server — on SIGTERM or SIGINT — drains, then closes, once:

1. Readiness answers not ready, and every response not yet started closes its
   connection after it. No new connection is accepted and idle ones close.
2. Running requests and chat streams go on, for at most the configured drain period.
   The search worker stops alongside: it starts no further ontology and cancels its
   embedding requests; a batch it stops is not counted as failed but released, so the
   next claim, in any process, takes it at once.
3. Whatever still runs then is cut. A cut chat stream ends without a terminal event; its
   turn stores nothing and releases its lease.
4. The app with its shared state, the worker, the providers and storage close, in that
   order. A shutdown that stalls exits the process.

## Configuration

Environment supplies all configuration. There is no configuration file and no
per-ontology deployment configuration.

| Group | Purpose | Absent means |
|---|---|---|
| Storage | Which adapter, how to reach the database, pool size, and an optional separate address for the wake-up subscription | Server cannot start |
| Embedding | Provider, model, endpoint, credential, vector width, request batching | Semantic search unavailable |
| Documents | Chunk size and overlap | Defaults apply |
| Search indexing | Attempts before a queued item counts as failed, worker batch size, polling interval | Defaults apply |
| Shared state | Memory or Valkey, and how to reach Valkey | Memory |
| Shutdown | How long a stopping server drains | Default applies |
| Language model | Provider, model, endpoint, credential | AI capabilities unavailable |
| Decision model | Endpoint, model, credential | Entity identity comparison unavailable |
| Public URL | The address clients reach the deployment at, reported to clients; with authentication on, the browser's origin | No address is reported; required with authentication on |
| Authentication | On or off; the identity provider, how this server reaches it, the client and its secret, the audience, the configured administrator, the session idle time, the access database | Off: every caller trusted |

Exact variable names are in the repository README; they are deployment surface, not
architecture.

The optional decision-model contract answers typed choices, scores and yes/no
probabilities about caller-supplied context. It is independent of the language model
and embeddings, and supports the explicit, read-only
[entity identity comparison](capabilities/entity-identity-comparison.md) operation.
Provider setup and the wire contract are documented in
[providers/decision-api.md](providers/decision-api.md).

## What the architecture does not provide

Stated plainly, because its absence is a design position and not an oversight:

- **No multi-tenancy.** An ontology isolates data but is not a tenant — the rule and
  its reason are in [decisions.md](decisions.md#scope).

Absences in the API surface itself — no data wipe, no instance-data export — are listed
with their consequences in [interfaces.md](interfaces.md#what-is-not-exposed).

## Further reading for implementers

[Runtime state implementation](implementation/runtime-state.md) describes cache capacities,
turn-lease timing and the implementation of navigator turn execution. These details support
the consistency and ownership guarantees above; they are not needed to understand the
system's component boundaries.
