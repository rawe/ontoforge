# Product surface

What the web client offers. It is a static application that reaches the server over REST
only and holds no privileged path — see [architecture.md](architecture.md). Concepts and
vocabulary: [README.md](README.md). Capability semantics are not repeated here; each
section links to the capability document that owns them.

This document is the capability inventory. It is complete on *what the product does* and
deliberately silent on how it is built.

## The two surfaces

| | Workbench | Studio |
|---|---|---|
| Subject | Instance data seen through one lens | The global schema and the lenses themselves |
| Addressed by | An ontology key, then type keys | Type and ontology identifiers |
| Answers | "What is in the graph?" | "What can be in the graph?" |

The two never mix. Nothing in the Workbench edits the schema; nothing in the Studio
touches instance data. Each surface has its own shell, and each links to the other: the
Workbench sidebar has a Studio entry, the Studio sidebar returns to the last-used lens.

### Choosing and remembering a lens

The Workbench is always bound to exactly one lens, named in the address. The client
remembers the last lens used and restores it on the next visit.

- Opening the application resolves to the remembered lens if it still exists on this
  server, otherwise to the lens picker. A remembered key that no longer resolves is
  forgotten rather than retried.
- The picker lists every ontology as a card: name, key, description, the number of entity
  and relation types the lens exposes, and whether it is scoped. Choosing one records it
  as the remembered lens. A tile alongside leads to lens creation in the Studio.
- The sidebar switcher changes lens from anywhere and records the new one.
- Navigating to an unknown lens key shows a dedicated not-found state which forgets the
  remembered lens and offers the picker; it never silently redirects.
- Per-lens client state (see [Local state](#local-state)) is keyed by the lens, so
  switching lenses never leaks a working set, a chat or a query history across the
  boundary.

---

## Workbench screens

### Shell

A collapsible sidebar (collapse state persists) carrying: the lens switcher, a search
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

Filter operators are constrained by data type:

| Data type | Operators |
|---|---|
| string | contains, equals |
| integer, float, date, datetime | equals, ≥, ≤, between |
| boolean | is |
| document | none — not filterable |

`between` is a client convenience: it is sent as a ≥ / ≤ pair on the same property.
Applied conditions appear as removable chips with a clear-all action.

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

Three tabs — Chat, Ask, Extract — all live simultaneously, so a long extraction survives a
tab switch. See [AI panel](#ai-panel). Absent entirely when no language-model provider is
configured.

---

## Studio screens

### Schema

The global schema, in two interchangeable views: a two-column list of entity types and
relation types, and a [diagram](#schema-diagram). Each card shows the type's key, display
name, property count and description; a relation type card also shows its endpoints.
From here: create an entity type, create a relation type, and validate the whole schema.
Validation results appear inline as a pass marker or a list of path-and-message issues.

Creating a type asks for a display name, a key and a description. The key is proposed from
the display name (lower-cased, non-alphanumerics collapsed to underscores, leading digits
dropped), validated live against the key pattern, and permanent — the form says so.
Creating a relation type additionally asks for source and target entity types, which are
permanent too.

### Type editor

One screen for both entity types and relation types.

Editable in place: display name and description. Immutable and labelled as such: the key,
and a relation type's endpoints. Deletion is offered behind a confirmation and may trigger
the [cascade flow](#cascade-confirmation).

A properties table lists key, display name, data type, required flag, default and
description, with add, edit and delete per row. In the property dialog the key and the data
type are immutable once created; display name, description, required flag and default may
change. The default is entered with an input matched to the data type. Document is offered
as a data type on entity types only. Creating a required property may trigger the cascade
flow. Deleting a property warns that existing stored values remain in the database but
leave the schema. See [capabilities/schema-modeling.md](capabilities/schema-modeling.md).

### Ontologies

A list of every lens with its key and a scope marker — either "unscoped", or "scoped" with
the number of included types. Creation asks for a name, a derived-but-editable key and a
description, and states plainly that a new lens starts unscoped and therefore exposes
everything.

### Ontology detail

Inline-editable name and description, an immutable key, a scope marker, an entry into the
Workbench for this lens, and deletion behind a confirmation stating that the lens, its
scope, its agents and its saved queries go — while the global schema and all instance data
stay. Four tabs:

**Scope** — the [scope editor](#scope-editor).

**Agents** — create, edit and delete the lens's agents: name, derived-and-then-immutable
key, description, system prompt, and either all tools or an explicit checklist of the
read-only runtime tools (at least one required). The list shows each agent's tool posture
at a glance. See [capabilities/ai-agents.md](capabilities/ai-agents.md).

**Saved queries** — the authoring surface for the lens's stored pipelines, and the only
place multi-step pipelines can be built. Per query: name, derived-and-then-immutable key,
description, an ordered list of steps, and a parameter list. A step is either a query step
carrying query text, or a semantic-search step carrying an entity type, search text, a
result limit and a minimum score. Steps can be reordered and removed; every step after the
first can bind parameters to fields of an earlier step's results. Parameters carry a name,
a description and a scalar data type (document is not offered). An inline runner executes
the query with typed parameter inputs and shows the result as a table or as raw JSON. See
[capabilities/saved-queries.md](capabilities/saved-queries.md).

**Connect** — two ready-to-paste AI-client configurations for this lens, one carrying the
lens key in the address and one carrying it in a header, each covering both the modeling
and the runtime MCP server. Only the runtime entry is actually bound by the key: the
modeling server is global and reads no lens from its address
([interfaces.md](interfaces.md#how-each-resolves-a-lens)). Both configurations are copyable
and both are built from the address the client itself was served from, with a note to
substitute the backend host when clients connect directly.

### Transfer

Three operations, each with its own explanation. See
[capabilities/transfer.md](capabilities/transfer.md).

- **Export** — downloads the whole schema as a JSON file.
- **Import** — takes a JSON file, reports malformed JSON before sending anything, and on a
  key conflict explains that pre-existing objects with the same keys block the import and
  that the clashes must be resolved (or an empty instance used). A successful import
  refreshes every cached view.
- **Rebuild embeddings** — behind a confirmation warning about duration and provider cost,
  then live progress per entity type while it runs and a summary when it finishes. The
  action is disabled with an explanation when no embedding provider is configured.

---

## Interaction models

### Command palette

One overlay, four modes, opened from anywhere in the Workbench. Each open starts fresh —
empty input, no type scope, a new snapshot of recents.

| Prefix | Mode | Behaviour |
|---|---|---|
| *(none)* | Entities | Cross-type entity search — semantic when available, otherwise a parallel substring search over every exposed type. Starts at two characters; below that it shows recents or a hint. |
| `#` | Types | Filter the exposed entity types; choosing one *scopes* the palette to that type rather than navigating. |
| `?` | Saved queries | Semantic search over query descriptions when available, substring filtering over the full list otherwise. An empty query lists everything. |
| `>` | Actions | Navigation to each Workbench area, the Studio, and a theme toggle. |

Scoping to a type replaces the prefix with a persistent type chip; the search then runs
within that type, an empty query lists that type's first entities, and Backspace on an
empty input removes the scope. Prefixes are inert while a type scope is active.

Entity results are grouped by type. Each row carries a type chip, the display label, and —
for semantic hits — a similarity bar. A hit matched inside a document additionally shows
which document property matched and a snippet of the matching passage. Enter opens the
entity's detail page; Cmd/Ctrl+Enter opens it focused in the Explorer instead. Selection is
maintained explicitly so that results arriving after a debounce still leave the first row
highlighted.

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

Three modes over one lens. All require a language-model provider; see
[capabilities/ai-agents.md](capabilities/ai-agents.md).

**Chat** — a conversation with the lens's default assistant or with any configured agent,
chosen from a picker. Each agent keeps its own persisted thread; switching agents switches
threads. Messages render as Markdown. Where the assistant used tools, the message carries
a collapsible list of the calls and their arguments. Sending keeps the pending message
visible and shows a live elapsed-seconds indicator, because local models routinely take
tens of seconds and silence would read as a hang. A failed send keeps the text, and offers
retry or dismiss. Clearing the thread is confirmed.

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
   Where semantic search is available, each proposal is checked against existing entities
   of its own type; close matches are offered as a "use this existing one instead" choice,
   which turns that proposal into a link rather than a creation. A relation is blocked —
   with the reason spelled out — when its type is out of scope, when an endpoint is not
   among the proposals, or when an endpoint is neither checked for creation nor mapped to
   an existing entity. The raw response can be inspected at any point.
3. *Accept.* Creation runs in two passes: entities first, then relations with their
   endpoints resolved from the mapping of proposal to created-or-existing identifier.
   Progress is per item and visible as it happens. Items that fail keep their error, stay
   editable and stay listed, so accepting again retries only what is left; items that
   succeeded are marked and skipped. The outcome is reported as counts, and the first
   created entity can be opened in the Explorer.

### Schema diagram

A read-only picture of the global schema: one node per entity type in its colour, one
labelled edge per relation type, laid out left to right. Pan, zoom and drag are available;
nothing can be created, connected or deleted here. Double-clicking a node opens that type's
editor. The layout is recomputed when the schema itself changes, not when a node is
dragged. Relation types with a missing endpoint are omitted rather than drawn dangling.

### Scope editor

Two panes side by side: what is *declared*, and what that *produces*.

The left pane is a checklist of every entity type and relation type in the global schema —
not just the ones already included. Checking a type includes it with all its properties.
An included row expands into a per-property editor offering either "all properties" or an
explicit selection; in explicit mode, properties that are required and have no default are
checked, locked and labelled, because a lens that hid them could not create valid data.
The pane also offers ontology validation, and states the rule that a relation type is only
usable when both of its endpoint types are also in scope.

An unscoped lens is called out prominently: it exposes the whole schema, and checking any
type begins scoping — after which *only* checked types remain visible. This is the one
transition in the product that silently narrows what a running client can see, so it is
stated rather than implied.

The right pane is a **live lens preview** rendered from the lens's own runtime schema: the
entity types it exposes with their exposed property keys and required markers, and the
relation types with their endpoints and properties. Every scope edit refreshes it, so the
consequence of a checkbox is visible immediately and in the same terms the runtime API
uses. This is what makes the inferred relation-type inclusion comprehensible without
reading the rules. See [capabilities/ontology-lenses.md](capabilities/ontology-lenses.md).

### Cascade confirmation

A schema change that would invalidate a lens is refused by the server and named. The client
turns that refusal into a two-step confirmation rather than an error: it captures the
conflict, shows the server's message together with the list of affected lenses, and offers
to apply the change *with* the cascade — which re-runs the identical operation with
explicit consent. Cancelling leaves nothing changed. The flow is attached wherever such a
change can originate: deleting an entity or relation type, deleting a property, and adding
a required property. See [capabilities/schema-modeling.md](capabilities/schema-modeling.md).

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
the answer as never going stale. Two flags are reported: semantic search and AI. Neither is
inferred from a failed call — the client never probes.

Gated areas explain themselves rather than vanishing, except in navigation, where a dead
entry would be worse than an absent one. Navigation is gated optimistically: the AI entry
is shown unless the report has explicitly said AI is off, so it does not flicker into
existence while the report is loading.

| Off | What changes |
|---|---|
| AI | The AI navigation entry, the AI palette action and the AI quick action are gone. The AI screen itself renders an explanation. The empty-state extraction step stays visible but dimmed, with an explanation. |
| Semantic search | Entity search everywhere falls back to substring matching — per type in parallel when unscoped. Saved-query search falls back to client-side substring filtering over the full list. Extraction review skips the duplicate check entirely. Embedding rebuild is disabled with an explanation. |

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

**Entities have no name field; the label is a fallback chain.** In order: `name`, `title`,
`label`, `display_name`, then the first non-system property holding a non-empty string,
then the first twelve characters of the identifier. It is applied everywhere an entity is
named — tables, detail headers, search results, canvas nodes, relation rows, toasts — and
the extraction review applies the same chain to a *proposed* property bag, falling back to
an explicit "unnamed" marker.

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

**Embedding rebuild is a stream, not a response.** The rebuild call answers with
newline-delimited JSON objects, one per line, which must be read incrementally — a client
that waits for a complete JSON body will hang until the whole rebuild finishes. Two event
kinds appear: progress events carrying an entity type key, a processed count and a total
(saved queries appear as their own pseudo-type at the end), and exactly one final summary
carrying the overall processed and failed counts. A stream that ends without a summary is
an error, not a success.

**Two scores exist, and only one may be shown.** A semantic result carries a top-level
score and a per-match similarity, and what each one means is in
[capabilities/search.md](capabilities/search.md#fusion-and-what-a-fused-score-is-not). The
client contract on top of that: **only the match similarity is ever displayed or
thresholded**; the fusion score is used for nothing but the order the server already put
the results in. Every percentage in the product — the palette's similarity bar, the
relation target picker, the duplicate suggestions in extraction review — reads the match
similarity. When a search runs in a single mode the two numbers happen to coincide; nothing
may depend on that. For the same reason the extraction duplicate check restricts itself to
entity embeddings: mixing in document matches would fuse the ranking and make its
similarity threshold incomparable.

**Scoped-versus-unscoped cannot be read from the lens.** The lens's runtime schema does not
report its own inclusions, so "scoped" and "unscoped" are determined by asking the modeling
surface for the lens's inclusion lists and checking whether any exist. Every scope marker
in the product is derived that way.

### Local state

Persisted on the client, nowhere else. Everything else is either server state or lives in
the address.

| What | Scope | Cap |
|---|---|---|
| Last-used lens | Global | — |
| Theme preference | Global | — |
| Sidebar collapsed | Global | — |
| Explorer working set | Per lens | Bounded by the hard node cap |
| Recently opened entities | Per lens | 10 |
| Recent query texts | Per lens | 10 |
| Chat history | Per lens, then per agent | 50 messages per agent |

The working set stores only identifiers, type keys, positions and pin flags — entities and
relations are re-fetched on restore, so a stale canvas can never display stale property
values. Ask history is in-memory for the session and is deliberately not persisted.
Persistence failures are swallowed: with storage unavailable the product works exactly the
same, minus the memory.

---

## Deep links

Every one of these is stable and safe to construct externally.

| Address | Effect |
|---|---|
| `/` | The remembered lens, else the lens picker |
| `/welcome` | The lens picker |
| `/w/{ontologyKey}` | That lens's Home |
| `/w/{ontologyKey}/t/{typeKey}` | That type's table |
| `/w/{ontologyKey}/t/{typeKey}?new=1` | The table, with quick add open and pre-scoped to the type |
| `/w/{ontologyKey}/e/{typeKey}/{id}` | One entity's detail page |
| `/w/{ontologyKey}/explore` | The canvas, restored from the saved working set |
| `/w/{ontologyKey}/explore?focus={typeKey}:{id}` | The canvas with that entity added, selected and centred |
| `/w/{ontologyKey}/query` | The query console |
| `/w/{ontologyKey}/query?query={text}` | The console with the query prefilled |
| `/w/{ontologyKey}/query?tab=library` | The saved-query library |
| `/w/{ontologyKey}/query?run={queryKey}` | The library with that query expanded, run at once when it has no parameters |
| `/w/{ontologyKey}/ai` | The AI panel, Chat |
| `/w/{ontologyKey}/ai?tab=ask` · `?tab=extract` | The other two AI modes |
| `/studio` | The schema overview |
| `/studio/entity-types/{id}` · `/studio/relation-types/{id}` | A type editor |
| `/studio/ontologies` | The lens list |
| `/studio/ontologies/{id}` | A lens, Scope tab |
| `/studio/ontologies/{id}?tab=agents` · `?tab=queries` · `?tab=connect` | The other lens tabs |
| `/studio/transfer` | Export, import, rebuild |

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
| Forms | Enter | Submit the form |

Single-letter shortcuts are suppressed inside text inputs and while a dialog or popover
layer is open, so typing never triggers navigation.
