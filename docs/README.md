# OntoForge

OntoForge is a graph-native ontology studio. You design a graph schema, then use it
through generic, schema-driven APIs — no per-schema code is written or generated.

One server holds many **ontologies** — totally isolated units, each with its own schema,
lenses, saved queries, agents and instance data. Within an ontology the system has two
halves. **Modeling** designs that ontology's schema. **Runtime** reads and writes its
instance data through one lens. Both run in one server, over one database, and are
reachable over REST, over MCP, and through a web UI.

## Documentation map

| Document | Answers |
|---|---|
| This file | What OntoForge is · core concepts · glossary |
| [architecture.md](architecture.md) | How the system is put together |
| [interfaces.md](interfaces.md) | Every REST endpoint and MCP tool |
| [storage-adapters.md](storage-adapters.md) | What a storage backend must implement |
| [product-surface.md](product-surface.md) | What the web UI does |
| [decisions.md](decisions.md) | Rules that constrain all of the above |
| [capabilities/](capabilities/) | One document per capability, end to end |
| [workflows/](workflows/) | Procedures for working *on* OntoForge — testing, releasing |
| [adr/](adr/) | Archived decision records — history, not current documentation |

Everything above `workflows/` describes what OntoForge **is**, and is written to hold for
a reimplementation in any language. `workflows/` describes what to **do** in this
repository, and is specific to it.

Each capability document answers the same three questions: what the capability does,
what rules bind it, and how it is reached from every interface.

| Capability | Covers |
|---|---|
| [schema-modeling](capabilities/schema-modeling.md) | Entity types, relation types, properties, cascade protocol |
| [ontology-lenses](capabilities/ontology-lenses.md) | Scoping a lens to part of an ontology's schema |
| [instance-data](capabilities/instance-data.md) | Creating, reading and traversing entities and relations |
| [documents](capabilities/documents.md) | Long-text properties, stubs and partial edits |
| [search](capabilities/search.md) | Text matching and semantic retrieval |
| [oql](capabilities/oql.md) | The query language |
| [saved-queries](capabilities/saved-queries.md) | Stored, parameterized query pipelines |
| [ai-agents](capabilities/ai-agents.md) | Natural-language querying, extraction, chat, A2A |
| [transfer](capabilities/transfer.md) | Schema export and import |

## The central idea

Most graph tooling ties a schema to an application: you model `Person` and `Company`,
then write code that knows about people and companies. OntoForge does not. The schema is
data, and the API is generic over it. Creating an entity type immediately produces a
working CRUD surface, a query surface, a search surface and an MCP tool set for it —
without a deployment.

Two consequences follow, and they explain most of the design:

**Ontologies are isolated units.** An ontology holds one domain's schema — its entity
types, relation types and property definitions — together with its lenses, saved
queries, agents and all of its instance data. A server holds many ontologies, and
nothing spans two: no relation, no query, no lens, no agent. One request addresses one
ontology, always named in the path. Cross-ontology overviews are a client-side concern.

**Lenses are views, not containers.** A lens does not hold types or data. It is a named
view that selects part of its ontology's schema. Two lenses over the same ontology see
the same entities through different apertures.

This is the point most easily misread. An entity is not "in" a lens. Within its
ontology it exists once, and every lens that includes its type can see it.

## How the pieces relate

```
   ┌── ontology ────────────────────────────────────────────────────────┐
   │                                                                    │
   │             schema                            instance data        │
   │   ┌─────────────────────────┐        ┌───────────────────────────┐ │
   │   │  entity types           │        │  entities                 │ │
   │   │  relation types         │  ◀──   │  relations                │ │
   │   │  property definitions   │ typed  │  document chunks          │ │
   │   └─────────────────────────┘        └───────────────────────────┘ │
   │              ▲                                     ▲               │
   │              │ select from                         │ seen through  │
   │         ┌────┴────┐                                │               │
   │         │ lenses  │────────────────────────────────┘               │
   │         └─────────┘                                                │
   │              ▲                                                     │
   │   ┌──────────┴──────────┐                                          │
   │   │                     │                                          │
   │  modeling            runtime                                       │
   │  designs the schema  uses it through one lens                      │
   └────────────────────────────────────────────────────────────────────┘

   ┌── registry ──────────────────────────────────────┐
   │  the server's flat list of ontologies, by key    │
   │  create · list · rename · delete                 │
   └──────────────────────────────────────────────────┘
```

A server holds any number of such ontologies — including zero: nothing is auto-created,
and the last one is deletable. The
**registry** manages them as whole units. An ontology is created bare — empty schema, no
lenses, no data — and deleted as one hard cascade over everything it contains.

## Modeling and runtime

The split is about *what you are addressing*, not about deployment. Both are always
served by the same process, and both address one ontology named in the path.

|  | Modeling | Runtime |
|---|---|---|
| Subject | One ontology's schema | One ontology's instance data |
| Addressed by | Ontology key, then type identifiers | Ontology key, then a lens key |
| Scope | The whole ontology | Only what the lens exposes |
| Changes | Rare, deliberate | Continuous |

Runtime never edits the schema, and modeling never touches instance data. A request that
would need both is not expressible — which is the property that makes it safe to expose
runtime to an autonomous agent while keeping modeling under human control.

Runtime is *derived*: everything it permits follows from the schema and the lens. When
the schema changes, runtime behaviour changes with it, with no separate configuration.

## Interfaces

The same capabilities are exposed three ways, over one service layer. No interface is
built on another — in particular, MCP does not call REST.

- **REST** — the complete surface. Registry CRUD at the top, then schema design and
  instance data under per-ontology route prefixes. The only interface that manages
  ontologies.
- **MCP** — two servers, one for modeling and one for runtime, for AI clients. Each
  mount is bound by its URL — the modeling server to one ontology, the runtime server
  to one ontology and one lens — so a model never sees more than it was given.
- **Web UI** — a start page managing the ontologies, then two surfaces per ontology
  mirroring the split: a schema studio and a data workbench.

See [interfaces.md](interfaces.md).

## Optional capabilities

Two capabilities depend on external providers and are absent unless one is configured.
The server reports what is available, and clients hide what is not.

- **Semantic search** needs an embedding provider. Without it, only literal text matching
  works.
- **AI features** need a language-model provider. Without it, natural-language querying,
  extraction, chat and the agent protocol are unavailable.

Everything else works with no external dependency beyond the database.

---

# Glossary

Terms are used in exactly this sense throughout the documentation and the API.

### Schema and design

**Ontology** — the independent, isolated unit: one domain's schema, its lenses, saved
queries, agents, and all instance data. A server holds many; nothing spans two.
Addressed by an immutable key, unique server-wide, with a mutable display name.

**Registry** — the server's flat, listable set of ontologies, addressed by key. The
only place ontologies are created, renamed and deleted.

**Schema** — the set of entity types, relation types and property definitions of one
ontology.

**Entity type** — a kind of thing that can exist (`person`, `invoice`). Identified by a
**key** in `lower_snake_case`, unique within its ontology. The key is chosen at creation
and never changes.

**Relation type** — a kind of directed, typed connection between two entity types. Its
source and target entity types are fixed at creation.

**Property definition** — a named, typed field on one entity type or one relation type.
Carries a data type, whether it is required, and an optional default.

**Data type** — one of `string`, `integer`, `float`, `boolean`, `date`, `datetime`,
`document`.

**Document property** — a `string`-like property for long text, allowed on entity types
only. Reads return a size stub rather than the content, so that listing entities stays
cheap. See [capabilities/documents.md](capabilities/documents.md).

**Key** — the stable, human-readable identifier of an ontology, type, property, lens,
saved query or agent. Keys are what every interface speaks. They are never database
identifiers, and they are never exposed as UUIDs. Every key is unique within its owner;
only ontology keys are unique server-wide.

### Lenses

**Lens** — a named view over one ontology's schema, addressed by its own key within
that ontology. Belongs to exactly one ontology; holds no types and no data of its own.

**Unscoped lens** — a lens that declares no selection and therefore exposes its
ontology's whole schema. Adding a type to the schema widens it automatically.

**Scoped lens** — a lens that names the types, and optionally the individual
properties, it exposes. Everything else is invisible through it: absent from schema
reads, rejected on write, and stripped from query results.

**Inclusion** — one declaration that a lens exposes a given type, optionally narrowed to
a subset of that type's properties.

### Data

**Entity** — one instance of an entity type. Has a system-assigned identifier and the
properties its type defines.

**Relation** — one instance of a relation type, connecting two entities. Its endpoints
are fixed once created; its properties are not.

**System property** — a server-managed field, distinguished by a leading underscore
(`_id`, `_createdAt`, …). Always readable, never writable. Type and property keys cannot
begin with an underscore, so the two namespaces cannot collide.

**Chunk** — an internal fragment of a document property, held separately so that search
can match and return a passage rather than a whole document. Not addressable directly.

### Using the graph

**OQL** — the OntoForge Query Language: a read-only, pattern-matching graph language
written in type keys and property keys. Anchored to the ISO GQL standard and its GPML
pattern sublanguage. See [capabilities/oql.md](capabilities/oql.md).

**Query path** — a filter key on an entity list that crosses exactly one relation type
to a property of the related entity, written `<relationTypeKey>.<propertyKey>`. Resolved
against the lens-scoped schema at query time; nothing is declared or stored for it. See
[capabilities/instance-data.md](capabilities/instance-data.md#query-paths).

**Related entity** — the entity at the other end of a query path's relation: the
relation type's target for an outgoing path, its source for an incoming one. A position
in the schema, whereas a neighbour is an instance in a traversal result.

**Semantic search** — retrieval by meaning rather than by literal match, over entities,
over document passages, or over both fused into one ranking.

**Saved query** — a stored, named, parameterized pipeline of one or more query steps.
Discoverable by listing or by searching descriptions, so a client can find a suitable
query without composing one.

**Agent** — a named language-model configuration bound to one lens: a system prompt
plus the set of read-only tools it may use.

**A2A** — the agent-to-agent protocol. Each agent publishes a machine-readable card and
accepts tasks, so external systems can call it without knowing OntoForge's own API.

### Internals

**Persistence port** — the boundary every storage operation crosses. Above it, only
schema vocabulary, through stores bound to one ontology and a separate registry port;
below it, one adapter that knows a specific database. See
[storage-adapters.md](storage-adapters.md).

**Adapter** — an implementation of the port for one database. Owns physical naming, query
compilation, index management, error translation, and the physical isolation between
ontologies. Exactly one is active.

**Transfer format** — the versioned JSON representation of one ontology's design, used
for export and import. Carries schema, lenses, agents and saved queries only — no
instance data and no ontology identity. See
[capabilities/transfer.md](capabilities/transfer.md).
