# OntoForge

OntoForge is a graph-native ontology studio. You design a graph schema, then use it
through generic, schema-driven APIs — no per-schema code is written or generated.

The system has two halves. **Modeling** designs the schema. **Runtime** reads and writes
instance data through that schema. Both run in one server, over one database, and are
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
| [ontology-lenses](capabilities/ontology-lenses.md) | Scoping a lens to part of the schema |
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

**The schema is global and singular.** There is exactly one set of entity types and
relation types in a system. They are not owned by anything.

**Ontologies are lenses, not containers.** An ontology does not hold types or data. It is
a named view that selects part of the global schema. Two ontologies over the same graph
see the same entities through different apertures.

This is the point most easily misread. An entity is not "in" an ontology. It exists once,
and every lens that includes its type can see it.

## How the pieces relate

```
              global schema                        instance data
   ┌────────────────────────────────┐     ┌───────────────────────────┐
   │  entity types                  │     │  entities                 │
   │  relation types                │ ◀── │  relations                │
   │  property definitions          │typed│  document chunks          │
   └────────────────────────────────┘     └───────────────────────────┘
                  ▲                                     ▲
                  │ selects from                        │ seen through
         ┌────────┴────────┐                            │
         │   ontologies    │────────────────────────────┘
         │    (lenses)     │
         └─────────────────┘
                  ▲
     ┌────────────┴────────────┐
     │                         │
  modeling                  runtime
  designs the schema        uses it through one lens
```

## Modeling and runtime

The split is about *what you are addressing*, not about deployment. Both are always
served by the same process.

|  | Modeling | Runtime |
|---|---|---|
| Subject | The global schema | Instance data |
| Addressed by | Type identifiers | An ontology key in the path |
| Scope | Everything | Only what the lens exposes |
| Changes | Rare, deliberate | Continuous |

Runtime never edits the schema, and modeling never touches instance data. A request that
would need both is not expressible — which is the property that makes it safe to expose
runtime to an autonomous agent while keeping modeling under human control.

Runtime is *derived*: everything it permits follows from the schema and the lens. When
the schema changes, runtime behaviour changes with it, with no separate configuration.

## Interfaces

The same capabilities are exposed three ways, over one service layer. No interface is
built on another — in particular, MCP does not call REST.

- **REST** — the complete surface. Schema design under one route prefix, instance data
  under a per-ontology prefix.
- **MCP** — two servers, one for modeling and one for runtime, for AI clients. The
  runtime server binds to a single ontology so a model never sees more than one lens.
- **Web UI** — two surfaces mirroring the split: a schema studio and a data workbench.

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

**Schema** — the global set of entity types, relation types and property definitions.
There is one per system. It is the ground truth, independent of any ontology.

**Entity type** — a kind of thing that can exist (`person`, `invoice`). Identified by a
globally unique **key** in `lower_snake_case`. The key is chosen at creation and never
changes.

**Relation type** — a kind of directed, typed connection between two entity types. Its
source and target entity types are fixed at creation.

**Property definition** — a named, typed field on one entity type or one relation type.
Carries a data type, whether it is required, and an optional default.

**Data type** — one of `string`, `integer`, `float`, `boolean`, `date`, `datetime`,
`document`.

**Document property** — a `string`-like property for long text, allowed on entity types
only. Reads return a size stub rather than the content, so that listing entities stays
cheap. See [capabilities/documents.md](capabilities/documents.md).

**Key** — the stable, human-readable identifier of a type, property, ontology, saved
query or agent. Keys are what every interface speaks. They are never database
identifiers, and they are never exposed as UUIDs.

### Lenses

**Ontology** — a named lens over the global schema, addressed by its own key. Holds no
types and no data of its own.

**Unscoped ontology** — a lens that declares no selection and therefore exposes the whole
schema. Adding a type to the schema widens it automatically.

**Scoped ontology** — a lens that names the types, and optionally the individual
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

**Semantic search** — retrieval by meaning rather than by literal match, over entities,
over document passages, or over both fused into one ranking.

**Saved query** — a stored, named, parameterized pipeline of one or more query steps.
Discoverable by listing or by searching descriptions, so a client can find a suitable
query without composing one.

**Agent** — a named language-model configuration bound to one ontology: a system prompt
plus the set of read-only tools it may use.

**A2A** — the agent-to-agent protocol. Each agent publishes a machine-readable card and
accepts tasks, so external systems can call it without knowing OntoForge's own API.

### Internals

**Persistence port** — the boundary every storage operation crosses. Above it, only
ontology vocabulary; below it, one adapter that knows a specific database. See
[storage-adapters.md](storage-adapters.md).

**Adapter** — an implementation of the port for one database. Owns physical naming, query
compilation, index management and error translation. Exactly one is active.

**Transfer format** — the versioned JSON representation of a schema, used for export and
import. Carries schema only; instance data is not included. See
[capabilities/transfer.md](capabilities/transfer.md).
