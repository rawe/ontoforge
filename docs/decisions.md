# Rules

This is a temporary collection of current design rules and links to their detailed homes.
Rules still stated here remain in force. The destination is to move every remaining rule
to its owning architecture, capability, interface or operational document, and then retire
this file once its content and references have been accounted for. No rule is intended to
live here permanently. Do not add new rules here: document current behavior at its owning
home, and preserve each existing rule's meaning and update its references when moving it.

Not every choice needs an entry here or an ADR. The threshold for recording consequential,
hard-to-reverse architectural choices is in
[workflows/recording-decisions.md](workflows/recording-decisions.md).

## System shape

[Components](architecture.md#components) describes the full server deployment and
shared stores: the schema and the data it governs must not diverge across servers, nor
may one server open what another protects. One ontology database holds schema and
instance data; two stores would turn schema changes into distributed transactions to buy
an isolation nothing needs. Separating schema and instances inside the database is the
adapter's business.

[Bounded contexts](architecture.md#bounded-contexts) explains why runtime reads schema
as a value through the port rather than depending on modeling, allowing it to cache a
lens.

## Naming

**One name per concept across modules, routes and stores, with no synonyms.** One name lets
a concept be followed from route to storage; the web client may use its own product names.

**The runtime and MCP surfaces address every schema and design object by key, never by
internal identifier.** A language model should never have to carry an opaque identifier to
name a type; the modeling REST surface may use identifiers because its client has just
listed what it addresses.

**One key rule per level, never per resource: each level's keys have one pattern, defined
once in the server and mirrored once in the client.** A new keyed resource takes the rule
of its level, so every check, error message and tool description refers to one definition.

**No vendor or implementation-language vocabulary anywhere a caller can see; a rejected
value is named by its JSON type.** Naming the database or the server's language in a route,
field, tool or error message would leak a detail that callers come to depend on.
See [interface error conventions](interfaces.md#errors) for the distinction between
expected schema types and received JSON types.

**A rename of a name on the API, MCP or configuration is a hard cut, with no deprecated
alias or second spelling; stored data and transfer payloads are upgraded instead.** Two
spellings for one thing double every check and leave callers unsure which is current.
→ [adr/0024](adr/0024-provider-base-urls-as-documented.md)

## Storage

[The persistence port and bound stores](storage-adapters.md#bound-stores-and-the-registry)
keep ontology operations isolated and database-specific details in the adapter. Registry
operations use a separate port. [Shared state](architecture.md#shared-state) is separate
from durable ontology data; it uses narrow interfaces and never silently falls back to
per-process memory. [Design revisions](architecture.md#design-revision) keep a write
validated against stale schema from committing.

**On PostgreSQL, each ontology lives in its own namespace, and `public` holds only
server-wide data.** Inside the adapter too, no query can reach another ontology's data by
forgetting a filter.
→ [adr/0017](adr/0017-postgres-namespace-per-ontology.md)

[Storage lifecycle](storage-adapters.md#lifecycle) defines the release's versioned layout,
startup upgrades, exceptions and compatibility requirements. An upgrade may cause
unavailability rather than requiring two releases to work on the same storage; additive
steps within a major release also let an older server left running by mistake still work.

[Port values](storage-adapters.md#what-crosses-the-port) keep filters, sorts and searches
structured and resolve query paths and relation conditions above the adapter. This keeps
fault reporting independent of storage and makes the lens the complete horizon for
resolving a path, independent of a database's query language.

**Driver exceptions never cross the port; an unanticipated storage failure surfaces as one
storage error carrying a generated id.** A driver message names the vendor and its physical objects, and
the id is what lets a reported failure be traced to the logged original.
→ [adr/0012](adr/0012-unexpected-storage-failures-become-storeerror.md)

**A violation of the entity identity unique constraint is translated into a conflict; it is
the one constraint violation that does not become the storage error.** Concurrent writes
can take one identity between the service's check and the write, and only the database
sees it; the caller must learn that the identity is taken, not that storage failed.
→ [adr/0012](adr/0012-unexpected-storage-failures-become-storeerror.md),
[adr/0033](adr/0033-identity-uniqueness-in-changesets-at-commit.md)

**PostgreSQL is the only storage adapter, and the port carries only what it needs.** Every
feature is built and tested once, against one implementation.
→ [adr/0025](adr/0025-postgresql-only-storage.md)

**The PostgreSQL adapter stores instance data in two generic tables with jsonb properties,
never a table per type.** A schema change stays pure data for instance storage, so no DDL
runs against a live database per type or property.
→ [adr/0015](adr/0015-generic-jsonb-instance-tables.md)

**Business rules validate in the service; storage DDL carries only primary keys, referential
integrity, exactly-one-owner and uniqueness, plus the search-index tables' checks on their
closed vocabularies.** Each business rule is enforced in one place, with no database
backstop.

[Search indexing](architecture.md#search-indexing) queues work in the write's transaction
in the same database; a worker in every server drains it without an external broker, so
the work is as durable as the write.

**PostgreSQL stems with its stock text-search configurations, with no added compound or
other dictionary.** A deployment then needs no custom database image.

## Interfaces

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

[Writing tool descriptions](workflows/writing-tool-descriptions.md) owns the rules for
self-contained, caller-facing descriptions, their character budget and the checks to run.

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

## Access

**OntoForge owns authorization: a principal is bound to a verified issuer and subject, and
its roles are assigned in OntoForge only, never derived from provider claims or an email
address.** A provider's groups, administrator flags and email addresses are outside
OntoForge's control and may change or be reused, granting access nobody assigned.

**One authorization service judges every entrance — REST, MCP and the tool calls of a
turn — and every route declares what it needs; a route without a declaration fails the
boot.** A check in one router leaves the other entrances open, and a forgotten route would
be open to everyone.

**No assignment means no access, and no role implies another: administering an ontology
grants no lens data, and a lens role no design.** Every right then traces to one
assignment, and revoking it takes away exactly that right.

**With authentication on, nothing falls back to off: missing configuration, an unreachable
provider or an unusable access database fails the boot, and a check that fails refuses.**
A server running unprotected by accident would expose every ontology while looking
healthy.

**The server is the browser's OpenID client and keeps browser sessions in shared state;
the browser holds only an HttpOnly cookie.** No provider token reaches a script in the
browser, no further component is deployed, and a lost session costs only a new sign-in.
→ [adr/0031](adr/0031-server-as-browser-openid-client.md)

**Principals, their identities and role assignments live in an access database of their
own, behind a port of their own beside the persistence port.** Who may do what must be
durable and independent of any ontology's storage, and moving it to its own instance
changes only its address.
→ [adr/0030](adr/0030-access-database-of-its-own.md)

## Schema and data

**A schema edit never writes instance data; the one exception is an entity's derived
identity, rebuilt when its type's identity changes.** Cleaning up instance data on a schema
change would turn a schema edit into a write over all of it; the identity is derived from
values a caller wrote and is never itself written by a caller.

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

## Entity identity

[Entity identity](capabilities/entity-identity.md) defines its declaration, uniqueness,
addressing and changeset behavior. IDs remain stable internal references; identities are
addresses derived from recognizable values. Separate ID and identity fields avoid
ambiguity, and a staged put resolves to an explicit create or update for review.

The reasoning behind the identity model is in [ADR 0032](adr/0032-entity-identity-as-ordered-property-list.md);
the commit-time uniqueness trade-off is in [ADR 0033](adr/0033-identity-uniqueness-in-changesets-at-commit.md).

## Query

[OQL](capabilities/oql.md) owns the language's GQL anchor and supported surface.
[Instance data](capabilities/instance-data.md#listing) describes filters, missing values
and query paths; [search](capabilities/search.md#scope-and-filters) describes their use
in search. The one-hop query-path decision is explained in
[ADR 0019](adr/0019-inline-query-paths-over-declared-query-fields.md).

## Search

[Search indices](capabilities/search-indices.md) own index composition, costs and
asynchronous lifecycle. [Search](capabilities/search.md) owns matching, ranking, evidence,
similarity floors and language handling. [Lenses](capabilities/ontology-lenses.md#search-through-a-lens)
explain how a lens limits search; [retrievers](capabilities/retrievers.md) describe their
own thresholds and fusion.

The reasoning behind these choices is in ADRs [0020](adr/0020-search-ranking-and-evidence.md)
(ranking and evidence), [0022](adr/0022-search-indices-ontology-level-included-per-lens.md)
(index ownership), [0023](adr/0023-one-search-entry-per-relation-instance.md) (relation
entries). The [keyword strategy](capabilities/search.md#strategies-and-availability)
explains the matching default and its trade-off.

## Deployment

Deployment configuration is documented in the root README:

- [Environment files](../README.md#development-setup), including shell precedence and
  missing-file behavior.
- [Provider base URLs](../README.md#optional-features); the alternatives are in
  [ADR 0024](adr/0024-provider-base-urls-as-documented.md).
- [Embedding model and semantic generations](../README.md#semantic-search).
- [Deployment-wide thinking effort](../README.md#ai-powered-runtime). Keeping it out of
  individual agents also avoids making a level a model ignores look like a broken agent
  configuration.

**Width drift of a vector index outside search indices is reported at startup and repaired
only by an explicit rebuild.** Repair drops the index and re-embeds everything it covered,
a cost and an outage no one asked for.
→ [adr/0013](adr/0013-semantic-index-width-drift-reported-at-startup.md)

**A failed index ensure never stops the boot.** The state that makes an ensure fail is an
unfinished rebuild, and refusing to start would take away the server needed to finish it.

**Probes and metrics share the client port and are open to the server's access rules;
keeping them internal is the ingress's job.** They are called by the platform on each
server directly, and one port with one exposure rule is simpler than a listener of their
own.

**A metric's labels never carry an ontology, lens, principal or raw path; requests are
labelled by route template.** The number of series then depends on the code alone, and
metrics reveal nothing about what any ontology holds.

## Scope

**Transfer moves one ontology's design into an existing ontology, never instance data and
never the ontology's identity.** A transfer document is then portable into any ontology
under any key, and creating an ontology stays a registry operation.

**Import upgrades an older transfer format step by step to the current one;
[transfer.md](capabilities/transfer.md#the-format-version) lists the versions it accepts.**
A design exported before a format change then moves to a later server without a
conversion tool.

**No multi-tenancy: ontologies isolate data but are not tenants and carry no quota.**
Tenancy built before a deployment needs it would guess at its shape.
