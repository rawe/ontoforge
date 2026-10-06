# Rules

Binding constraints on the design. Each states a rule and the reason it exists.

These are current state, not a history. When a rule changes, this file changes with it —
the record of *when* a rule was adopted and what was weighed against it lives in
[adr/](adr/).

Design principles that govern how these rules are chosen — and the requirement that a new
one be approved before it is adopted — are in the repository `AGENTS.md`.

## System shape

**One server, always serving everything.**
Registry, modeling and runtime routes and both MCP servers are served by every instance.
There is no mode switch and no runtime-only deployment. A schema change and the data it
governs must never be able to disagree about which server they reached.

**One database holds schema and instance data.**
Keeping them apart is the adapter's business, not the API's. Two stores would make every
schema change a distributed transaction to buy an isolation nothing needs.

**Modules registry, modeling, runtime, server and core — and runtime never depends on
modeling.**
Registry manages ontologies as whole units, server carries the deployment's capability
report, and core owns what the others share. Runtime obtains the schema through the
persistence port, not by calling modeling. This is what lets a lens be cached as a value
rather than fetched as a service.

## Ontologies

**Vocabulary** — *Ontology* is the isolated unit of one schema, its lenses, and its
instance data; *Schema* is one ontology's type-set; *Lens* is a named view over one
ontology's schema. No interface name may use "ontology" in the old sense (lens); old
spellings do not survive. Physical database names are exempt.

**Ontology identity** — an ontology is addressed by an immutable `lower_snake_case`
key, unique server-wide, with a mutable display name, also unique server-wide.
Interfaces speak the key.

**Key scoping** — every key is unique within its owner: property keys per type,
saved-query, agent and retriever-agent keys per lens, type and lens keys per ontology,
ontology keys per server.

**Ontology lifecycle** — created bare (no types, no lenses, no data); rename changes
the display name only; delete is a hard full cascade over everything the ontology
contains. Zero ontologies is a valid server state.

## Naming

**One word per concept, everywhere.**
"Modeling" and "runtime" name the same things in modules, routes and stores, with no
synonyms. This governs code and API surface. The web client is free to use its own
product names for its surfaces, and does.

**Keys, never identifiers, on the runtime and MCP surfaces.**
Everything an agent or a data client touches is addressed by human-readable key:
ontologies, lenses, types, properties, saved queries, agents and retriever agents. Internal
identifiers are resolved behind the interface. A language model should never have to
carry an opaque identifier to name a type.

The modeling REST surface is the exception: it addresses lenses, types and properties
by internal identifier, and only agent configurations, saved queries and retriever
agents by key. It is a schema-design surface used by a client that has just
listed the resource it is about to address, so the identifier is always at hand.

**Key length cap.** Every key — entity type, relation type, lens, property,
agent, saved query, retriever agent — is at most 64 characters (`MAX_KEY_LENGTH`), enforced at
validation alongside the key pattern. Keys are human-typed identifiers; the cap
keeps adapter-derived physical names legible and rejects absurd input at the
boundary rather than deep inside an adapter. Ontology keys carry a tighter cap of
their own — see the PostgreSQL layout rule under Storage.

**No vendor or implementation-language vocabulary anywhere a caller can see.**
Not in route names, field names, tool names or error messages. The query endpoint takes a
`query`; the query language is OQL; storage errors name no database. A rejected value is
described by its JSON type, never by the name the server's own language gives that type.
The storage backend is exchangeable and so is the language, so a public surface naming
either would be a leak, not a convenience. Deliberation on the type-vocabulary half:
[adr/0014](adr/0014-received-values-named-by-their-json-type.md).

## Storage

**All storage access crosses the persistence port.**
Everything specific to a database — driver, connections, query text, physical naming,
index definitions, driver-native temporal types — lives inside one adapter. Services,
routers and MCP handlers speak schema vocabulary only.

**Persistence isolation** — every persistence operation runs through a store bound to
exactly one ontology; registry operations live on a separate registry port. The
physical isolation mechanism is each adapter's private business, behind the
technology-neutral contract.

**PostgreSQL layout** — one PG namespace per ontology, named `ont_<key>`; ontology
keys are capped at 59 characters. `public` holds everything server-wide, starting
with the ontology registry (table `ontology`). Ontology-scoped DDL runs at ontology
creation; ontology delete drops the namespace in one cascade. Physical lens names
follow the locked vocabulary (`lens`, `lens_includes`, `lens_id`, `lens_key`).
Deliberation: [adr/0017](adr/0017-postgres-namespace-per-ontology.md).

**Storage carries its own version number.** The storage records a storage version — a
whole number, independent of the release version and of the transfer format version, that
changes only when a release changes the storage layout. One number covers the whole
server. New storage is created directly at the current layout and version. At startup the
server compares the recorded version with the one the code expects and brings older
storage up to date automatically before it serves requests: every ontology is upgraded
together, and the number advances only when all of them succeeded. Several servers
starting against one database upgrade it once: the upgrade holds a database-wide lock and
reads the version again under it. The server logs every upgrade it runs and never backs
up storage itself. The release defines the storage layout — tables, columns, fixed
indexes — and only a storage-version upgrade changes it; the two exceptions are the vector
indexes the search-data rebuild drops and builds again — and, on an adapter with its own
search storage, those schema changes create and drop — and the entry storage of each
search-index generation, which the generation's lifecycle creates and drops. Within a major release line upgrade steps only add — tables, columns with a
default, indexes — so servers of the
previous release keep working during a rolling update; renaming, removing or rewriting
stored data waits for the next major release, which carries one step of its own. Upgrade steps are kept for one major release line: a major release
removes them all and accepts only new storage or storage at the version the previous
major line ended on. Older storage stops the server with the instruction to upgrade
through the last release of the previous major line first. Storage newer than the code
also stops the server, untouched.

**Neo4j ontology cap** — the Neo4j adapter supports at most one ontology; a second
create is rejected as a domain condition. Multi-ontology conformance is a separate
suite tier that only multi-capable adapters run. Deliberation:
[adr/0017](adr/0017-postgres-namespace-per-ontology.md).

**Filters, sorts and searches cross the port as structured values.**
Never as query text or fragments. A fragment crossing the port would put query syntax in
the service layer and make the port unimplementable by a different kind of database.

**Query paths are resolved above the port and cross it as structured path conditions.**
The service parses the key, checks it against the lens-scoped schema and settles the
direction — derived from the endpoints, or named by the key's marker where they cannot
decide it; the adapter receives a condition carrying relation type key, explicit direction,
property source, final property key, data type, operator and value — never a key to
interpret. Resolving in one place is what keeps the faults identical on every backend and
the lens a complete horizon.

**Driver exceptions never cross the port.**
Any storage failure surfaces as a single storage error carrying a generated id. The
original is logged against that id, because a driver message names the vendor and its
physical objects — and without the id a reported failure could not be traced back at all.

**Adapters declare the type keys they reserve; the service enforces them.**
A key whose physical form would collide with the adapter's own schema objects is rejected
on every write path, with an error naming neither the vendor nor the physical name.
Encoding those names above the port would tie database-agnostic code to one database;
enforcing them inside the adapter would deliver the error from the wrong layer and make
every future adapter reimplement it.

**Adapters declare whether search evaluates relation conditions; the service
enforces it.**
A query path or a relation existence test on search resolves and crosses the port only
where the adapter
declares support; elsewhere it is rejected above the port, naming the entity list as the
alternative. Filters on a search are applied as part of the search, so a relation
condition
an adapter cannot evaluate inside its vector query must be refused before the search
runs — evaluating it afterwards would make the limit count unfiltered hits — and encoding
the capability above the port would tie database-agnostic code to one database.

**Adapters are peers under one contract; one is the default deployment.**
The port contract and the conformance suite define behaviour — no adapter is the
reference implementation. Every shipped adapter is fully supported, each with its own
physical mapping described in [storage-adapters.md](storage-adapters.md). Which adapter
is the default, and what each specializes in, is deployment surface recorded there and
in the repository README, not here. A new adapter is still built only when a deployment
needs one.

**Oversized-string ceiling is adapter-specific.** The 32766-byte oversized-string
rejection is a Neo4j index limit, not a system rule; it applies only on the Neo4j
adapter, below the port. PostgreSQL accepts such values. No ceiling exists above
the port — deployments are adapter-bound for life, so no deployment ever sees
both behaviours.

**PostgreSQL instance mapping: two generic jsonb tables.** The PostgreSQL adapter
stores all instance data in two generic tables — `entity` and `relation`, with `uuid`
primary keys and properties as jsonb — never a table per type. A schema change stays
pure data for instance storage: no table or column is ever created per type or property.
The only DDL that follows a schema change is the entry table of a search-index generation
it starts. The physical mapping is described in
[storage-adapters.md](storage-adapters.md); deliberation:
[adr/0015](adr/0015-generic-jsonb-instance-tables.md).

**Storage DDL enforces structure only.** Adapter DDL carries identity,
referential integrity, exactly-one-owner and uniqueness — nothing else. Business
rules (for example, document properties only on entity types, the data-type
enumeration) validate in the service; the database provides no backstop for them. One
exception: the PostgreSQL search-index tables check their closed vocabularies — index
kind, representation, generation state.

**Search-index entries are built asynchronously; search over them is eventually
consistent.** A write commits without its semantic or keyword entries; they follow in the
background, so building entries — embedding included — never delays or fails the write
that caused them.

**Search indexing is a transactional outbox drained by an in-process worker, behind the
persistence port.** Every entity and relation write queues the search work it causes in
its own transaction, in the same database; a worker in every server process claims and
processes it. No external queue or broker. One database and one transaction keep the
work exactly as durable as the write.

**Search-index vectors are half precision, stored and indexed.** The PostgreSQL adapter
keeps entry vectors in an untyped `halfvec` column and indexes each generation as
`halfvec` at its width, so every PostgreSQL deployment needs a pgvector with half-precision
vectors. Half precision halves the heap and the vector indexes, which a large ontology
needs kept in memory for fast search.

**PostgreSQL keeps one entry table per ontology namespace, list-partitioned by
generation.** A generation fills a table of its own, is indexed there and is attached as a
partition when it becomes active; a retired one is detached and dropped whole. Building
beside the serving generation and switching in one step never rewrites the entries
search is reading.

**Documentation above the port describes the behaviour of the default
deployment.** Adapter-specific deviations are documented with that adapter in
storage-adapters.md, never as hedges in the shared documents.

## Interfaces

**REST addressing** — every ontology-scoped request names the ontology in the path:
`/api/ontologies/:key/model/...` for schema, and
`/api/ontologies/:key/runtime/lenses/:lensKey/...` for instance data through a lens
— never both in one request. An ontology is always addressed as `ontologies/<key>`,
a lens always as `lenses/<key>`. Registry CRUD lives at `/api/ontologies`;
ontology delete is a plain request, guarded only by UI confirmation.

**Server surface** — server-wide, phase-neutral capability reads live under
`/api/server`. Ontology-scoped operations never live there; server-wide data
operations do not exist (the search-data rebuild is per-ontology).

**MCP addressing** — every MCP mount is bound by URL, mirroring REST spelling:
modeling at `/mcp/ontologies/:key/model`, runtime at
`/mcp/ontologies/:key/runtime/lenses/:lensKey`. The URL is the only binding
channel — no header or env fallback — and tools never take an ontology parameter.
No MCP surface exposes the ontology registry — ontology management is REST/UI
only — with one exception: the modeling mount's argument-less `ensure_ontology`
creates the ontology its own URL names. Deliberation:
[adr/0016](adr/0016-mcp-url-only-binding.md).

**MCP runs inside the server process and calls services directly.**
Not a separate process, and not a wrapper over the REST API. A wrapper would add a
network hop and a second contract to keep in agreement with the first.

**Two MCP servers, one for modeling and one for runtime.**
Mirroring the REST split, so that no client can reach both through one connection.

**An MCP tool description stands alone.**
It states every rule of its own parameters in full, including where a sibling tool with
similar input behaves differently. It may name another tool as a next step in the
process, never as the place where one of its own parameters is explained. Tools are
loaded and enabled one at a time, so a description that leans on another is incomplete
the moment that other tool is absent.

**A tool description is at most 2000 characters.**
Clients cut longer descriptions without notice, and everything after the cut is
invisible to the caller. The budget is met by tightening the text, never by pointing at
another tool.

**A tool description carries caller-facing facts only.**
What a call accepts, what it returns, and how it behaves. Nothing about the backend, the
storage adapter or the ranking algorithm; a rejection message already tells the caller
what to do instead.

**Search and document search are separate tools on MCP and agents.** The first runs both
kinds, the second promises a passage on every hit. Both choose the default strategy and
return the search envelope. Reading a single relation by id remains outside the grantable
set; no write tool is grantable.

**Search strategies have implementations and availability requirements.** Defaults choose
the first available of hybrid, keyword, semantic; every response names the applied one.
The index search's mode follows the same order: hybrid with an embedding provider,
keyword without one.

**Search ranking scores are relative; match evidence is separate.** A hit's
`relativeScore` is comparable only within one response and is never absolute similarity
or confidence. Each match's `evidence` carries `semanticSimilarity` (the supported
similarity on the `(1 + cosine) / 2` scale, or null), `keywordMatch` (a supported
boolean result, or null) and `keywordScore` (the entry's keyword score — the distinct
query words it contains plus the adapter's native full-text ranking below one — unbounded,
a number exactly when `keywordMatch` is true and null exactly when it is null). Null means unknown or unmeasured, including unavailable
signals; false requires an explicit negative evaluation, never absence from a limited
ranking. The keyword score is not comparable to semantic similarity, not across
responses, and never enters fusion or tie refinement. Evidence describes the match's own
entry — the entity's own-field text or the particular returned document passage — not
which signals contributed to ranking. A hit's `matched` names the entry that matched best
— its index, part and, for a relation entry, the relation and its target — never which
retrieval method found it; do not add a `via` or source-membership field naming the
contributing signals. Retaining evidence itself preserves ranking and passage selection.
Matches do not attribute keyword or semantic matches to individual properties.
Saved-query discovery retains its separate cosine scores.

**Search ranking and evidence have distinct meanings.** Relative rank, semantic
similarity and keyword evidence must not be presented as interchangeable measures or
combined arithmetically; fusion reads rank positions only.
A similarity bounded by zero and one is not, by itself, calibrated confidence.

**Search provenance must be supported by evidence.** Unknown or unmeasured evidence
must not be represented as a negative match. Absence from a limited ranking does not
prove that a unit failed to match. A semantic match over composed entity text does
not, by itself, establish which individual property caused the match.

**A correction to cross-type search fusion must preserve single-type behaviour.**
Changing single-type behaviour requires separate explicit approval, because a fix for
unequal eligibility across types must not silently change callers searching one type.

**Search merges indices by score within a retrieval method and fuses only the methods,
by reciprocal rank.** Within one method, the rankings of every searched index — every
type, own fields and passages alike — merge into one ranking by their own scores, which
share one scale there (one embedding model's similarity, one query's keyword score). Grouped by entity, an entity counts once, scored by its best entry, whichever
index holds it. A single method keeps those scores; `hybrid` fuses the two entity rankings
as the sum of `1 / (60 + rank)`. What matched is the best entry under the method in which
the entity ranks best, semantic on equal ranks. Resolve equal scores by the best semantic
similarity only if every tied entity has one; otherwise, and among equal similarities, by
entity id. Being found by several indices — own fields and a document, say — never adds
up, so an entity is not favoured because its type has a document property, and no
missing measurement is treated as negative evidence. The Neo4j adapter stores no search
indices and ranks per kind instead; when both kinds run there over more than one searched
type, it takes the best reciprocal kind rank. Deliberation:
[adr/0020](adr/0020-search-ranking-and-evidence.md).

**Keyword content contains values, not schema labels.** An entry's keyword text holds
values only, its semantic text is labelled — or rendered from a custom index's template,
which keyword text never uses — so keys and labels cannot count as matching
content. This applies to keyword and hybrid retrieval, including single-type queries; it
is distinct from preserving single-type fusion.

**Search evidence does not establish answer sufficiency.** Keep search candidates
available without an automatic similarity floor over REST, where a caller may set an
explicit one. The MCP and agent search tools apply a fixed floor of 0.75 whenever the
default strategy ranks semantically, hidden from the caller like the strategy itself, and
none when it ranks by keyword. A floor removes only semantic candidates measured below
it, never a keyword hit. A model-specific similarity and a lexical match are evidence to
inspect, not guarantees that the requested answer exists. Unknown signals do not justify
silently removing a candidate.

**Any-term keyword matching is the default keyword retrieval method; all-term keyword
matching is a strategy of its own.** Two levels are named. A search strategy is what a
caller selects: it uses one retrieval method directly or fuses several by rank. A
retrieval method is how one source ranking is produced from storage. `keyword` and
`hybrid` use the default keyword matching, `hybrid` fusing it with semantic ranking; both
always use the same one, so changing the default changes both together. `keyword-any` and
`keyword-all` each fix one method and never follow the default. Any-term keyword matching:
a row matches when it carries any query term, each also matching as a prefix. All-term
keyword matching: every query term must be present, each still matching as a prefix.
Any-term is the default because a conjunction lets one absent term empty the whole result,
which for a compounding language is ordinary rather than exceptional: stemming reduces
neither compounds nor derivations, so a row holding what was asked drops out over a term
it carries in another form. Rank order follows the keyword score, so an entry holding
more distinct query words ranks above one holding fewer, whatever their frequency.
Prefix matching admits unrelated words sharing a stem; ranking
carries that cost. Under either method the query is assembled from the query terms the
adapter's own tokenizer produced for the search text, quoted, so search text never
reaches query syntax. Strategies are the extension point for retrieval behaviour and are
added ahead of demand: a further method is one more strategy value and one more adapter
branch. Rejected: a matching parameter beside the strategy, which splits one choice over
two axes; a conjunction over exact query terms without prefix matching, since all-term
means every term, not no morphology; and building no all-term variant, which leaves the
any-term behaviour unnamed and the extension point unexercised.

**Keyword entries are stemmed in every language of the ontology's keyword language set.**
The set is English, German, or both. One keyword representation per entry concatenates
the stemming of each language; a query is stemmed in each, its terms combined within a
language by the keyword matching and the languages OR-ed. No request names a language:
which language a query is written in is unknown, and an ontology's content may mix both.
Matches across languages are left to semantic ranking. The set is a modeling setting of
the ontology, not a registry attribute: creating an ontology names no language, and a new
ontology starts with both languages. It is editable; a change builds new keyword
generations of every index in the background, without embedding calls, while the
previous ones keep serving until they are ready. Import replaces the target's set with
the payload's. Stemming uses the database's stock configuration of each language, with no
added compound or other dictionary, so a deployment needs no custom database image.

**A schema edit never writes instance data.** Managed search indices follow the schema
asynchronously: a changed derived definition builds a new generation in the background,
and the previous one serves until it is ready. An adapter's own search storage
([storage-adapters.md](storage-adapters.md#own-search-storage)) is not refreshed at all:
deleting a string property leaves its values inside every entity's stored vector until a
rebuild recomposes it, since a vector does not record which property a word came from.
Cleaning up at deletion time was rejected: it would turn a schema edit into a write over
all instance data, a bulk re-embedding that a server with no provider could not perform
at all.

**One rebuild covers every vector and passage stored outside search indices, and it
needs no provider.** On an adapter that stores search indices that is the saved-query
description vectors and their index alone; search indices keep themselves current and
are not part of it. On an adapter with its own search storage it also covers every
entity's vector and every document's chunks. Without an embedding provider the operation
still runs: it skips the vectors, the vector indexes and the saved-query descriptions —
re-chunking documents where it has any, which calls no model — and reports that skip in
its summary rather than counting it as failure.

**The list filters and the search ranks.** Neither server operation falls back to the
other. Cross-type search ranks each searched type's own indices over an exact searched
set, with no shared cross-type index.

**MCP transport is stateless HTTP with plain JSON responses.**
MCP has no event stream. Statelessness allows the same mount to serve many clients
without per-connection state. This rule applies to MCP, as established in
[the MCP transport deliberation](adr/0005-mcp-transport-streamable-http-embedded-in-fastapi.md).

**REST chat always delivers tool activity and the complete answer as NDJSON.**
Both default and configured chat use their existing routes and one response contract.
Results retain their JSON structure; only the final answer carries assistant text.
Failures preserve received results and mark the turn incomplete. Disconnect cancels further
work, and delivery bounds buffering. Shared execution remains usable by complete-response
callers; A2A and MCP retain their own transport contracts. The wire details live in
[interfaces](interfaces.md#ai); the delivery alternatives are weighed in
[the chat transport deliberation](adr/0021-rest-chat-tool-streaming.md).

## Behaviour

**Entity identity comparison is optional, explicit and advisory.**
It compares two caller-supplied partial scalar snapshots of one lens-scoped entity
type through a fixed `choice` between `same`, `different` and `insufficient`.
Its Decision-provider availability is independent of AI and embeddings. It neither
participates in search nor writes, merges or automatically selects entities; failure
does not invoke a fallback. Document, system, unknown and out-of-scope fields never
enter its provider context. The bounded-context contract lives in
[entity identity comparison](capabilities/entity-identity-comparison.md).

**OQL is the query language, anchored to the ISO GQL standard.**
Its normative reference is ISO GQL and its GPML pattern sublanguage — not any vendor's
dialect. Parsing and validation are storage-independent; compiling to a native dialect is
the adapter's private business. Where the two disagree, the standard wins.

**OQL feature surface.** The surface is a closed enumeration in
`capabilities/oql.md` ("Supported surface"), enforced fail-closed at validation,
above the persistence port: any construct or function the grammar parses but the
enumeration does not name is rejected with a self-correction hint. Every backend
accepts exactly the same queries. Widening the surface is a deliberate, non-breaking
addition; narrowing it is a breaking change.

**A structured filter key may cross exactly one relation.**
A query path names one relation type and a property reached through it — of the related
entity or of the relation itself; it is resolved against the lens-scoped schema at query
time, and nothing is declared or stored for it.
One hop covers the case that would otherwise flatten a relation into a property; anything
beyond it is OQL's job. Widening — more hops, quantifiers, path values in responses — is a
deliberate future addition, never implied by the syntax. Deliberation:
[adr/0019](adr/0019-inline-query-paths-over-declared-query-fields.md).

**A path condition holds when at least one reachable value satisfies it.**
Conditions are independent: two paths through one relation type may be satisfied by two
different related entities, and they combine with each other and with plain filters by
AND. Existential is the only quantifier, so an entity with no relation of the type simply
does not match — as an entity lacking a property does not. An existence test on a path
is the same quantifier over presence: at least one reachable value is there, or is not.

**A comparison never matches a missing value; existence is its own condition.**
Not-equal holds only where the property exists and differs, like every other
comparison, so no operator smuggles in null semantics. Whether a value is there at all is
asked with `__exists` and `__missing`, which take a flag and no value and cross the port
as existence conditions of their own — a property, a path, or a relation type — separate
from the comparison conditions, because a comparison carries a data type and a coerced
value and an existence test carries neither.

**A relation type is a filter subject only under an existence test, and absence is
anti-existence.**
`filter.<relationTypeKey>__missing=true` asks whether no relation of the type reaches
the entity in the direction the schema implies, resolved by the query-path rules; nothing
about the relation is compared. This states an invariant such as "no newer version
supersedes this one" directly, so no derived flag has to be stored and kept consistent
with the relations it summarizes. A relation type under a comparison operator is
rejected, because there is no value to compare.

**The type table offers a listed subset of the entity-list filter vocabulary.**
Which operators and filter subjects the web client's type table offers, and which it
leaves out, is listed in [product-surface.md](product-surface.md#type-table). A change to
the filter vocabulary — an operator or a kind of filter subject — settles whether the type
table offers it and updates that list, so every difference between the table and the
server is a recorded choice.

**The web client shows no search score.** A hit names at most what found it — a relation
or a passage — in a short label, never a number, a bar or the entry's text. A displayed
score would be read as relevance or confidence, which a relative score is not.

**Search indices and retriever agents are designed in the Studio and used in the
Workbench.** The Studio owns the index designer, the search settings and the
retriever-agent editor, which carries a test panel so an agent is configured and tried in
one place; the Workbench only chats with saved agents. Design stays with design, as
schema and lenses do.

**Validation collects every error before answering.**
A rejected write names all offending fields at once, and a rejected read all of its
faulty filters, so a caller can correct in one round trip rather than discovering faults
one at a time.

**Writes validate against the lens; defaults come from the full schema.**
A property a lens hides cannot be written through it, but a required property with a
default still receives that default — otherwise a narrow lens could create data that is
invalid under a wider one.

**Destructive schema changes require explicit consent.**
A change that would invalidate a lens, or remove something a custom search index reads,
is refused, and names the lenses and custom indices it would affect. It proceeds only
when the caller asks for it a second time, explicitly; the consented change then prunes
the indices — deleting those left with nothing to read — so no definition ever reads
what no longer exists. Deleting a custom index a lens includes asks the same consent.
Managed indices are never part of it: they follow the schema by themselves.

**Every entity type has exactly one name property.**
It is a `string` property of that type, created with the type, reassignable to another
`string` property of the type, and never removable while it is the name property — the
server never picks a replacement. Clients label an entity by its name property's value
alone, so a label never depends on guessing which property names a thing. Where data
predates name properties — older storage, a previous-version transfer payload — one fixed
derivation assigns it, and that derivation is used nowhere else.

**Search indices are ontology-level design objects; lenses include them.** An index is
defined and stored once per ontology and serves every lens: a custom index is defined by
a modeler in modeling, a managed one derived by the server. An unscoped lens searches
every index; a scoped lens only the indices it includes, and only while it exposes their
root entity type. Index inclusions never make a lens scoped. Lenses only subtract: a
lens-owned index would duplicate entries and embedding cost across lenses and vanish with
its lens without consent, while an index visible to every lens would expose content over
types a scoped lens hides. Deliberation:
[adr/0022](adr/0022-search-indices-ontology-level-included-per-lens.md).

**Every entity type has a managed default index, and every document property a managed
passage index; managed indices follow the schema.** The default index covers the type's
own `string` properties; the passage index holds the document's chunks headed by the
entity's name, and its entries are the only place chunks are kept. Their keys are
`<entityTypeKey>~default` and `<entityTypeKey>~<documentPropertyKey>`: `~` occurs in no
key pattern, so a managed key never collides with a chosen one, whereas `:` already marks
a direction in query paths. The server derives both from the schema on every schema change, creates,
updates and deletes them without a consent step, and includes a new one in every scoped
lens exposing its root type — a passage index only where the lens also shows its document
property, so a scoped lens is never handed a way to find entities by text it hides. They
cannot be edited, only switched off, and have no relation groups — relations enrich an
entity only through a custom index. Search works with no index configuration, and a schema change can never leave search reading a stale
field list.

**A search entry holds at most one relation instance; entries never combine relations.**
An entity's own fields form one entry; each relation instance, with the entity at its
other end, forms one entry of its own, headed by the entity's own header fields. The best
entry decides the entity's score. A fact spread over two relations is answered by an
exact filter or by fusing rankings at entity level, never by one entry. Combinations would
multiply, nobody can say which make sense, and one change would re-embed every combination
containing it; kept apart, each relation's facts stay separately rankable, and a lens that
hides a relation type or target type skips those entries at query time, with no rebuild
and no hidden facts inside a combined vector. Deliberation:
[adr/0023](adr/0023-one-search-entry-per-relation-instance.md).

**A relation group reaches one hop.** A custom index follows its root entity's relations
to the entities at their other end, nothing further. Each group already multiplies a
root type's entries by about one plus its degree, and a change of a related entity
queues every relation pointing to it; a further hop would multiply both again.

**Relation and passage entries start with a header of the entity's own fields; relation
groups follow either direction.** The header defaults to the entity type's name property
and is configurable per custom index, so an entry about one relation still matches
together with whose relation it is, while each relation keeps an entry of its own. A
group follows outgoing or incoming relations, so a type can be found by the relations
that point to it.

**A cost preview and per-index limits control indexing cost, not an index count.** A
custom index reads at most 12 fields — own, relation and target fields together, the
header not counted — and holds at most 4 relation groups. There is no cap on the number
of indices. Entries, not indices, drive cost: one index with an incoming group on a hub
type can outweigh many small ones, so modeling estimates the entries and build time of
a definition at the measured throughput before it is saved. The field cap bounds entry
text, which dilutes a vector as it grows, and keeps definitions readable; each relation
group multiplies entries, and four is generous.

**A lens may search an index that reads properties it hides; validation warns, results
are projected and the snippet withheld.** Entries are composed from the full schema, so a
hidden value can still drive a ranking through that lens — accepted, as two lenses share
one stored record. Lens validation names every hidden property an included index reads as
a warning, which never makes the lens invalid. The lens still governs everything
returned: hits are projected through it, and a match whose index reads a hidden property
carries no snippet of the entry's text.

**Retriever agents are a lens-local resource that searches search indices.** Each has a
key, name, description, configuration version and configuration; keys follow the shared
key rules and are unique within the lens. A save is validated against the lens and
refused when invalid; a stored agent that later becomes invalid stays readable and
exportable, nothing cascades to it, and a question to it is refused. Copying creates an
independent identity; moving within the same ontology keeps it and is atomic. Neither
overwrites a target key, and both validate the target lens. Cross-ontology portability is
an explicit JSON copy validated in the target, never a shared live definition. Agents
travel with their lens in design transfer and are deleted with it. Storage carries no
vectors, snapshots, credentials or conversation state. Only an adapter that stores search
indices keeps agents.

**A retriever agent finds through search indices and embeds nothing of its own.** Its
configuration references indices, optionally narrowed to their relation groups; a fact of
a relation is found by the planner choosing a relation group per question, and an exact
structural condition is a filter of up to two hops. Answer fields, answer-field length and
the similarity threshold are the agent's own settings. Retrieval runs the index search in
process — no per-agent vectors, no in-memory vector cache, no preparation step and no
snapshot of the data. A question makes two model calls, planning and answering;
retrieval between them is deterministic, and cancellation stops further work. No model
call is retried automatically, with one exception: a follow-up whose plan searches
nothing and only names an unsupported reason is planned once more, the second plan is
used, and a limitation says so — at most three model calls. The planner phrases queries
freely, may name an entity taken from an answer, but chooses only what the configuration
allows, and every exact restriction — a filter value, a reference to previous results —
needs the user's own words, never an answer's; the server leaves out what fails these
checks, names it as a limitation and answers with the rest.

**Exactly one env file is read, and it is always named.**
`ENV_FILE` names it; without that it is `.env` in the working directory. Files never
layer: a second file cannot quietly supply what the first omits, and a named file that is
missing fails the boot rather than falling back to the built-in defaults. A variable
already set in the real environment still wins, because that is what a shell variable is
for. Development presets are committed under `env/` and passed to `./dev.sh`, so no
launcher script carries configuration values of its own — a value that decides how the
system runs must be readable in a file, not buried in a script that silently outranks one.

**One embedding model per server; each semantic generation records the model it was
built with.** Search merges indices by similarity, which is one scale only under one
model. A changed model builds new semantic generations of every index beside the ready
ones, which keep serving until replaced. Without configuration the model is `bge-m3` at
1024 dimensions — multilingual, because an ontology's content may mix German and English.

**Model thinking effort is one deployment setting, not a per-agent one.**
`AI_REASONING_EFFORT` fixes how hard the model thinks for every AI call the server makes,
and is validated at startup rather than per request — an unknown level is a boot failure,
not a failed inference. Effort is a property of the deployment's latency and cost budget,
not of any one lens or agent, and a level a given model ignores would otherwise look like
a broken agent configuration rather than a model limitation.

**Vector index width drift is reported at startup and repaired only on request.**
An index fixes its width when created, so a changed embedding model leaves indexes that
cannot accept vectors at the new width. Startup warns per mismatch and names the remedy.
It does not repair, because repair means dropping the index and re-embedding everything it
covered — downtime and one model call per stored item, which no adapter may spend unbidden.
The stored vectors are never at stake: they live in the store's own column, not in the
index. The search-data rebuild does repair, because
there the caller has asked for exactly that.

**Repair is three phases, in this order: drop, regenerate, build.** A drifted index
cannot be dropped and rebuilt in one step. While it stands it rejects vectors of the new
width, so the vectors cannot be regenerated underneath it; and it cannot be built over
vectors of the old width. Rebuild therefore drops every mismatched index first, then
regenerates every vector, then builds the indexes it dropped. An index whose width
already agrees is never dropped, so a rebuild without drift loses none. Between the first
and third phase the ontology has no semantic index — a rebuild that dies in between
leaves them absent and its vectors of mixed width, which the next completed rebuild
repairs.

**A stored chunk vector is reused only at the configured provider's width.** In an
adapter's own search storage, reuse is keyed by content — an unchanged document chunk
keeps its vector — but a vector of any other width came from a different model and no
index of the current width can be built over it, so it is always recomputed. Without
this, a rebuild after a model switch would regenerate nothing for document chunks: their
text is unchanged, so every one of them would be reused. Search-index entries need no
such rule: an entry's text hash covers the model.

**A failed index ensure never stops the boot.** Startup reports the ontology it could not
bring into line, in API vocabulary, and carries on with the rest. The state that makes an
ensure fail is an unfinished rebuild, and refusing to start would take away the server
the operator needs in order to finish it.

## Scope

**Hard cut** — the multi-ontology system replaces the single-schema system with no
migration and no compatibility: it begins on a fresh database (no data migration
from single-ontology deployments), old REST/MCP paths are removed without aliases,
no default ontology exists, and it ships as a major version bump. Deliberation:
[adr/0018](adr/0018-multi-ontology-hard-cut.md).

**Transfer scope** — export and import carry one ontology's design: schema, lenses,
and their agents, saved queries and retriever agents, the keyword language set, and the custom
search indices with the managed indices switched off. Never
instance data, never the ontology's identity. A transfer document is portable into any
ontology.

**Transfer target** — import writes into an existing ontology named by the request;
creating the ontology is a registry operation. Key conflicts are checked all-or-fail
against the target ontology's keys.

**Transfer format version** — the format version is the format's own line,
independent of the project version, bumped only when the payload shape changes
incompatibly. Export writes the current version. Import dispatches on it: it accepts the
current version, an absent version as the current one, and the previous major version,
which it converts on the way in; every other version is refused. Supporting exactly one
previous version lets a design exported before a format change move to a server after it
without a conversion tool.

**No authentication, authorization or multi-tenancy.**
OntoForge assumes it is deployed behind something that provides them, or on a trusted
network. Ontologies are isolation units, not tenants: no ontology has an owner, an ACL
or a quota. Building a permission model before a deployment requires one would be
guessing at its shape.

## Retrieval evaluation dataset

**The fair evaluation ontology stores stand numbers on exhibitors.**
A hall is its own entity, linked to the exhibitor; the stand number is an exhibitor
property. This keeps exact hall filtering explicit without introducing a separate
stand entity into the evaluation dataset.

