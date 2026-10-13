# Rules

The rules OntoForge is built on, as they hold today. How a rule is added, changed or
removed, and when it gets an ADR: [workflows/recording-decisions.md](workflows/recording-decisions.md).

## System shape

**One server serves everything: registry, modeling, runtime and both MCP servers, with no
mode switch and no partial deployment.** A schema change and the data it governs must never
be able to reach different servers.

**One database holds every ontology's schema and instance data.** Two stores would turn
every schema change into a distributed transaction to buy an isolation nothing needs.
Keeping schema and instances apart is the adapter's business.

**Runtime never depends on modeling; it reads the schema through the persistence port.**
The schema stays a value to runtime rather than a service it calls, which is what lets a
lens be cached.

## Naming

**One name per concept across modules, routes and stores, with no synonyms.** One name lets
a concept be followed from route to storage; the web client may use its own product names.

**The runtime and MCP surfaces address every schema and design object by key, never by
internal identifier.** A language model should never have to carry an opaque identifier to
name a type; the modeling REST surface may use identifiers because its client has just
listed what it addresses.

**One key rule per level, never per resource: schema keys and lens-resource keys each have
one pattern, defined once in the server and mirrored once in the client.** A new keyed
resource takes the rule of its level, so every check, error message and tool description
refers to one definition.

**No vendor or implementation-language vocabulary anywhere a caller can see; a rejected
value is named by its JSON type.** Naming the database or the server's language in a route,
field, tool or error message would leak a detail that callers come to depend on.
→ [adr/0014](adr/0014-received-values-named-by-their-json-type.md)

**A rename of a name on the API, MCP or configuration is a hard cut, with no deprecated
alias or second spelling; stored data and transfer payloads are upgraded instead.** Two
spellings for one thing double every check and leave callers unsure which is current.
→ [adr/0024](adr/0024-provider-base-urls-as-documented.md)

## Storage

**All storage access crosses the persistence port; everything database-specific lives in
the adapter.** Services, routers and MCP handlers then speak schema vocabulary only.

**Every operation on an ontology's design or data runs through a store bound to exactly one
ontology; registry operations live on a separate registry port.** Isolation is then structural above the
adapter rather than a filter a query could forget.

**Conversations live in one thread store per server, behind an interface of its own beside
the persistence port.** Conversation state is not ontology data: it is never exported,
never cascades and expires on its own, so it stays out of the port.

**On PostgreSQL, each ontology lives in its own namespace, and `public` holds only
server-wide data.** Inside the adapter too, no query can reach another ontology's data by
forgetting a filter.
→ [adr/0017](adr/0017-postgres-namespace-per-ontology.md)

**Storage carries its own version number, and the server upgrades older storage itself at
startup, before it serves.** Operators never run a migration by hand, and a server never
serves storage it does not understand.

**The release defines the storage layout, and only a storage-version upgrade changes it,
except for the vector indexes a rebuild recreates and each search-index generation's entry
storage.** The storage version then says which layout a server finds; the exceptions are
created and dropped by their own lifecycles.

**Within a major release line, upgrade steps only add; renaming, removing or rewriting
stored data waits for a major release, which keeps none of the earlier steps.** Servers of
the previous release keep working during a rolling update.

**Filters, sorts and searches cross the port as structured values, never as query text or
fragments.** Query syntax above the port would tie the services to one database's language.

**Query paths and relation conditions are resolved and validated above the port; the
adapter receives fully resolved conditions, never a key to interpret.** Resolving in one
place keeps fault reporting independent of storage and the lens a complete horizon.

**Driver exceptions never cross the port; an unanticipated storage failure surfaces as one
storage error carrying a generated id.** A driver message names the vendor and its physical objects, and
the id is what lets a reported failure be traced to the logged original.
→ [adr/0012](adr/0012-unexpected-storage-failures-become-storeerror.md)

**PostgreSQL is the only storage adapter, and the port carries only what it needs.** Every
feature is built and tested once, against one implementation.
→ [adr/0025](adr/0025-postgresql-only-storage.md)

**The PostgreSQL adapter stores instance data in two generic tables with jsonb properties,
never a table per type.** A schema change stays pure data for instance storage, so no DDL
runs against a live database per type or property.
→ [adr/0015](adr/0015-generic-jsonb-instance-tables.md)

**Business rules validate in the service; storage DDL carries only identity, referential
integrity, exactly-one-owner and uniqueness, plus the search-index tables' checks on their
closed vocabularies.** Each business rule is enforced in one place, with no database
backstop.

**Search work is a transactional outbox in the same database, drained by a worker in every
server process, with no external queue or broker.** Queued in the write's own transaction,
the work is exactly as durable as the write.

**PostgreSQL stems with its stock text-search configurations, with no added compound or
other dictionary.** A deployment then needs no custom database image.

## Interfaces

**Every ontology-scoped request names its ontology in the path and reaches either the design
(modeling) or, through one lens, the lens-scoped schema and instance data (runtime), never
both.** The address alone decides
which ontology and which side a request reaches, so isolation and the modeling/runtime
split need no header, default or check.

**`/api/server` holds only reads that describe the deployment; no operation there is
ontology-scoped or spans the data of several ontologies.** Every data operation belongs to
exactly one ontology.

**An MCP mount is bound to its ontology, and a runtime mount to its lens, by its URL alone;
no tool takes an ontology parameter and no MCP surface manages ontologies, except the
modeling mount's argument-less `ensure_ontology` for its own ontology.** A bound client
cannot reach, list or infer another ontology, by construction rather than by checks.
→ [adr/0016](adr/0016-mcp-url-only-binding.md)

**MCP runs in the server process and calls the services directly, over stateless HTTP with
plain JSON responses.** MCP then shares the services' one contract and keeps no
per-connection state, so one mount serves any number of HTTP clients.
→ [adr/0005](adr/0005-mcp-in-process-stateless-http.md)

**Two MCP servers, one for modeling and one for runtime.** As in REST, no client can reach
both through one connection.

**An MCP or agent tool description states every rule of its own parameters and never
defers one to another tool, which it may name only as a next step.** Tools are loaded and
enabled one at a time, so a description that leans on another is incomplete the moment
that tool is absent.

**A tool description is at most 2000 characters, met by tightening the text, never by
pointing at another tool.** Clients cut longer descriptions without notice, and everything
after the cut is invisible to the caller.

**A tool description carries caller-facing facts only: what a call accepts, what it returns
and how it behaves.** Backend, storage and ranking internals mean nothing to the caller,
and a rejection message already says what to do instead.

**Agents are read-only: no write tool is grantable to an agent.** An agent acts on a
model's judgment, and a write would change data on a guess.

**Every REST assistant chat answers as one NDJSON stream, with no non-streaming mode, and a
closed connection cancels the turn.** Tool activity is visible while the turn runs, and
work nobody will receive stops.
→ [adr/0021](adr/0021-rest-chat-tool-streaming.md)

**Every assistant kind streams the entities its turn met as the one shared `entities`
event; a kind's own events and its tool events never carry entity cards.** Chat, citations
and the Explorer then treat every assistant alike, and tool activity stays generic.
→ [adr/0027](adr/0027-one-shared-entities-event.md)

## Schema and data

**A schema edit never writes instance data.** Cleaning up instance data on a schema change
would turn a schema edit into a write over all of it.

**Entity identity comparison is advisory: it never writes, merges, selects or ranks
entities.** Its probabilities are model judgments, not calibrated guarantees, so acting on
them automatically would change data on a guess.

**Validation collects every error before answering.** A caller corrects a rejected write or
read in one round trip instead of discovering faults one at a time.

**Writes validate against the lens; defaults come from the full schema.** Otherwise a
narrow lens could create data that is invalid under a wider one.

**A schema change that would invalidate a lens or remove what a custom search index reads
is refused until the caller consents explicitly.** No definition may silently end up
reading what no longer exists, and the caller sees what a change breaks before it happens.

**Every entity type has exactly one name property, which cannot be removed while it is
one; the server never picks a replacement.** Clients label an entity by that property's
value alone, so a label never depends on guessing which property names a thing.

## Query

**OQL is anchored to ISO GQL and its GPML pattern sublanguage, never to a vendor dialect;
where the implementation and the standard disagree, the standard wins.** A vendor dialect
would tie the language to one database; the parser's grammar is openCypher-shaped, but GQL
decides what is correct.

**OQL's surface is a closed enumeration, enforced fail-closed at validation above the
persistence port.** A construct the grammar parses but the enumeration does not name is
rejected, so the contract, not the database, decides what a query may do.

**A filter key on the entity list or search may cross at most one relation, resolved
against the lens-scoped schema at query time and declared nowhere.** One hop removes the
pressure to flatten relations into properties; longer paths belong to OQL and to a
retriever's configured filters.
→ [adr/0019](adr/0019-inline-query-paths-over-declared-query-fields.md)

**Filter conditions are existential and never match a missing value; absence is asked only
by an existence test.** No operator carries null semantics, and an absent relation is a
filter rather than a stored flag that must be kept consistent.

## Search

**Search-index entries are built asynchronously, so search over them is eventually
consistent.** Building entries, embedding included, never delays or fails the write that
caused them.

**The entity list filters and ranked search ranks; neither falls back to the other.** A
caller always knows whether it holds an exact set or ranked candidates.

**Search indices are ontology-level design objects; a scoped lens searches only the indices
it includes.** Lenses only subtract, so an index is built and stored once and each lens
chooses what it may search.
→ [adr/0022](adr/0022-search-indices-ontology-level-included-per-lens.md)

**Managed indices are derived from the schema by the server and cannot be edited, only
switched off.** Search works with no index configuration, and a schema change can never
leave search reading a stale field list.

**A search entry holds at most one relation instance; entries never combine relations.**
Kept apart, each relation stays separately rankable and lens-hideable at query time without
a rebuild.
→ [adr/0023](adr/0023-one-search-entry-per-relation-instance.md)

**A relation group reaches one hop.** Each group already multiplies a type's entries by
about one plus its degree, and every change of a related entity re-queues the relations
pointing to it; a further hop would multiply both again.

**Indexing cost is bounded per index and previewed before saving, never by capping how many
indices an ontology has.** Entries, not indices, drive cost: one index with an incoming
group on a hub type can outweigh many small ones.

**What an index holds is shown only by the server's own composition, run on stand-in
values.** No client re-implements composition, so what a modeler sees cannot drift from
what is embedded and matched.

**A lens may rank on values it hides through an included index, but never returns them.**
Entries are composed once from the full schema and shared by every lens; per-lens entries
would multiply storage and embedding cost.

**A hit's relative score is comparable only within its response, and its evidence reports
only what was measured: never an unevaluated negative, the retrieval method that found it
or the property that caused a match.** A caller, a model above all, would otherwise read a
score as confidence and a missing signal as a non-match.
→ [adr/0020](adr/0020-search-ranking-and-evidence.md)

**Ranked search merges index rankings by score within one retrieval method and fuses only
the methods, by reciprocal rank.** Being found by several indices never adds up, so an
entity is not favoured because its type has a document property.
→ [adr/0020](adr/0020-search-ranking-and-evidence.md)

**Keyword entry text holds values only, never schema keys or labels.** Otherwise a schema
name would count as matching content.
→ [adr/0020](adr/0020-search-ranking-and-evidence.md)

**Search returns candidates, not a verdict that an answer exists: ranked search over REST
applies no similarity floor unless the caller sets one, and only the MCP and agent search
tools apply a fixed one.** Similarity is model-specific, not calibrated confidence, so only
the caller can judge where to cut; a model client gets a fixed floor because it cannot
judge raw scores.
→ [adr/0020](adr/0020-search-ranking-and-evidence.md)

**Any-term keyword matching is the default; every other keyword matching is a strategy of
its own, never a parameter beside the strategy.** A conjunction lets one absent term empty
the result, which in a compounding language is ordinary, because stemming reduces neither
compounds nor derivations.
→ [adr/0026](adr/0026-any-term-keyword-matching.md)

**Keyword entries and queries are stemmed in every language of the ontology's keyword
language set, and no request names a language.** The language of a query is unknown and an
ontology's content may mix languages; matches across languages are left to semantic
ranking.

**A retriever ranks only through search indices, under its own configured threshold and
fusion, and stores nothing but its configuration.** No per-retriever vectors, caches or data
snapshots exist that could drift from the indices; the floor and fusion rules above govern
search, not a retriever's pipeline.

## Deployment

**Exactly one env file is read, and a named file that is missing fails the boot.** Files
never layer and no launcher script carries configuration values, so no value comes from a
file nobody looked at; a variable set in the shell still wins.

**A provider's base URL is written as the provider documents it, and a wrong form fails the
boot.** A misplaced API path would otherwise surface only as a 404 on the first model call.
→ [adr/0024](adr/0024-provider-base-urls-as-documented.md)

**One embedding model per server; every semantic generation records the model it was built
with.** Search merges indices by similarity, which is one scale only under one model.

**Model thinking effort is one deployment setting, validated at boot, never per agent.**
Effort is a matter of the deployment's latency and cost budget, and a level a model ignores
would otherwise look like a broken agent configuration.

**Width drift of a vector index outside search indices is reported at startup and repaired
only by an explicit rebuild.** Repair drops the index and re-embeds everything it covered,
a cost and an outage no one asked for.
→ [adr/0013](adr/0013-semantic-index-width-drift-reported-at-startup.md)

**A failed index ensure never stops the boot.** The state that makes an ensure fail is an
unfinished rebuild, and refusing to start would take away the server needed to finish it.

## Scope

**Transfer moves one ontology's design into an existing ontology, never instance data and
never the ontology's identity.** A transfer document is then portable into any ontology
under any key, and creating an ontology stays a registry operation.

**Import upgrades an older transfer format step by step to the current one;
[transfer.md](capabilities/transfer.md#the-format-version) lists the versions it accepts.**
A design exported before a format change then moves to a later server without a
conversion tool.

**No authentication, authorization or multi-tenancy: ontologies isolate data but have no
owner, ACL or quota.** OntoForge runs behind something that provides them or on a trusted
network, and a permission model built before a deployment needs one would guess at its
shape.
