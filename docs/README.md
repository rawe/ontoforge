# OntoForge

OntoForge is a graph-native ontology studio. Design an ontology, then use its schema
through generic APIs and a web application.

## Choose a reading path

| I want to… | Read |
|---|---|
| Understand OntoForge | [Concepts](concepts.md), the [glossary](glossary.md), then [architecture](architecture.md) for how it is built |
| Use OntoForge | The [project README](../README.md) to get running, the [web UI guide](product-surface.md) or relevant capability below, and [interfaces](interfaces/README.md) for REST and MCP |
| Change OntoForge | Read the [architectural constraints](architecture-constraints.md), then the documents owning the affected behavior; use [contributor workflows](workflows/) for the task |

## Documentation map

| Document | Answers |
|---|---|
| [Project README](../README.md) | Getting started, configuration and development setup |
| This file | Reading paths and where to find details |
| [Concepts](concepts.md) | The mental model: ontologies, lenses, modeling and runtime |
| [Glossary](glossary.md) | The vocabulary used throughout the system |
| [Architectural constraints](architecture-constraints.md) | Essential boundaries to read before changing system behavior |
| [architecture.md](architecture.md) | System components, boundaries, invariants and flows |
| [Runtime state implementation](implementation/runtime-state.md) | Contributor details of cache capacity, turn leases and navigator execution |
| [interfaces/](interfaces/README.md) | REST surfaces and MCP tools; exact schemas are in OpenAPI |
| [storage-adapters.md](storage-adapters.md) | Persistence contract and PostgreSQL adapter |
| [product-surface.md](product-surface.md) | Web UI screens and interactions |
| [capabilities/](capabilities/) | One document per capability, end to end |
| [workflows/](workflows/) | Procedures for working *on* OntoForge |
| [adr/](adr/) | The alternatives weighed behind a decision |

For contributors, [writing documentation](workflows/documenting.md) explains how to add
or change a page and how to review a move. [Recording architectural decisions](workflows/recording-decisions.md)
says where a decision is written down and when it gets an ADR.
For MCP and agent tool authors, [writing tool descriptions](workflows/writing-tool-descriptions.md)
covers the description contract and its checks.
[Naming concepts and keys](workflows/naming.md) covers vocabulary across layers and shared
validation rules for keyed resources.

Capability documents explain feature behavior, rules, limits and how to reach it. The
interface and product documents describe the corresponding API and UI surfaces; the
capability remains the home for what the feature means.

## Capabilities

| Capability | Covers |
|---|---|
| [schema-modeling](capabilities/schema-modeling.md) | Entity types, relation types, properties, cascade protocol |
| [ontology-lenses](capabilities/ontology-lenses.md) | Scoping a lens to part of an ontology's schema |
| [instance-data](capabilities/instance-data.md) | Creating, reading and traversing entities and relations |
| [documents](capabilities/documents.md) | Long-text properties, stubs and partial edits |
| [search](capabilities/search.md) | Literal matching and ranked search |
| [search-indices](capabilities/search-indices.md) | What ranked search reads: indices, entries, managed and custom indices, cost preview and entry outline, generations and build status |
| [oql](capabilities/oql.md) | The query language |
| [saved-queries](capabilities/saved-queries.md) | Stored, parameterized query pipelines |
| [agents](capabilities/agents.md) | Agents — assistants that answer by working with read-only tools: configuration, tool rules, live tool activity, the default agent |
| [navigators](capabilities/navigators.md) | Navigators — assistants that answer by walking the lens's graph: configuration, the pipeline of a turn, what the client sees, the default navigator |
| [retrievers](capabilities/retrievers.md) | Retrievers — assistants that answer from a lens's search indices: configuration, validation, planning, retrieval, retrieve, diagnostics, the default retriever, portable JSON |
| [threads](capabilities/threads.md) | Server-held assistant conversations: starting, continuing and reading a thread, atomic turns, lifetime |
| [entity-identity](capabilities/entity-identity.md) | Ids and identities: declaring an identity, its text form, uniqueness, addressing by identity, renames, lenses, changesets |
| [entity-identity-comparison](capabilities/entity-identity-comparison.md) | Optional judgments about two partial entity snapshots |
| [transfer](capabilities/transfer.md) | Schema export and import |
| [rulesets](capabilities/rulesets.md) | Rulesets — named records holding the rules for the MCP clients of one URL: the record and its maintenance, ruleset mounts, write access, the anchor |
| [changesets](capabilities/changesets.md) | Changesets — runtime writes staged over time and committed all or nothing: staging into a set of objects and values, the commit and its validation, binding, the review |
| [bulk-inserts](capabilities/bulk-inserts.md) | Loading many entities and relations through changesets: lists of calls, puts by identity, chunks, failures and reruns, review |
| [authentication](capabilities/authentication.md) | Signing in through an OpenID provider, roles on the platform, an ontology or a lens, what a caller sees, user management, authentication off |

## Internal provider interfaces

- **[Decision API](providers/decision-api.md)** — Optional internal client for typed
  decisions, used by entity identity comparison.
