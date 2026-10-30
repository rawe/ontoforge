# OntoForge concepts

OntoForge is a graph-native ontology studio. You design a graph schema, then use it
through generic, schema-driven APIs — no per-schema code is written or generated.

One server holds many **ontologies** — totally isolated units, each with its own schema,
lenses, saved queries, named searches, assistants and instance data. Within an ontology
the system has two halves. **Modeling** designs that ontology's schema. **Runtime** reads
and writes its instance data through one lens. Both run in one server and are reachable over REST, over
MCP, and through a web UI. Ontologies share an ontology database; with authentication on,
a separate access database holds principals and their access assignments.

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

Runtime never edits the schema, and modeling never writes instance data — except an
entity's derived [identity](capabilities/entity-identity.md). That is what
makes it safe to expose runtime to an autonomous agent while keeping modeling under human
control.

Runtime is *derived*: everything it permits follows from the schema and the lens. When
the schema changes, runtime behavior changes with it, with no separate configuration.

## Interfaces

The same capabilities are exposed three ways, over one service layer. No interface is
built on another — in particular, MCP does not call REST.

- **REST** — the complete surface. Registry CRUD at the top, then schema design and
  instance data under per-ontology route prefixes. The only interface for the registry,
  with one exception: with authentication off, a modeling MCP mount's argument-less
  `ensure_ontology` creates the mount's own ontology.
- **MCP** — two servers, one for modeling and one for runtime, for AI clients. Each
  mount is bound by its URL — the modeling server to one ontology, the runtime server
  to one ontology and one lens — so a model never sees more than it was given.
- **Web UI** — a start page managing the ontologies, then two surfaces per ontology
  mirroring the split: a schema studio and a data workbench.

With [authentication](capabilities/authentication.md) on, every interface serves only
callers who signed in, within the roles OntoForge assigned them. It is off by default.

See [interfaces/](interfaces/README.md).

## Optional capabilities

Some capabilities depend on external providers and are absent unless one is configured.
The server reports what is available, and clients hide what is not.

- **Semantic search** needs an embedding provider. Without it, keyword ranking remains available.
- **AI features** need a language-model provider. Without it, no assistant can answer.
- **Entity identity comparison** needs a Decision provider. It remains independent of
  language-model and embedding availability; see its [capability](capabilities/entity-identity-comparison.md).

Core modeling and runtime operations remain available without these model providers.
Authentication adds an identity provider and an access database; shared state may
additionally use Valkey. See [deployment components](architecture.md#components) and
[shared state](architecture.md#shared-state) for those independent choices.
