# Product surface

What the web client offers. It is a static application that reaches the server over REST
only and holds no privileged path — see [architecture.md](architecture.md). Concepts and
vocabulary: [README.md](README.md). Capability semantics are not repeated here; each
section links to the capability document that owns them.

This document is the capability inventory. It is complete on *what the product does* and
deliberately silent on how it is built.

## The three levels

The product mirrors the system's shape: a server holds ontologies, an ontology holds a
schema and lenses, a lens shows instance data.

| Level | Screen | Subject |
|---|---|---|
| Server | Start page at `/` | The ontologies themselves — create, rename, delete, enter |
| Ontology | Studio | One ontology's schema and its lenses |
| Lens | Workbench | Instance data seen through one lens |

Every address below the start page is ontology-first, mirroring the API: the Studio
lives under the ontology's key, the Workbench under the ontology's key plus a lens key.
The address is the only source of truth for both — nothing else decides what is shown.

### The start page

`/` is the "Ontologies" page — the server-level entry point and the only management
screen; there is no separate settings area.

- A card per ontology: display name and key, its lenses as direct links into the
  Workbench, an "Open Studio" action, and a ⋯ menu with Rename and Delete. Rename
  changes the display name only. Delete asks for confirmation stating the hard cascade —
  schema, lenses and all data go — because the API itself has no guard.
- "+ New ontology" creates one: a key (proposed from the display name until the key
  field is touched, validated live against the key pattern, and permanent) plus an
  optional display name. No language is chosen: the ontology starts with the default
  [keyword language set](capabilities/search.md#keyword-language). Creation lands in the
  new ontology's Studio, which is where a bare ontology is useful first.
- An empty server shows "No ontologies yet" with the create action. Fresh server to
  working graph is one unbroken path: create an ontology, model its schema, create a
  lens, enter data — all in the UI.
- `/` never redirects on its own. There is no remembered auto-resume into a workbench;
  returning users pick their card.

### The two working surfaces

| | Workbench | Studio |
|---|---|---|
| Subject | Instance data seen through one lens | One ontology's schema and its lenses |
| Addressed by | Ontology key and lens key, then type keys | Ontology key, then type and lens identifiers |
| Answers | "What is in the graph?" | "What can be in the graph?" |

The two never mix. Nothing in the Workbench edits the schema; nothing in the Studio
touches instance data. Each surface has its own shell, and each links to the other: the
Workbench sidebar has a Studio entry, the Studio sidebar returns to the ontology's
last-used lens (or the start page when none is remembered).

### The two switchers

Two stacked dropdowns in the sidebar, one per containment level — never a combined menu.

- The **ontology switcher** sits atop the sidebar of both surfaces. Switching keeps the
  surface: from a Studio it goes to the other ontology's Studio; from a Workbench it
  goes to the target ontology's remembered last-used lens — validated against that
  ontology's actual lenses, a stale remembered key being forgotten rather than retried —
  and to its Studio when no remembered lens survives that check.
- The **lens switcher** sits below it in the Workbench only, listing only the current
  ontology's lenses. Choosing one records it as that ontology's last-used lens.

A lens becomes the last-used one only once the Workbench has loaded its schema. A
remembered lens that answers not found, or is no longer among the ontology's lenses, is
forgotten; the Studio's way back then leads to the start page.
- Both dropdowns end in a "Manage…" entry leading to the start page.

Navigating to an unknown ontology — in the Workbench or the Studio — or to an unknown
lens shows a dedicated not-found state which forgets the remembered lens and offers the
start page; it never silently redirects.
Per-lens client state (see [Local state](#local-state)) is keyed by ontology plus lens,
so switching either never leaks a working set, a chat or a query history across a
boundary — not even between same-keyed lenses of two ontologies.

---

## Workbench screens

### Shell

A collapsible sidebar (collapse state persists) carrying: the ontology switcher, the
lens switcher beneath it, a search
trigger, a create-entity trigger, fixed entries for Home, Explore, Query and — when
available — AI, then a data section listing every entity type the lens exposes, each with
its type colour. Below: a theme control cycling system → light → dark, and the Studio
link. Every screen renders through the lens's schema; there is no hand-written per-type
interface anywhere, so adding an entity type immediately produces a table, a form, a
detail page, palette coverage and canvas support for it.

Each type key is assigned a colour deterministically from a fixed palette, so a given type
looks the same in the sidebar, chips, table badges, canvas nodes, diagrams and search
results. Colour is derived from the key alone and needs no server support.

### Home

An overview of one lens.

- Header: lens name, description, scoped/unscoped marker, and the count of exposed entity
  and relation types.
- A quick-action row: Explorer, query console, and — when available — AI.
- A card per entity type with its live instance count, linking to that type's table; below
  them a compact chip per relation type showing its endpoint colours and direction.
- Recently updated: the most recently changed entities across all exposed types, merged
  into one list of eight with type chip, label and relative time.
- Saved queries as one-click run cards.
- A card offering AI-client connection details.

Two dedicated states replace the body: when the lens exposes no entity types at all, an
explanation pointing at the scope editor; when it exposes types but holds no instances, a
three-step guide — create the first entity, extract entities from pasted text, or connect
an AI client. The extraction step stays visible but dimmed with an explanation when AI is
unavailable.

### Type table

A server-driven table over one entity type. Paging, sorting, filtering and text search all
happen on the server; the table only renders what came back. See
[capabilities/instance-data.md](capabilities/instance-data.md).

Capabilities: page through results (25 rows per page); sort by any property column and by
the created and updated timestamps; free-text search across the type (debounced); add and
remove typed filter conditions; show and hide columns; export the current page as CSV;
select rows and delete them in bulk; open a row's detail; jump a row straight into the
Explorer; read a document property without leaving the table.

Column order puts required properties first, then the rest, then updated and created (the
created column starts hidden). Document values render as a size badge that opens the
[document viewer](#document-viewer-and-editor) — never as inline content, and never as
something the row click can swallow.

A filter condition has a subject — a property of the type, or a relation type in one
direction — and the operators on offer depend on it:

| Subject | Operators |
|---|---|
| string property | contains, equals, does not equal, is set, is not set |
| integer, float, date or datetime property | equals, does not equal, ≥, ≤, between, is set, is not set |
| boolean property | is, is set, is not set |
| document property | is set, is not set |
| relation type, per direction | has any, has none |

A relation type is offered once for each direction in which it touches the type, so a
self-referential type appears twice; each entry shows its direction and the entity type at
its other end, and a relation type whose other end the lens does not expose is not
offered. `between` is a client convenience: it is sent as a ≥ / ≤ pair on the same
property. Choosing "does not equal" notes that entities without a value are not included.
A subject holds at most one condition: applying another to it replaces the first, and the
popover says so before applying. Applied conditions appear as removable chips with a
clear-all action.

The table offers a subset of the entity list's filter vocabulary
([interfaces.md](interfaces.md#listing-sorting-filtering)): strict greater-than and
less-than, and query paths in either form, are not offered.

Any change to search, filters or sort returns to the first page. Switching to another type
resets search, filters, sort, column visibility, selection and page. If deleting the last
rows of a trailing page leaves the current page beyond the end, the table clamps back to
the last populated page. Two distinct empty states are shown: "nothing exists yet" (with a
create action) and "nothing matches" (with a clear-filters action).

### Entity detail

Header: display label, type chip, creation and update timestamps, and actions to add a
relation, open the entity in the Explorer, and delete it behind a confirmation that states
the relations will go with it. Opening an entity records it in the recents list used by the
command palette and the Explorer's empty state.

**Properties.** Every property the lens exposes, click-to-edit in place. Editing one field
saves that one field. Enter saves, Escape cancels, booleans save the moment they are
toggled, and a save that would not change anything just closes the editor. Clearing a
required property is refused client-side; server field errors appear under the field.
Empty optional properties show as a dimmed placeholder and are editable.

Document properties render last, as collapsed rows showing a size badge. Expanding fetches
and renders the content; a separate action opens the [document editor](#document-viewer-and-editor).
See [capabilities/documents.md](capabilities/documents.md).

**Relations.** One section per relation type that applies to this entity's type, with a
direction indicator, an exact neighbour count, and the neighbours themselves — each a link
to its detail page, with a compact summary of the relation's own properties and an unlink
action behind a confirmation that states both entities survive. Sections page ten at a
time up to two hundred. A section header and an empty section both offer to add a relation
of that type, pre-selected.

**Neighbourhood.** A compact summary of neighbour counts per relation type plus an entry
into the Explorer focused on this entity.

**Adding a relation.** A guided flow that only ever offers schema-valid choices:

1. Pick a relation type *and direction*. Only types with this entity's type at one end
   appear; a self-referential type contributes both directions, distinguished by showing
   this entity's own label on the correct side. The step is skipped when there is exactly
   one possibility, or when it was pre-selected from a relation section.
2. Pick the target entity. The picker searches only the type the chosen direction demands
   — semantically when available, by substring otherwise — and offers to create a new
   entity of that type inline, using the same schema-driven form as elsewhere. A newly
   created entity is selected automatically.
3. Fill the relation's own properties, if it has any. When the relation type has no
   properties this step is skipped and picking a target creates the relation immediately;
   a failure then returns to a properties step so the attempt can be corrected and retried
   rather than lost.

Endpoint errors from the server are surfaced as form-level errors, not silent failures.

### Explore

The graph canvas. See [Working set](#working-set) for its model.

### Query

Two tabs — Console and Library — which both stay live, so results survive a switch. See
[Query console](#query-console) and [Saved-query library](#saved-query-library).

### AI

Four tabs — Chat, Ask, Extract, Retriever — preserve long-running extraction across a
tab switch. See [AI panel](#ai-panel). Absent entirely when no language-model provider is
configured.

---

## Studio screens

The Studio is scoped wholesale to one ontology: its sidebar carries the ontology
switcher, its navigation covers Schema, Lenses, Search and Transfer, and everything it
reads and writes belongs to the current ontology.

### Schema

The ontology's schema, in two interchangeable views: a two-column list of entity types and
relation types, and a [diagram](#schema-diagram). Each card shows the type's key, display
name, property count and description; a relation type card also shows its endpoints.
From here: create an entity type, create a relation type, and validate the whole schema.
Validation results appear inline as a pass marker or a list of path-and-message issues.

Creating a type asks for a display name, a key and a description. The key is proposed from
the display name (lower-cased, non-alphanumerics collapsed to underscores, leading digits
dropped), validated live against the key pattern, and permanent — the form says so.
Creating an entity type additionally asks for the key of its name property, `name` by
default and validated against the same pattern; its dialog explains that the type belongs
to this ontology, where every lens can include it, and that the name property's value
labels instances. Creating a relation type additionally asks
for source and target entity types, which are permanent too.

### Type editor

One screen for both entity types and relation types.

Editable in place: display name and description. Immutable and labelled as such: the key,
and a relation type's endpoints. Deletion is offered behind a confirmation and may trigger
the [cascade flow](#cascade-confirmation).

A properties table lists key, display name, data type, required flag, default and
description, with add, edit and delete per row. On an entity type the name property's row
carries a "Name" badge and its delete action is disabled, explaining that another name
property must be chosen first; a "Name property" select above the table offers the type's
`string` properties and reassigns the name property on change. In the property dialog the key and the data
type are immutable once created; display name, description, required flag and default may
change. The default is entered with an input matched to the data type. Document is offered
as a data type on entity types only. Creating a required property may trigger the cascade
flow. Deleting a property warns that existing stored values remain in the database but
leave the schema. See [capabilities/schema-modeling.md](capabilities/schema-modeling.md).

On an entity type, a **Search indices** section below the properties lists every search
index rooted on the type — managed and custom — with its name, key, kind and
[status](#search), each linking to the index; "New index" opens the
[index designer](#index-designer) with the type pre-selected. A type with no index says
why: it has no string or document property and no custom index.

### Lenses

A list of the ontology's lenses with their keys and a scope marker — either "unscoped",
or "scoped" with the number of included entity and relation types. Index inclusions are
not counted, and never make a lens scoped. Creation asks for a name, a
derived-but-editable key and a description, and states plainly that a new lens starts
unscoped and therefore exposes everything.

### Lens detail

Inline-editable name and description, an immutable key, a scope marker, an entry into the
Workbench for this lens, and deletion behind a confirmation stating that the lens, its
scope, its agents, retriever agents and saved queries go — while the schema and all
instance data stay. Five tabs — Retriever agents only on a server with search indices:

**Scope** — the [scope editor](#scope-editor).

**Agents** — create, edit and delete the lens's agents: name, derived-and-then-immutable
key, description, system prompt, and either all tools or an explicit checklist of the
read-only runtime tools (at least one required). The list shows each agent's tool posture
at a glance. See [capabilities/ai-agents.md](capabilities/ai-agents.md).

**Retriever agents** — the authoring surface for the lens's
[retriever agents](capabilities/retriever-agents.md), with a test panel beside the
editor; see [Retriever-agent editor](#retriever-agent-editor). Chatting with a saved agent
happens in the Workbench ([AI panel](#ai-panel)).

**Saved queries** — the authoring surface for the lens's stored pipelines, and the only
place multi-step pipelines can be built. Per query: name, derived-and-then-immutable key,
description, an ordered list of steps, and a parameter list. A step is either a query step
carrying query text, or a search step carrying an entity type, search text and a result
limit — it has no minimum score. Steps can be reordered and removed; every step after the
first can bind parameters to fields of an earlier step's results. Parameters carry a name,
a description and a scalar data type (document is not offered). An inline runner executes
the query with typed parameter inputs and shows the result as a table or as raw JSON. See
[capabilities/saved-queries.md](capabilities/saved-queries.md).

**Connect** — one ready-to-paste AI-client configuration covering both MCP servers,
bound entirely by their URLs: the modeling server to this ontology, the runtime server to
this lens within it ([interfaces.md](interfaces.md#how-a-mount-is-bound)). The
snippet is copyable and built from the address the client itself was served from, with a
note to substitute the backend host when clients connect directly.

### Search

The ontology's [search indices](capabilities/search-indices.md) and its search settings,
in two tabs: Indices and Settings. The whole area exists only on a server that supports
search indices ([Feature gating](#feature-gating)). A "New index" action opens the
[index designer](#index-designer).

**Indices** shows two tables. *Custom indices* show name and key, root entity type, what
they read (field count, relation-group count), their representations (semantic,
keyword) and their status; an empty list explains what a custom index adds. *Managed
indices* — one default index per entity type and one passage index per document property
— show name and key, kind (default or passages), entity type, representations, status and
an on/off switch. Every row opens its index. The status chip names the
[state](capabilities/search-indices.md#status) — ready, building with its progress, stale
with the pending count, failed with the failed count, disabled, or unavailable — and its
tooltip gives each representation's state. While any listed index is building or stale,
the list refreshes itself every few seconds; otherwise nothing polls.

**Settings** — the [keyword languages](capabilities/search.md#keyword-language), German
and English, as checkboxes; the last remaining language cannot be unticked. Below, the
managed indices grouped by entity type — the default index and one "Passages of …" row per
document property — each with its status and switch. Both take effect at once, without a
save step; changing the languages says that keyword entries rebuild in the background.

### Index designer

One custom index as a draft that only a Save writes, with the
[cost preview](capabilities/search-indices.md#cost-preview) in the save bar. Its sections
follow the [definition](capabilities/search-indices.md#custom-indices):

- **Name and description**, with the key proposed from the name until the key field is
  touched, validated live against the key pattern and permanent; the description is
  explained as the text agents choose the index by. The key `new` is refused, because the
  designer's own address for a new index ends in it.
- **Entity type** — every hit is an entity of it. Changing it clears fields, header and
  relation groups.
- **Own fields** — a checklist of the type's text and scalar properties and at most one
  document property, with a running count against the field limit.
- **Header** — the name property (the default), chosen text fields, or none.
- **Relation groups** — one card per group: a relation type in one direction (each
  combination once), its relation fields, the target type's fields, a label and an
  optional template. The group count runs against its limit.
- **Search modes** — semantic and keyword switches; semantic takes an optional template of
  the entity's own entry.

Fields the schema no longer has stay visible, marked, so they can be removed; a group
whose relation no longer connects the type says so. The save bar states whether the draft
is new, changed or saved, shows the estimate for the current draft — entries and build
time overall, per representation, and from how many entities, marked where a default rate
stands in for a measured one — or why there is none yet (no entity type, open issues), and
the field and group counts against their limits. Create (for a new index) or Save, and
Discard. Issues from the client's own checks — the key's among them — the server's
preview and a refused save appear in a validation panel and next to their fields; a fresh new draft shows none
until it is edited. Saving a new index opens it at its own address.
Leaving with unsaved changes asks first (stay, or discard and leave).

A saved index adds a status block — the status chip, each representation's state, the
last errors when items failed — and Rebuild behind a confirmation explaining that search
keeps the current entries until the new build is ready; Rebuild is unavailable while the
index is switched off. Deletion is confirmed and may trigger the
[cascade flow](#cascade-confirmation) for lenses that include the index; it then returns
to the list.

A managed index opens read-only: kind, managed key, description, entity type, its fields
(or document), header and search modes, the on/off switch and the same status block with
Rebuild. It explains that managed indices follow the schema and points to a custom index
for anything else.

### Transfer

Three operations, each with its own explanation. See
[capabilities/transfer.md](capabilities/transfer.md).

- **Export** — downloads the ontology's whole design — entity types, relation types,
  properties, search indices, keyword languages, lenses, agents, retriever agents and saved
  queries — as a JSON file named after the ontology key ("Download `<ontologyKey>`.json").
- **Import** — takes a JSON file and writes it into the current ontology. It reports
  malformed JSON before sending anything, and on a
  key conflict explains that pre-existing objects with the same keys block the import and
  that the clashes must be resolved (or a bare ontology used). A successful import
  refreshes every cached view.
- **Rebuild search data** — runs the [search-data rebuild](capabilities/search.md#rebuild)
  for this ontology, behind a confirmation warning about duration and provider cost, then
  live progress per group while it runs and a summary when it finishes. What it covers
  depends on the adapter, and the card and confirmation say which:
  - With search indices it re-embeds the saved-query descriptions and repairs their
    vector index; search indices keep themselves current and are rebuilt one at a time
    from the [index designer](#index-designer). With no embedding provider configured
    there is nothing to rebuild: the action is disabled, with a note saying why.
  - Without search indices it also rebuilds the adapter's own search data — it re-chunks
    the document passages and, with an embedding provider, re-embeds entities and
    passages ([storage-adapters.md](storage-adapters.md#own-search-storage)). With no
    provider it stays available, with a note that it skips the embeddings; the summary
    repeats that they were skipped.

---

## Interaction models

### Command palette

One overlay, four modes, opened from anywhere in the Workbench. Each open starts fresh —
empty input, no type scope, a new snapshot of recents.

| Prefix | Mode | Behaviour |
|---|---|---|
| *(none)* | Entities | Cross-type entity search — ranked under the server's default strategy when any strategy is available, otherwise a parallel substring search over every exposed type. Starts at two characters; below that it shows recents or a hint. |
| `#` | Types | Filter the exposed entity types; choosing one *scopes* the palette to that type rather than navigating. |
| `?` | Saved queries | Semantic search over query descriptions when available, substring filtering over the full list otherwise. An empty query lists everything. |
| `>` | Actions | Navigation to each Workbench area, the Studio, and a theme toggle. |

Scoping to a type replaces the prefix with a persistent type chip; the search then runs
within that type, an empty query lists that type's first entities, and Backspace on an
empty input removes the scope. Prefixes are inert while a type scope is active.

Entity results retain global ranking order. Each row carries a type chip and display
label, and, when the hit was found through a relation or a passage, one muted
[matched via](#matched-via) line beneath. No number, score bar, percentage, numeric aria
label or passage text is displayed. The relation target picker uses the same search hook
and row; its empty input lists the first ten entities. Both use ranked search whenever
the strategy list is nonempty, falling back to literal entity lists otherwise. Enter
opens entity detail; Cmd/Ctrl+Enter focuses the Explorer.

Extraction review searches only properties for up to three existing candidates, with no
score threshold or displayed number; each candidate carries the same matched-via text when
there is one. “Create new” is the default and the prompt asks whether to use an existing
entity instead.

### Matched via

Search results never show a score. Where the server names the entry that found a hit
([capabilities/search.md](capabilities/search.md#response)), a hit found through a
relation or a passage carries one short line:

- a relation entry — `via <label> → <target>`: the relation group's label from the lens's
  [search catalog](capabilities/search.md#the-search-catalog), else the relation type's
  display name, and the target's label, else its truncated identifier;
- a passage entry — `via passage in <property>`, the document property's display name;
- the entity's own fields — no line.

The line never shows the entry's text. The palette, the relation target picker and the
extraction review use the [default search](capabilities/search.md#ranked-search), which
reads only managed indices, so no relation line appears there; relation lines appear in
a retriever agent's diagnostics, whose searches reach custom indices. A server whose hits
name no entry — one without search indices — shows instead one `in <property>` badge per
document match, in match order.

### Quick add

A global create-entity dialog, reachable by keyboard, from the sidebar, from empty states,
and by deep link. Step one picks the entity type (skipped when the caller pre-selected
one — in which case there is no way back to the picker). Step two is the schema-driven
form: required properties first, one input per data type, schema defaults pre-filled,
empty optional properties omitted from the request entirely, all client-side coercion
errors collected at once, and server field errors merged onto the matching fields. A
"create and add another" option keeps the dialog open with a fresh form. Closing with
unsaved input asks for confirmation first. On success a toast offers to open the new
entity.

The same form primitives back quick add, inline target creation in the relation flow, the
relation-property steps, and the extraction review, so all of them accept exactly what the
lens accepts.

### Working set

The Explorer does not draw "the graph". It maintains a **working set** — the entities the
user deliberately put on the canvas, plus neighbours they expanded into. This is the
central idea of the screen and everything else follows from it.

**Growth is incremental and explicit.** Entities arrive from the palette, from a table
row, from an entity detail page, from a query result, from a recents chip on the empty
canvas, or by expanding a node's relations. Expansion is per relation type and per
direction: the node panel lists every applicable relation type with its exact neighbour
count, and clicking one pulls in the first ten neighbours; repeated clicks pull ten more,
up to two hundred, and stop offering more once the count is exhausted.

**Layout stability is a contract.** Nothing ever repositions a node the user can already
see. New nodes are placed on growing elliptical rings around an anchor — the expanding
node, or the centroid of the canvas for unanchored additions — taking the first slot that
does not collide, and falling back to stacking below the anchor on a dense canvas.
Dragging a node is respected permanently. A full re-layout exists but is an explicit
action, animated so the change is legible.

**Adding something already present never disturbs it.** Duplicates are detected and flash
their existing node instead of creating a second one; a single focused duplicate is
centred.

**Pinning** marks nodes as worth keeping. Clearing the canvas offers "clear unpinned" and
"clear all" separately, and states that clearing removes nodes from the canvas without
deleting any data.

**Per-type filtering.** A chip per entity type present on the canvas, in that type's
colour, showing its node count and toggling visibility of those nodes; edges touching a
hidden node hide with it. Hidden nodes stay in the working set.

**Drag-to-connect offers only schema-valid targets.** Dragging between two nodes computes
the relation types whose declared endpoints match those two concrete entity types, in
either direction; a drag with no valid relation type is refused with an explanation naming
both types. When several are valid the user picks one, phrased as a concrete sentence
(this entity → relation → that entity) rather than as an abstract type list. A
self-referential drag collapses the two identical directions to one option. Relation
properties are then filled in, and the new edge appears without re-laying anything out.

**Caps.** A soft cap of 150 nodes switches the node counter to a warning appearance and
suggests clearing unpinned nodes. A hard cap of 300 refuses further additions with an
explanation; the addition is rejected as a whole, never partially applied.

**Selection.** Selecting one node opens a side panel: the entity's scalar properties (up
to six non-empty), its document properties as click-to-read entries, the per-relation-type
expansion list, and actions to open the detail page, pin, connect, and remove from the
canvas — the last labelled explicitly as *removing from the canvas, keeping the entity*.
Selecting several shows a bar offering pin-all and remove-from-canvas. Double-clicking a
node opens its detail page.

**Edges.** Clicking an edge opens a small card with the relation type, both endpoints as
links, the relation's own properties, and a delete action behind a confirmation stating
that both entities survive. Self-referential relations draw as a loop over their node
rather than a degenerate curve.

**Persistence and restore.** The working set survives reloads (see
[Local state](#local-state)). On restore, entities whose type is no longer in scope are
dropped, entities that no longer exist are dropped silently, and only the relations
*between* restored nodes are re-fetched — the canvas never grows by itself across a
reload. The view is then fitted, with padding reserved for the side panel when one is open.

### Query console

An editor for the query language with syntax highlighting, run on demand or by keyboard.
See [capabilities/oql.md](capabilities/oql.md).

**Schema sidebar.** A browser of exactly what this lens exposes: entity types, expandable
to their properties with data types and required markers, and relation types with their
endpoints. Clicking a type inserts a ready-to-run pattern for it at the cursor. It can be
hidden.

**History.** The last ten queries actually run in this lens, offered as a menu that
replaces the editor content. Persisted per lens.

**Results.** Row count and wall-clock duration, a CSV export, and a table/graph toggle.
The table renders entity values as type chips linking to their detail pages, relation
values as compact type chips carrying their properties, document values as size badges,
scalars as themselves, and anything else as expandable JSON. The graph view is offered
only when the result actually contains entity objects; it lays out the unique result
entities with derivable relations as labelled edges, and each node offers to continue in
the Explorer.

**Errors** are rendered verbatim in a monospaced block rather than summarised, because the
query endpoint answers a rejected query with self-correction hints listing the types and
properties actually available — losing them would defeat the point.

**Saving.** The current query can be stored as a single-step saved query without leaving
the console. Parameters are auto-detected from `$name` tokens in the query text and
pre-filled as rows the user can name, describe and type. The description is required, and
the dialog says why: it is what makes the query discoverable by meaning.

### Saved-query library

The run-focused half of the Query screen; authoring lives in the Studio, and every card
links there. A search box over the library — semantic when available, substring otherwise.
Each query is a card showing its name, key, a badge per step kind, a parameter count and
its description. Expanding a card reveals a run panel: one typed input per parameter (all
required before the run is allowed), a run action, results in the shared results surface,
and a "copy as cURL" action that reproduces the exact call. A query opened by deep link
expands automatically, and runs immediately when it has no parameters.

### AI panel

Four modes over one lens: Chat, Ask, Extract and Retriever. All require a language-model
provider; see [capabilities/ai-agents.md](capabilities/ai-agents.md).

**Chat** — a conversation with the lens's default assistant or with any configured agent,
chosen from a picker. Each agent keeps its own persisted thread; switching agents switches
threads. Assistant answers render once in full as Markdown. Tool calls appear immediately
with complete arguments and pending/completed states; each completed structured result can
be expanded while other calls or the answer are still pending. An elapsed-seconds indicator
shows ongoing work. Failure or interruption preserves completed results, marks unfinished
calls interrupted, and clearly labels the turn incomplete. A closed connection without a
terminal event is a failure. Turns never retry automatically. Leaving chat or switching
ontology, lens, or agent cancels the active request; late events cannot enter another thread.
Clearing the thread is confirmed and cancels active work. Browser persistence keeps bounded
text history and turn outcomes, without full tool payloads; storage failure does not break
live chat. Empty pending answers and failed assistant turns are excluded from model history.

**Ask** — one question, one answer. The response is Markdown, accompanied by a collapsible
block holding the query the model generated (copyable, and openable directly in the
console) and a table of the rows it returned. Earlier questions of the same session stay
below the newest. This history is in-memory only.

**Extract** — the human-in-the-loop path from unstructured text to graph data, and the one
place where nothing is written without an explicit second step.

1. *Input.* Paste any text; optionally restrict extraction to a subset of entity types
   (none selected means all). The extraction request explicitly asks the server *not* to
   create anything.
2. *Review.* Proposals arrive as an editable model, entities on one side grouped by type,
   relations on the other. Every proposed entity is a card with a checkbox and a form
   holding its proposed values; every field is editable before anything is written.
   Properties the schema does not define are listed as explicitly ignored rather than
   silently dropped. A proposal whose type is not in the lens's scope is shown, disabled,
   and explained. Missing required values are counted on the card.
   Where ranked search is available, each proposal is checked against up to three existing entities
   of its own type by their properties; candidates are offered as a "use this existing one instead" choice,
   which turns that proposal into a link rather than a creation. When entity identity
   comparison is available, an explicit **Compare identity** action compares the
   edited scalar drafts with those candidates, up to three sequentially. Drafts use
   the form's existing scalar conversion; invalid values must be corrected before
   comparing, and document values are excluded. It shows
   same, different or insufficient judgments; model probabilities and confidence
   are expandable, and shortened context is identified. Editing the proposal or
   changing the candidates discards old assessments and cancels pending comparisons.
   Results never select an existing entity automatically; a failure is shown without
   a fallback. See [entity identity comparison](capabilities/entity-identity-comparison.md).
   A relation is blocked —
   with the reason spelled out — when its type is out of scope, when an endpoint is not
   among the proposals, or when an endpoint is neither checked for creation nor mapped to
   an existing entity. The raw response can be inspected at any point.
3. *Accept.* Creation runs in two passes: entities first, then relations with their
   endpoints resolved from the mapping of proposal to created-or-existing identifier.
   Progress is per item and visible as it happens. Items that fail keep their error, stay
   editable and stay listed, so accepting again retries only what is left; items that
   succeeded are marked and skipped. The outcome is reported as counts, and the first
   created entity can be opened in the Explorer.

**Retriever** — chat with the lens's saved
[retriever agents](capabilities/retriever-agents.md). A header picker selects the agent;
the address names it, and without one — or with one the lens does not have — the first
agent is shown and the address updated to name it. Agents that are invalid in the lens are
marked in the picker, and questions to them are blocked with the reason. "Edit in Studio"
opens the agent in the lens's [retriever-agent editor](#retriever-agent-editor), which is
where agents are created and changed; a lens without agents says so and links there. A
"Show diagnostics" switch, off by default and remembered, requests diagnostics with every
answer and shows them beside the conversation. The conversation itself is the
[retriever-agent chat](#retriever-agent-chat). On a server without search indices the tab
explains that retriever agents are not available.

### Retriever-agent editor

The Studio lens detail's Retriever agents tab, absent on a server without search indices.
Its configuration semantics are owned by
[capabilities/retriever-agents.md](capabilities/retriever-agents.md).

**List.** A card per agent: name, key, a badge for valid, invalid or unsupported, the
number of warnings, the description, and which indices it searches with its filter count.
A card opens the agent's editor; the address names the open agent, so it can be linked.
"New retriever agent" asks for a name and a derived-but-editable key — permanent and
unique in the lens — and opens the editor on a draft that exists only in the client until
its first save. "Import" creates a new agent from an exported JSON, from a file or pasted;
it never replaces an agent with the same key.

**Editor.** A draft that only a Save writes, in four sections:

- **Search indices** — the indices of the lens's
  [search catalog](capabilities/search.md#the-search-catalog), grouped by entity type,
  each with its name, key, kind, description and, unless ready, its build state. A chosen
  index with relation groups offers all of them or only chosen relation types. An index
  the lens no longer offers stays listed for removal.
- **Filters** — the exact conditions a question may set: a result type, a path (the
  result's own field, or up to two relation hops away) and a field. Document fields are
  not offered.
- **Answer fields** — per result type, up to twelve of its properties, documents
  included, passed to the answer model; answer fields for a type no chosen index finds
  are listed for removal.
- **Answer** — the similarity threshold as a slider from −1 to 1, explained as a cosine
  cut-off that never removes keyword matches or exact filters, and the maximum characters
  per answer field.

Name and description sit above. A save bar states whether the agent is new, changed or
saved and offers Save, Discard and Save as copy — which stores the current state, unsaved
changes included, as a new agent under a new name and key while the original stays as
last saved. The saved agent's validation errors and warnings appear in a validation panel,
the draft's own problems next to their section. Leaving the editor with unsaved changes —
by the back action, another tab or another page — asks first. Rarer operations sit under
More: export of the saved version as JSON, copy or move to another lens of the ontology
under the same key, the configuration as editable JSON applied to the draft, and
deletion. An agent whose configuration has an unsupported version or shape opens with
More expanded, where it can be exported or replaced by a version 2 configuration.

**Test panel.** Beside the editor, a [retriever-agent chat](#retriever-agent-chat) with
diagnostics always on. It asks the saved version: a new, changed, invalid or unsupported
agent blocks questions and says why. Saving starts a new conversation. Without a
language-model provider the panel says that the agent cannot answer.

### Retriever-agent chat

One conversation with one saved retriever agent, shared by the editor's test panel and the
Workbench's Retriever tab. A status line names the running step; a running question can
be cancelled, and "New conversation" clears the thread. Answers render as Markdown.
Follow-up questions refer to earlier completed answers: each question sends the last four
completed question-and-answer pairs, at most 2,000 characters per message; a failed or
cancelled turn is never used as context. The conversation lives in memory only and
belongs to one saved version of the agent — a newer save, or another agent, starts a new
one.

With diagnostics, each answer offers a Diagnostics action, and a side panel shows the
selected answer (the latest by default) in four tabs, filling while the question runs:

- **Overview** — time spent in each of the three steps and in total, the number of model
  and search calls, the limitations the run reported, and detailed timings.
- **Plan** — what the planning model made of the question: per sub-query the indices
  searched, the relation groups, the query and its mode with variants, and the exact
  filters; the reason when the question cannot be answered from the lens; the raw plan.
- **Results** — per sub-query, best first, each result's type, label and
  [matched-via](#matched-via) line; expanding one shows the answer fields sent as
  evidence and the index that found it.
- **Model calls** — each model call under its name — Planner, Planner (repeated) when a
  follow-up's planning was repeated, Response — with token usage, finish reason,
  instructions, input and output, marked where the trace is truncated.

No score is shown anywhere. See
[capabilities/retriever-agents.md](capabilities/retriever-agents.md#diagnostics).

### Schema diagram

A read-only picture of the ontology's schema: one node per entity type in its colour, one
labelled edge per relation type, laid out left to right. Pan, zoom and drag are available;
nothing can be created, connected or deleted here. Double-clicking a node opens that type's
editor. The layout is recomputed when the schema itself changes, not when a node is
dragged. Relation types with a missing endpoint are omitted rather than drawn dangling.

### Scope editor

Two panes side by side: what is *declared*, and what that *produces*.

The left pane is a checklist of every entity type and relation type in the ontology's
schema —
not just the ones already included. Checking a type includes it with all its properties.
An included row expands into a per-property editor offering either "all properties" or an
explicit selection; in explicit mode, properties that are required and have no default are
checked, locked and labelled, because a lens that hid them could not create valid data.
An entity type whose explicit selection leaves out its name property is flagged: labels in
the lens then fall back to the truncated identifier. The pane also offers lens
validation, and states the rule that a relation type is only usable when both of its
endpoint types are also in scope. Validation shows errors and, apart from them and in
amber, [warnings](capabilities/ontology-lenses.md#validation-warnings) — such as an
included search index reading a property the lens hides; warnings never fail it.

An unscoped lens is called out prominently: it exposes the whole schema, and checking any
type begins scoping — after which *only* checked types remain visible. This is the one
transition in the product that silently narrows what a running client can see, so it is
stated rather than implied.

On a server with search indices, a **Search indices** section follows the types. A scoped
lens lists every index of the ontology, managed and custom, grouped by root entity type
in schema order, each with its name, key, entity type, kind and an "off" marker when
switched off in the search settings; its checkbox includes or removes the index at once.
An index can be included only while its entity type is: otherwise its checkbox is
disabled with a hint to include the type first. Including an entity type also includes
its managed indices — switched-off ones too — which can then be unticked; a failure there
is reported and never undoes the type inclusion. Removing an entity type keeps the index
inclusions rooted on it, flagged as not in scope. An unscoped lens shows only a note that
every index is available
([capabilities/ontology-lenses.md](capabilities/ontology-lenses.md#search-through-a-lens)).

The right pane is a **live lens preview** rendered from the lens's own runtime schema: the
entity types it exposes with their exposed property keys and required markers, and the
relation types with their endpoints and properties. Every scope edit refreshes it, so the
consequence of a checkbox is visible immediately and in the same terms the runtime API
uses. This is what makes the inferred relation-type inclusion comprehensible without
reading the rules. See [capabilities/ontology-lenses.md](capabilities/ontology-lenses.md).

### Cascade confirmation

A change that would invalidate a lens or a custom search index is refused by the server
and named. The client turns that refusal into a two-step confirmation rather than an
error: it captures the conflict and shows, in its own words rather than the server's
message, what the cascade updates — the scope of the lenses, the search indices (an index
left with nothing to read is deleted) — above a list of the affected lenses and a list of
the affected search indices. It offers to apply the change *with* the cascade, which
re-runs the identical operation with explicit consent. Cancelling leaves nothing changed.
The flow is attached wherever such a change can originate: deleting an entity or relation
type, deleting a property, adding a required property, and deleting a custom search
index. See
[capabilities/schema-modeling.md](capabilities/schema-modeling.md#the-cascade-protocol).

### Document viewer and editor

Document properties never appear inline anywhere — every read carries a size stub, and the
client renders it as a size badge. Two surfaces open them.

The **viewer** is a read-only overlay that fetches the full content on open and renders it
as Markdown. It is reachable from a table cell, from the Explorer's node panel, and from
the entity detail row, and is the same overlay in all three.

The **editor** is a large two-tab surface — write as Markdown, preview as rendered — that
loads the current content, edits it as one whole string, and saves it as an ordinary
property update. Clearing the text clears the property, which is refused when the property
is required. The write pane keeps a fixed height and scrolls internally rather than growing
with the document. The client does not offer partial or ranged document edits; those exist
on the API for programmatic callers. See
[capabilities/documents.md](capabilities/documents.md).

---

## Feature gating

The client asks the server once per session which optional capabilities exist, and treats
the answer as never going stale. The report contains available search strategies plus
semantic-search, AI, entity-identity-comparison and search-indices flags. None is
inferred from a failed call — the client never probes.

Gated areas explain themselves rather than vanishing, except in navigation, where a dead
entry would be worse than an absent one. Navigation is gated optimistically: the AI entry,
the Studio's Search entry and the lens detail's Retriever agents tab are shown unless the
report has explicitly said their capability is off, so they do not flicker into existence
while the report is loading.

| Off | What changes |
|---|---|
| AI | The AI navigation entry, the AI palette action and the AI quick action are gone. The AI screen itself renders an explanation. The empty-state extraction step stays visible but dimmed, with an explanation. |
| No search strategies | Entity search falls back to substring matching — per type in parallel when unscoped. Extraction review skips the duplicate check. |
| Semantic search | Saved-query search falls back to client-side substring filtering over the full list. With search indices the search-data rebuild is disabled and explains that there is nothing to rebuild; without them it stays available and explains that it will skip the embeddings. |
| Search indices | The Studio's Search entry and the lens detail's Retriever agents tab are gone; their addresses render an explanation, and so does the Workbench's Retriever tab. The entity type editor's Search indices section and the scope editor's Search indices section are absent. Search hits name no entry, so results show document badges instead of [matched-via](#matched-via) lines. |
| Entity identity comparison | The extraction review's Compare identity action is absent; candidate discovery and manual selection still work. |

Everything else works unchanged. See [capabilities/search.md](capabilities/search.md).

---

## Client-side contracts the API does not imply

None of the following is visible from the server's surface — the operations involved are
indexed in [interfaces.md](interfaces.md). A reimplementation that honours the API and
ignores these will look right and behave wrongly.

**Instance counts are synthesized.** There is no count endpoint. A per-type count is one
entity-list request with a page size of one, reading the pagination total and discarding
the row. Home issues one such request per exposed entity type, in parallel, cached briefly.
They must share a cache identity with the entity lists themselves, so that creating or
deleting an entity invalidates the count as well as the list.

**Neighbour counts are synthesized differently.** The neighbours response carries no total
at all. An exact per-relation-type count is therefore built from the *relation* list
endpoint: one request with page size one per direction in which the relation type touches
this entity's type — both, when the type is self-referential — summing the totals. All of
an entity's counts form one cache entry, invalidated together with its neighbour lists
after any relation is created or removed at either end.

**An entity's label is its name property's value.** The label is the value of the entity
type's [name property](capabilities/schema-modeling.md#the-name-property), read from the
current lens's runtime schema, when it is a non-empty string; otherwise the first twelve
characters of the identifier. There is no fallback to other properties, so a lens that
hides the name property labels its entities by identifier. It is applied everywhere an
entity is named — tables, detail headers, search results, canvas nodes, relation rows,
toasts — and the extraction review applies it to a *proposed* property bag, falling back
to an explicit "unnamed" marker.

**Query rows omit relation endpoints.** A relation read returns its endpoint identifiers; a
relation inside a query result does not ([capabilities/oql.md](capabilities/oql.md)).
Drawing a graph from a result therefore requires
reconstruction, per row: use explicit endpoint identifiers if present; otherwise look up
the relation type in the schema and match its declared source and target entity types
against the entity objects in that same row. Accept only when exactly one candidate exists
on each side. For a self-referential type, exclude the chosen source from the target
candidates. Anything ambiguous or unresolvable is skipped — never guessed. The graph toggle
itself only appears when at least one cell of the result is an entity object.

**Field projection is deliberately abandoned when a document column is visible.** Hiding
table columns normally narrows the request to the visible fields (always keeping the
identifier), which is cheaper. But a field projection returns document properties as their
*raw full content* rather than as size stubs — stubs only appear in unprojected reads. So
whenever any document column is visible, the projection is dropped entirely, trading the
saving for the guarantee that a table never pulls document bodies. Rendering defends the
same rule independently: a document cell shows a size even if a raw value reaches it.

**Bulk delete is a client loop.** There is no bulk endpoint. Deleting a selection issues
one request at a time, sequentially, advancing a progress indicator and counting failures.
The outcome is reported as a partial result when some failed. The selection is cleared and
the list refreshed regardless of outcome.

**CSV export is entirely client-side.** The server is not involved. From a table it covers
the current page and the currently visible columns, plus the identifier; from a result set
it covers every row and the result's own columns. Object values are JSON-encoded; any value
containing a quote, a comma or a newline is quoted with its quotes doubled.

**The search-data rebuild is a stream, not a response.** The rebuild call answers with
newline-delimited JSON objects, one per line, which must be read incrementally — a client
that waits for a complete JSON body will hang until the whole rebuild finishes. Two event
kinds appear: progress events carrying a group key, a processed count and a total — the
saved queries form one pseudo-group at the end, present only when a provider is
configured, and an adapter without search indices sends one group per entity type before
it — and exactly one final summary carrying the overall processed and failed counts and
whether the embeddings were skipped. A stream that ends without a summary is an error,
not a success.

**Entity search shows no number.** The palette, relation target picker and extraction
review use the server’s ranking order and ignore relative scores. What found a hit is
shown only as the [matched-via](#matched-via) line, whose relation-group label the client
resolves through the lens's search catalog; no passage text is shown. Extraction review
searches properties only, offers up to three candidates without a floor, and defaults
to creating a new entity. Saved-query discovery keeps its separate cosine score.

**Scoped-versus-unscoped cannot be read from the lens.** The lens's runtime schema does not
report its own inclusions, so "scoped" and "unscoped" are determined by asking the modeling
surface for the lens's inclusion lists and checking whether any exist. Every scope marker
in the product is derived that way.

### Local state

Persisted on the client, nowhere else. Everything else is either server state or lives in
the address.

| What | Scope | Cap |
|---|---|---|
| Last-used lens | Per ontology | — |
| Theme preference | Global | — |
| Sidebar collapsed | Global | — |
| Explorer working set | Per ontology + lens | Bounded by the hard node cap |
| Recently opened entities | Per ontology + lens | 10 |
| Recent query texts | Per ontology + lens | 10 |
| Chat history | Per ontology + lens, then per agent | 50 messages per agent |
| Retriever diagnostics switch (Workbench) | Global | — |

Per-lens state is keyed by ontology **and** lens because lens keys are unique only
within their ontology — two ontologies' `default` lenses must never share a canvas or a
chat. The remembered last-used lens exists per ontology, and only to feed the ontology
switcher's Workbench landing and the Studio's way back; nothing at the root consumes it.

The working set stores only identifiers, type keys, positions and pin flags — entities and
relations are re-fetched on restore, so a stale canvas can never display stale property
values. Ask history and retriever-agent conversations are in-memory for the session and
deliberately not persisted; the selected retriever agent lives in the address.
Persistence failures are swallowed: with storage unavailable the product works exactly the
same, minus the memory.

---

## Deep links

Every one of these is stable and safe to construct externally.

Workbench addresses live under `/o/{ontologyKey}/w/{lensKey}`, Studio addresses under
`/o/{ontologyKey}/studio` — the same ontology-first spelling as the API.

| Address | Effect |
|---|---|
| `/` | The "Ontologies" start page — never a redirect |
| `/o/{ontologyKey}/w/{lensKey}` | That lens's Home |
| `/o/{ontologyKey}/w/{lensKey}/t/{typeKey}` | That type's table |
| `/o/{ontologyKey}/w/{lensKey}/t/{typeKey}?new=1` | The table, with quick add open and pre-scoped to the type |
| `/o/{ontologyKey}/w/{lensKey}/e/{typeKey}/{id}` | One entity's detail page |
| `/o/{ontologyKey}/w/{lensKey}/explore` | The canvas, restored from the saved working set |
| `/o/{ontologyKey}/w/{lensKey}/explore?focus={typeKey}:{id}` | The canvas with that entity added, selected and centred |
| `/o/{ontologyKey}/w/{lensKey}/query` | The query console |
| `/o/{ontologyKey}/w/{lensKey}/query?query={text}` | The console with the query prefilled |
| `/o/{ontologyKey}/w/{lensKey}/query?tab=library` | The saved-query library |
| `/o/{ontologyKey}/w/{lensKey}/query?run={queryKey}` | The library with that query expanded, run at once when it has no parameters |
| `/o/{ontologyKey}/w/{lensKey}/ai` | The AI panel, Chat |
| `/o/{ontologyKey}/w/{lensKey}/ai?tab=ask` · `?tab=extract` · `?tab=retriever` | The other three AI modes |
| `/o/{ontologyKey}/w/{lensKey}/ai?tab=retriever&agent={agentKey}` | The Retriever tab with that retriever agent; the first agent when the lens has no such agent |
| `/o/{ontologyKey}/studio` | The ontology's schema overview |
| `/o/{ontologyKey}/studio/entity-types/{id}` · `.../relation-types/{id}` | A type editor |
| `/o/{ontologyKey}/studio/lenses` | The lens list |
| `/o/{ontologyKey}/studio/lenses/{id}` | A lens, Scope tab |
| `/o/{ontologyKey}/studio/lenses/{id}?tab=agents` · `?tab=retriever-agents` · `?tab=queries` · `?tab=connect` | The other lens tabs |
| `/o/{ontologyKey}/studio/lenses/{id}?tab=retriever-agents&agent={agentKey}` | That retriever agent's editor and test panel |
| `/o/{ontologyKey}/studio/search` | The search index list |
| `/o/{ontologyKey}/studio/search?tab=settings` | The search settings |
| `/o/{ontologyKey}/studio/search/new` | The index designer on a new custom index |
| `/o/{ontologyKey}/studio/search/new?entityType={typeKey}` | The same, with the entity type pre-selected |
| `/o/{ontologyKey}/studio/search/{indexKey}` | An index: the designer for a custom index, the read-only view for a managed one |
| `/o/{ontologyKey}/studio/transfer` | Export, import, rebuild search data |

Two consumed parameters are stripped from the address as soon as they are acted on, so that
a reload does not repeat the action: the quick-add trigger and the Explorer focus target.
Any unrecognised address returns to the root.

## Keyboard surface

| Where | Key | Effect |
|---|---|---|
| Anywhere in the Workbench | Cmd/Ctrl+K | Toggle the command palette |
| Anywhere in the Workbench | `c` | Open quick add — ignored while typing and while any dialog is open |
| Palette | ↑ / ↓ | Move through results, wrapping |
| Palette | Enter | Open the selection |
| Palette | Cmd/Ctrl+Enter | Open the selected entity in the Explorer |
| Palette | Backspace on empty input | Leave the type scope |
| Palette | `#` `?` `>` as first character | Switch mode |
| Palette | Escape | Close |
| Table | Enter on a focused row | Open the entity |
| Table | ↑ / ↓ on a focused row | Move focus between rows |
| Table filter popover | Enter | Apply the condition |
| Inline property edit | Enter | Save |
| Inline property edit | Escape | Cancel |
| Inline property edit (multi-line) | Shift+Enter | Newline |
| Studio inline text | Enter (Cmd/Ctrl+Enter when multi-line) | Save |
| Studio inline text | Escape | Cancel without saving |
| Query editor | Cmd/Ctrl+Enter | Run |
| Explorer | `F` | Fit the view |
| Explorer | `P` | Pin or unpin the selection |
| Explorer | Delete / Backspace | Remove selected nodes from the canvas |
| Explorer | Shift or Cmd while clicking | Extend the selection |
| Chat | Enter | Send |
| Chat | Shift+Enter | Newline |
| Ask | Enter | Submit |
| Retriever-agent chat | Enter | Send |
| Retriever-agent chat | Shift+Enter | Newline |
| Forms | Enter | Submit the form |

Single-letter shortcuts are suppressed inside text inputs and while a dialog or popover
layer is open, so typing never triggers navigation.
