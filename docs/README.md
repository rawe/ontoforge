# OntoForge

OntoForge is a graph-native ontology studio. You design a graph schema, then use it
through generic, schema-driven APIs — no per-schema code is written or generated.

One server holds many **ontologies** — totally isolated units, each with its own schema,
lenses, saved queries, agents, retrievers and instance data. Within an ontology the system has two
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
| [search](capabilities/search.md) | Literal matching and ranked search |
| [search-indices](capabilities/search-indices.md) | What ranked search reads: indices, entries, managed and custom indices, cost preview and entry outline, generations and build status |
| [oql](capabilities/oql.md) | The query language |
| [saved-queries](capabilities/saved-queries.md) | Stored, parameterized query pipelines |
| [agents](capabilities/agents.md) | Agents — assistants that answer by working with read-only tools: configuration, tool rules, live tool activity, the default agent |
| [retrievers](capabilities/retrievers.md) | Retrievers — assistants that answer from a lens's search indices: configuration, validation, planning, retrieval, retrieve, diagnostics, the default retriever, portable JSON |
| [threads](capabilities/threads.md) | Server-held assistant conversations: starting, continuing and reading a thread, atomic turns, lifetime |
| [entity-identity-comparison](capabilities/entity-identity-comparison.md) | Optional judgments about two partial entity snapshots |
| [transfer](capabilities/transfer.md) | Schema export and import |

## Internal provider interfaces

- **[Decision API](providers/decision-api.md)** — Optional internal client for typed
  decisions, used by entity identity comparison.

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

Some capabilities depend on external providers and are absent unless one is configured.
The server reports what is available, and clients hide what is not.

- **Semantic search** needs an embedding provider. Without it, keyword ranking remains available where the adapter supports it.
- **AI features** need a language-model provider. Without it, no assistant can answer.
- **Entity identity comparison** needs a Decision provider. It remains independent of
  language-model and embedding availability; see its [capability](capabilities/entity-identity-comparison.md).

Everything else works with no external dependency beyond the database.

---

# Glossary

Terms are used in exactly this sense throughout the documentation and the API.

### Schema and design

**Ontology** — the independent, isolated unit: one domain's schema, its lenses, saved
queries, agents, retrievers, and all instance data. A server holds many; nothing spans two.
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

**Name property** — the one `string` property of an entity type whose value names its
entities. Every entity type has exactly one; it is created with the type and can be
reassigned, never removed. See
[capabilities/schema-modeling.md](capabilities/schema-modeling.md#the-name-property).

**Data type** — one of `string`, `integer`, `float`, `boolean`, `date`, `datetime`,
`document`.

**Document property** — a `string`-like property for long text, allowed on entity types
only. Reads return a size stub rather than the content, so that listing entities stays
cheap. See [capabilities/documents.md](capabilities/documents.md).

**Key** — the stable, human-readable identifier of an ontology, type, property, lens,
search index, saved query, agent or retriever. Keys are what every interface speaks.
They are never database identifiers, and they are never exposed as UUIDs. Every key is
unique within its owner; only ontology keys are unique server-wide. A key follows the rule
of its level:

- **Schema keys** — ontologies, types, properties, lenses, search indices — match
  `^[a-z][a-z0-9_]*$`: lower snake case, starting with a letter. They appear as OQL
  identifiers, where `-` would read as minus, and in storage names.
- **Lens-resource keys** — saved queries, agents and retrievers — match
  `^[a-z][a-z0-9_-]*$`: the schema rule plus `-`. They travel only in URLs, JSON and tool
  arguments.

### Lenses

**Lens** — a named view over one ontology's schema, addressed by its own key within
that ontology. Belongs to exactly one ontology; holds no types and no data of its own.

**Unscoped lens** — a lens that declares no selection and therefore exposes its
ontology's whole schema. Adding a type to the schema widens it automatically.

**Scoped lens** — a lens that names the types, and optionally the individual
properties, it exposes. Everything else is invisible through it: absent from schema
reads, rejected on write, and stripped from query results.

**Inclusion** — one declaration that a lens exposes a given type, optionally narrowed to
a subset of that type's properties. A scoped lens also includes the search indices it
searches; those inclusions never make a lens scoped.

### Data

**Entity** — one instance of an entity type. Has a system-assigned identifier and the
properties its type defines.

**Relation** — one instance of a relation type, connecting two entities. Its endpoints
are fixed once created; its properties are not.

**System property** — a server-managed field, distinguished by a leading underscore
(`_id`, `_createdAt`, …). Always readable, never writable. Type and property keys cannot
begin with an underscore, so the two namespaces cannot collide.

**Chunk** — an internal fragment of a document property, so that search can match and
return a passage rather than a whole document. Not addressable directly.

### Using the graph

**OQL** — the OntoForge Query Language: a read-only, pattern-matching graph language
written in type keys and property keys. Anchored to the ISO GQL standard and its GPML
pattern sublanguage. See [capabilities/oql.md](capabilities/oql.md).

**Query path** — a filter key, on an entity list or on ranked search, that crosses
exactly one relation type to a property reached through it: a property of the related entity, written
`<relationTypeKey>.<propertyKey>`, or a property stored on the relation itself, written
`<relationTypeKey>@<propertyKey>`; the relation segment may carry a direction marker,
`:out` or `:in`. Resolved against the lens-scoped schema at query time; nothing is
declared or stored for it. See
[capabilities/instance-data.md](capabilities/instance-data.md#query-paths).

**Relation existence** — a filter, on an entity list or on ranked search, whose key is
a relation type alone under `__exists` or `__missing`, asking whether any relation of the
type reaches the entity in the direction the schema implies; the relation segment
follows the query path's rules. See
[capabilities/instance-data.md](capabilities/instance-data.md#relation-existence).

**Related entity** — the entity at the other end of a query path's relation: the
relation type's target for an outgoing path, its source for an incoming one. A position
in the schema, whereas a neighbour is an instance in a traversal result.

**Query** — the plain text submitted to ranked search.

**Default search** — ranked search over the managed indices of the searched types,
selected by search kind and search strategy.

**Index search** — ranked search through search indices named by key, or every index the
lens can search, selected by a mode: `semantic`, `keyword` or `hybrid`. It alone ranks
custom indices and relation entries.

**Search catalog** — the list of search indices a lens can search, each projected
through the lens, from which an index search chooses.

**Literal term** — the entity list's case-insensitive substring filter over string values.

**Single-type search** — ranking over one named entity type.

**Cross-type search** — ranking across every type the lens exposes, narrowed by filters.

**Searched types** — the one-or-many type set one search ranks.

**Search kind** — the ranked unit and match: property search or document search.

**Property search** — ranking entities by the entries of their types' default indices.

**Document search** — ranking passages through passage indices and grouping them by
parent entity.

**Search strategy** — what a caller selects: it uses one retrieval method directly or
fuses several by rank. The strategies are `semantic`, `keyword`, `keyword-any`,
`keyword-all` and `hybrid`; requirements decide whether a strategy is available, and
the applied strategy is named in the response.

**Retrieval method** — how one source ranking is produced from storage: semantic ranking,
any-term keyword matching or all-term keyword matching. Rank fusion combines source rankings
at the strategy level and is not a retrieval method.

**Any-term keyword matching** — a row matches when it carries any query term, each term also
matching as a prefix; rank order carries the rest.

**All-term keyword matching** — a row matches only when it carries every query term, each
term also matching as a prefix.

**Query term** — one word of the query after stop-word removal and stemming in a language
of the ontology's keyword language set.

**Source ranking** — the ordered list one retrieval method returns for one search index.

**Hit** — one entity in a search result with its matches, relative score and the entry
that matched it best.

**Match** — a place the query met the entity: an entity match names the entity as a whole;
a passage match names a document property and its best passage's coordinates.

**Search index** — an ontology-level design object deciding what ranked search finds
entities by: a root entity type, the text composed for each of its entities, and its
representations — semantic, keyword or both. Hits are always entities of the root type.
See [capabilities/search-indices.md](capabilities/search-indices.md).

**Managed index** — a search index the server derives from the schema and keeps in step
with it: a default index per entity type over its own `string` properties, and a passage
index per document property.

**Custom index** — a search index a modeler defines: its root type, fields, header,
relation groups, templates and representations. Only custom indices have relation
groups. See [capabilities/search-indices.md](capabilities/search-indices.md#custom-indices).

**Entry** — one indexed text of a search index, owned by one entity: its own fields, one
relation instance with the entity at its other end, or one passage of a document.

**Relation group** — the part of an index definition that follows one relation type in one
direction and names the relation's and the target entity's properties to include; it
yields one entry per relation instance. Managed indices have none.

**Header** — the short prefix of an entity's own fields that starts each of its relation
and passage entries, by default its name property's value.

**Cost preview** — the estimate of a search index definition's full build — entities,
entries and seconds per representation at the measured throughput — returned with its
validation, without saving it.

**Entry outline** — the texts a search index definition composes per entry kind, from the
schema alone, with tokens standing in for field values; returned with the cost preview.

**Generation** — one build of one representation of one search index, identified by the
definition and the embedding model (semantic) or the keyword language set (keyword).
Search reads the ready one; a replacement is built beside it.

**Keyword language set** — the languages, English, German or both, in which an
ontology's keyword entries and queries are stemmed. A setting of the ontology's design,
edited in modeling; a new ontology starts with both. See
[capabilities/search.md](capabilities/search.md#keyword-language).

**Relative score** — 1.0 for the best hit and each other hit's ordering number as a fraction
of the best, comparable only within that response. See [search](capabilities/search.md#response)
for the promise about its shape.

**Search request / operation** — the common request object and service operation used by every
search caller.

**Search tool / document search tool** — `search` / `search_documents`, choosing both kinds
or documents only, with the default strategy.

**Search step** — a saved-query step running default search over one required type.

**Saved query** — a stored, named, parameterized pipeline of one or more query steps.
Discoverable by listing or by searching descriptions, so a client can find a suitable
query without composing one.

### Assistants

**Assistant** — something on a lens you ask questions and hold a conversation with. Every
assistant has a kind; the kinds differ in *how an answer is produced*, not in whether they
converse. Each kind has its own configurations on a lens, keyed per kind, plus a built-in
default keyed `_default` that is never stored.

**Agent** — the assistant kind in which the model works step by step with tools it
chooses: a named language-model configuration bound to one lens, a system prompt plus the
set of read-only tools it may use. Its insight into a run is **tool activity** — which
tools ran, with what, and what they returned — part of the product for every user. See
[capabilities/agents.md](capabilities/agents.md).

**Retriever** — the assistant kind in which a fixed pipeline searches the lens's search
indices and answers from what it found: a planning model turns
a question into searches of the retriever's indices, optionally narrowed to relation
groups and exact filters, and an answer model replies from what they found — or, for a
retrieve, the found entities are returned without an answer. Every lens also has an
implicit **default retriever**, derived from its managed indices. Its insight into a run
is **diagnostics** — plan, results per sub-query, timings, model traces — a debugging
feature, given only on request. See
[capabilities/retrievers.md](capabilities/retrievers.md).

**Thread** — one conversation with one assistant, held by the server: a client sends its
new message and the thread's id, and the server continues from the turns the thread kept.
See [capabilities/threads.md](capabilities/threads.md).

### Internals

**Persistence port** — the boundary every storage operation crosses. Above it, only
schema vocabulary, through stores bound to one ontology and a separate registry port;
below it, one adapter that knows a specific database. See
[storage-adapters.md](storage-adapters.md).

**Adapter** — an implementation of the port for one database. Owns physical naming, query
compilation, index management, error translation, and the physical isolation between
ontologies. Exactly one is active.

**Transfer format** — the versioned JSON representation of one ontology's design, used
for export and import. Carries schema, lenses, agents, saved queries, retrievers, the
keyword language set, custom search indices and managed-index switches only — no
instance data and no ontology identity. See
[capabilities/transfer.md](capabilities/transfer.md).
