# Architecture

How OntoForge is put together. Concepts and vocabulary: [README.md](README.md). The rules
this document obeys: [decisions.md](decisions.md).

This document is deliberately free of language and framework detail. Everything here
should hold for a reimplementation in any language.

## Components

Four parts, two processes.

**Server** — one deployable unit. Serves the modeling API, the runtime API, both MCP
servers and the OpenAPI description. There is no mode switch and no partial deployment:
every instance serves everything.

**Web client** — a separate static application talking to the server over REST only. It
holds no privileged path; anything it does can be done over the API.

**Database** — one instance, holding schema and instance data together. Reached only
through the persistence port.

**Storage adapter** — the single active implementation of that port. See
[storage-adapters.md](storage-adapters.md).

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
        │        modeling │ runtime             │
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

Three modules, with a deliberately acyclic dependency graph:

```
   modeling ──▶ core ◀── runtime
```

**Modeling** owns the global schema: types, properties, lens definitions, cascade rules,
schema validation, transfer, embedding rebuild.

**Runtime** owns instance data: entity and relation lifecycle, traversal, documents,
search, query execution, saved-query pipelines, agents.

**Core** owns what both need and neither should define twice: the persistence port, the
exception taxonomy, the transfer format, the data-type enumeration, the embedding
provider abstraction, and OQL parsing and validation.

**Runtime never depends on modeling.** Everything runtime needs about the schema, it
reads through the port. This keeps the schema a *value* to runtime rather than a service
it calls, which is what makes the schema cache possible.

## Logical data model

Physical representation is the adapter's business; this is the logical shape.

### Schema level

| Kind | Identity | Notable fields |
|---|---|---|
| Ontology | id, unique `key`, unique name | name, description, timestamps |
| Entity type | id, globally unique `key` | display name, description, timestamps |
| Relation type | id, globally unique `key` | display name, source and target entity type keys |
| Property definition | id, `key` unique within its owner | data type, required, default; owned by exactly one entity type or relation type |
| Inclusion | ontology + type | optional property allowlist; absent means all properties |
| Agent config | ontology + `key` | name, description, system prompt, tool allowlist |
| Saved query | ontology + `key` | name, description, ordered steps, parameters, bindings |

Ontologies, agent configs and saved queries are the three things that belong *to a lens*.
Types and properties never do.

### Instance level

| Kind | Identity | Notable fields |
|---|---|---|
| Entity | `_id` | its type key, plus the properties its type defines |
| Relation | `_id` | its type key, its two endpoint ids, plus its properties |
| Chunk | internal | fragment of one document property, with its offset and length |

System properties are server-managed, always readable, never writable: `_id`,
`_createdAt`, `_updatedAt`, plus `_entityTypeKey` on entities and `_relationTypeKey` on
relations. They are distinguished by a leading underscore, and since no user-defined key
may begin with one, the namespaces cannot collide.

That separation rests entirely on the key pattern being enforced, and one entry point does
not enforce it — see the invariants below.

Relation endpoint ids are the exception to the underscore convention: reads return them as
`fromEntityId` and `toEntityId`, without a prefix, even though they are as
server-managed as any other system property.

Embedding vectors and document length bookkeeping are internal. They are stored, but
never appear in a response.

### Invariants

Enforced in the service layer on every write path, whichever interface it arrived by. This
is the summary; each one is stated with its consequences in
[capabilities/schema-modeling.md](capabilities/schema-modeling.md).

- Type and property keys match `^[a-z][a-z0-9_]*$` on every path that sets them — the
  modeling interfaces and import alike.
- Entity type keys, relation type keys, ontology keys and ontology names are globally
  unique. Property keys are unique within their owning type.
- A relation type may only be created if both endpoint entity types exist.
- An entity type cannot be deleted while any relation type references it.
- `document` properties are permitted on entity types only, on creation and on import.
- Type keys that would collide with the active adapter's own schema objects are rejected.
  The adapter declares the reserved set; the service enforces it. Pre-existing collisions
  are reported at startup, never silently rewritten.
- Relation endpoints are fixed at creation. Properties may change; endpoints may not.

## Ontology scoping

A lens with no inclusions exposes the whole schema. A lens with inclusions exposes
exactly what it declares, with one inference: naming entity types alone also admits the
relation types whose *both* endpoints are in scope, because a relation with an invisible
endpoint would be unusable. The full rules are in
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md).

Scoping cuts in three places: schema reads omit what is out of scope, writes reject it,
and read results are filtered — including individual columns of a query result.

One asymmetry is deliberate and easy to get wrong when reimplementing:

> **Writes validate against the scoped schema, but apply defaults from the full schema.**

Relation endpoint types are checked against the full schema for the same reason. The rule
and what it buys are in [decisions.md](decisions.md#behaviour); the three operations that
consult the full schema instead of the lens, and what each one costs a caller, are in
[capabilities/ontology-lenses.md](capabilities/ontology-lenses.md#the-lensfull-schema-asymmetry).

## Schema cache

Runtime reads the schema on nearly every request, so each lens is assembled once and held
in memory: its scoped schema, the full schema, its agent configurations and its saved
queries.

The cache is built lazily per lens and cleared wholesale by any modeling mutation.
Wholesale rather than selective, because a single schema change can affect many lenses
and the cost of rebuilding is small.

It is **per process**. Multiple server instances against one database will not see each
other's schema changes until each rebuilds — a real constraint on horizontal scaling that
no interface currently exposes.

## Request lifecycle

A runtime write, which is the longest path:

```
  request
    → parse and validate shape
    → resolve ontology key to its lens
    → load lens from schema cache (build on miss)
    → reject unknown properties; check required; apply defaults
    → coerce each value to its declared data type
    → embed text if a provider is configured
    → cross the persistence port
    → adapter compiles and executes
    → filter response to the scoped properties
    → stub documents, apply field projection
  response
```

Two properties of the validation step are contractual rather than incidental, and both are
rules rather than implementation choices:

**All errors are collected, not the first one** — [decisions.md](decisions.md#behaviour).

**Coercion is strict.** Values are converted, never guessed. What each data type converts
and what it refuses is in
[capabilities/schema-modeling.md](capabilities/schema-modeling.md#data-types).

## Error model

Every error response has the same envelope:

```json
{ "error": { "code": "...", "message": "...", "details": { } } }
```

There are exactly six top-level codes:

| Condition | Status | Code | `details` |
|---|---|---|---|
| Resource does not exist | 404 | `RESOURCE_NOT_FOUND` | — |
| Uniqueness or referential conflict | 409 | `RESOURCE_CONFLICT` | — |
| Input rejected | 422 | `VALIDATION_ERROR` | `fields` map or `errors` list |
| Change requires explicit cascade | 409 | `CASCADE_REQUIRED` | `affectedOntologies` |
| Unexpected storage failure | 500 | `STORAGE_ERROR` | `errorId` |
| Malformed request body | 400 | `INVALID_JSON` | — |

Two refinements:

**`details.code` narrows, it does not replace.** Where it appears, the top-level code
stays one of the six. A request for semantic search or saved-query search with no
embedding provider configured — or an AI request with no language-model provider
configured — answers `422 VALIDATION_ERROR` with `details.code` of `FEATURE_DISABLED`.

**`STORAGE_ERROR` carries an id, not a cause.** A driver message names the vendor and its
physical objects, which must not reach a client. The adapter logs the original against a
generated `errorId` and returns only that id, so a reported failure can still be traced to
its server-side record.

## Startup

Ordered, and failure at any step prevents serving:

1. Connect storage, verify reachability, ensure constraints and indexes exist.
2. Report any stored type key that the adapter now reserves.
3. Initialize the embedding provider, if configured.
4. Initialize the language-model provider, if configured.
5. If embeddings are enabled, reconcile vector index widths against the provider and warn
   on mismatch — see [capabilities/search.md](capabilities/search.md).
6. Start both MCP servers.

Note step 5 warns and does not repair — deliberately, for the reason given in
[decisions.md](decisions.md#behaviour). Rebuild is where repair happens.

## Configuration

Environment supplies all configuration. There is no configuration file and no per-tenant
configuration.

| Group | Purpose | Absent means |
|---|---|---|
| Storage | Which adapter, and how to reach the database | Server cannot start |
| Embedding | Provider, model, endpoint, credential, vector width | Semantic search unavailable |
| Documents | Chunk size and overlap | Defaults apply |
| Language model | Provider, model, endpoint, credential | AI capabilities unavailable |
| MCP | Fallback ontology key | Clients must supply a key themselves |
| Public URL | Base address advertised in agent cards | Cards advertise a local address |

Exact variable names are in the repository README; they are deployment surface, not
architecture.

## What the architecture does not provide

Stated plainly, because their absence is a design position and not an oversight:

- **No authentication or authorization.** Every caller has full access. OntoForge is
  deployed behind something that provides this, or on a trusted network.
- **No multi-tenancy.** One schema, one dataset per deployment.
- **No cross-process cache coherence**, as described above.

Absences in the API surface itself — no health probe, no bulk write, no instance-data
export — are listed with their consequences in
[interfaces.md](interfaces.md#what-is-not-exposed).
