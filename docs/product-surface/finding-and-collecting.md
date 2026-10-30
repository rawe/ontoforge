# Finding and collecting

Interaction models for finding entities and gathering them: the command palette, quick add,
the Explorer working set, the query console, the saved-query library and advanced search. The screens that
use them are in [workbench](workbench.md) and [studio](studio.md).

## Command palette

One overlay, five modes, opened from anywhere in the Workbench. Each open starts fresh —
empty input, no type scope, a new snapshot of recents — except for the retriever chosen
for questions, which is remembered.

| Prefix | Mode | Behaviour |
|---|---|---|
| *(none)* | Entities | Cross-type entity search — ranked when the server can run ranked search, otherwise a parallel substring search over every exposed type. Starts at two characters; below that it shows recents or a hint. |
| `#` | Types | Filter the exposed entity types; choosing one *scopes* the palette to that type rather than navigating. |
| `?` | Saved queries | Semantic search over query descriptions when available, substring filtering over the full list otherwise. An empty query lists everything. |
| `>` | Actions | Navigation to each Workbench area, the Studio, and a theme toggle. |
| `!` | Question | A question to a [retriever](../capabilities/retrievers.md#retrieve), answered with the entities it finds. Sent on purpose, never as you type — see [Question mode](#question-mode). Only on a server with a language-model provider. |

Scoping to a type replaces the prefix with a persistent type chip; the search then runs
within that type, an empty query lists that type's first entities, and Backspace on an
empty input removes the scope. Prefixes are inert while a type scope is active.

Entity results retain global ranking order. Each row carries a type chip and display
label, the entity's identity beside it where it has one, and, when the hit was found through a relation or a passage, one muted
[matched via](#matched-via) line beneath. No number, score bar, percentage, numeric aria
label or passage text is displayed. The relation target picker uses the same search hook
and row; its empty input lists the first ten entities. Both use ranked search whenever
the server can run it, falling back to literal entity lists otherwise. Enter
opens entity detail; Cmd/Ctrl+Enter focuses the Explorer.

### Question mode

Typing runs nothing; the input says "Press Enter to ask", and Enter sends the question
(1 to 2,000 characters). While it runs, a status line shows, and Escape — or editing the
question — cancels it without closing the palette. A changed question needs Enter again;
until then the previous results stay, dimmed and marked as answering an earlier question.
Once results arrive, the arrow keys move through them, Enter opens the entity's detail and
Cmd/Ctrl+Enter focuses it in the Explorer, as in entities mode; Enter on the unchanged
question does not resend it.

A chip beside the prefix names the retriever; clicking it lists the lens's retrievers
as the server lists them: `Default` — the lens's
[default retriever](../capabilities/retrievers.md#the-default-retriever) —
first, then the stored ones. The choice is remembered per ontology and lens and falls back
to `Default` when the remembered retriever is no longer listed. A question to a retriever the
lens cannot run shows the server's refusal with its reasons as the error.

Results come in the server's order, with no number or score. A row is the entity row —
type chip, label, the [matched via](#matched-via) line when a relation or passage
matched — plus one muted chip per proven condition in its plain words; a result only
listed by its conditions has no via line. Limitations, when any, sit above the list in one
collapsible note; an unsupported reason is the empty state's message; errors show inline
with the server's message. "Show all in Explorer", below the results, adds every result to
the [working set](#working-set) and opens the Explorer.

## Matched via

Search results never show a score: the server gives only the order, which is no measure
of relevance or confidence. Where the server names the entry that found a hit
([capabilities/search.md](../capabilities/search.md#entity-search)), a hit found through a
relation or a passage carries one short line:

- a relation entry — `via <label> → <target>`: the relation group's label from the lens's
  [search catalog](../capabilities/search.md#the-search-catalog), else the relation type's
  display name, and the target's label, else its truncated identifier; in a retriever's
  results followed by the target's identity in parentheses where it has one;
- a passage entry — `via passage in <property>`, the document property's display name, or
  `via passage` where the lens hides the document;
- the entity's own fields — no line.

The line never shows the entry's text. The palette and the relation target picker use the
[entity search](../capabilities/search.md#entity-search) over the lens's managed indices,
so no relation line appears there; relation lines appear in a retriever's diagnostics and
in the palette's question results, whose searches reach custom indices.

## Quick add

A global create-entity dialog, reachable by keyboard, from the sidebar, from empty states,
and by deep link. Step one picks the entity type (skipped when the caller pre-selected
one — in which case there is no way back to the picker). Opened from a Children section,
it also fixes the parent: an "Under" row shows the parent's hierarchy path and the parent
relation, the relation's own properties come first in the form, and its faults land on
those fields; under a staged create the row says the parent is new in the changeset.
Step two is the schema-driven
form: required properties first, one input per data type, schema defaults pre-filled,
empty optional properties omitted from the request entirely, all client-side coercion
errors collected at once, and server field errors merged onto the matching fields — a
taken identity under each identity property. A
"create and add another" option keeps the dialog open with a fresh form. Closing with
unsaved input asks for confirmation first. On success a toast offers to open the new
entity, unless the create was [staged](workbench.md#changesets).

The same form primitives back quick add, inline target creation in the relation flow and
the relation-property steps, so all of them accept exactly what the lens accepts.

## Working set

The Explorer does not draw "the graph". It maintains a **working set** — the entities the
user deliberately put on the canvas, plus neighbours they expanded into. This is the
central idea of the screen and everything else follows from it.

**Growth is incremental and explicit.** Entities arrive from the palette, from a table
row, from an entity detail page, from a query result, from a recents chip on the empty
canvas, all at once from a palette question's results, from an assistant's answer in the
ask dock, or by expanding a node's relations. A batch of results is placed around the
canvas centroid; entities already on the canvas flash, and
the hard node cap refuses a batch that would exceed it as a whole. Expansion is per relation type and per
direction: the node panel lists every applicable relation type with its exact neighbour
count, and clicking one pulls in the first ten neighbours; repeated clicks pull ten more,
up to two hundred, and stop offering more once the count is exhausted.

**Layout stability is a contract.** Nothing ever repositions a node the user can already
see. New nodes are placed on growing elliptical rings around a placement origin — the
expanding node, or the centroid of the canvas for additions without one — taking the first
slot that does not collide, and falling back to stacking below the placement origin on a
dense canvas.
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
While a [changeset is pinned](workbench.md#changesets), nodes offer no connecting drag: the canvas
writes live only, so the changeset must be left first.

**Caps.** A soft cap of 150 nodes switches the node counter to a warning appearance and
suggests clearing unpinned nodes. A hard cap of 300 refuses further additions with an
explanation; the addition is rejected as a whole, never partially applied.

**Selection.** Selecting one node opens a side panel: the entity's label, type and
identity where it has one, its scalar properties (up
to six non-empty), its document properties as click-to-read entries, the per-relation-type
expansion list, and actions to open the detail page, pin, connect, and remove from the
canvas — the last labelled explicitly as *removing from the canvas, keeping the entity*.
Selecting several shows a bar offering pin-all and remove-from-canvas. Double-clicking a
node opens its detail page.

**Edges.** Clicking an edge opens a small card with the relation type, both endpoints as
links, the relation's own properties, and a delete action behind a confirmation stating
that both entities survive; it is off while a changeset is pinned. Self-referential
relations draw as a loop over their node rather than a degenerate curve. A parent relation's edge is drawn in the parent colour; a
"Hierarchy edges" toggle in the toolbar, offered when the lens has a parent relation,
hides every other edge and moves no node.

**Asking.** With a language-model provider, an Ask button in the canvas toolbar opens a
dock on the canvas's left edge — the right edge belongs to the node panel — holding an
[assistant chat](assistants.md#assistant-chat) with one of the lens's assistants — any agent, retriever
or navigator:

- **Open or closed.** Open, it is resizable. Closing cancels a running answer; reopening
  restores the conversation from its thread.
- **Header.** An assistant picker grouped by kind — navigators, retrievers, agents —
  each kind's `Default` first; another assistant cancels a running answer and shows that
  assistant's own conversation, the same thread as its Workbench tab. Then "New
  conversation" and close.
- **Answers** as in the chat, a navigator's citations as markers. Under each, collapsible
  parts: *Found* — the [entities the answer met](../capabilities/threads.md#the-entities-a-turn-met)
  as compact cards, a navigator's grouped as in the [evidence sidebar](assistants.md#evidence-sidebar),
  each saying whether it is on the canvas and linking to the entity's page — and what the
  kind did: a navigator's *Steps* as the sidebar's Steps view shows them, an agent's tool
  calls as its tool-call panel shows them; a retriever has no such part.
- **A click puts it there, the next click shows it.** Clicking a citation marker or a
  found card adds an entity that is not on the canvas yet, with the answer's relations
  between it and the canvas, and shows it; one already there is only shown: selected,
  centred, ringed like a selected card of the sidebar's graph, its relations drawn
  stronger. Nothing else on the canvas changes.
- **Hover.** Pointing at a marker or a found card rings its node; pointing at a node marks
  its citations in every answer.
- **Adding cited entities.** For a navigator — the only kind whose answers cite — a switch
  in the dock, off by default, adds every completed answer's cited entities and the answer's relations between canvas entities, as one
  batch, then fits the view. Duplicates flash; when the hard cap refuses the batch, the
  answer says its entities were not added.

Additions from answers follow every rule above: each entity is read again by its id and
each relation by its id, never built from the answer's cards; new nodes go next to an
entity they are linked to — a navigator's anchors first and then hop by hop, so paths grow
outward from where they start. Streamed answers never redraw the canvas.

**Persistence and restore.** The working set survives reloads (see
[Local state](client-contracts.md#local-state)). On restore, entities whose type is no longer in scope are
dropped, entities that no longer exist are dropped silently, and only the relations
*between* restored nodes are re-fetched — the canvas never grows by itself across a
reload. The view is then fitted, with padding reserved for the side panel when one is open.

## Query console

An editor for the query language with syntax highlighting, run on demand or by keyboard.
See [capabilities/oql.md](../capabilities/oql.md).

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

## Saved-query library

The run-focused half of the Query screen; authoring lives in the Studio, and every card
links there. A search box over the library — semantic when available, substring otherwise.
Each query is a card showing its name, key, a badge per step kind, a parameter count and
its description. Expanding a card reveals a run panel: one typed input per parameter (all
required before the run is allowed), a run action, results in the shared results surface
— or, when the last step is a search step, the ranked items as
[Advanced search](#advanced-search) lists them, with what ran and what could not — and a
"copy as cURL" action that reproduces the exact call. A query opened by deep link
expands automatically, and runs immediately when it has no parameters.

## Advanced search

One form per field of the [entity search](../capabilities/search.md#entity-search) and the
[passage search](../capabilities/search.md#passage-search); a field left empty is not sent,
so the server's default applies, and the server judges what the form cannot.

**Form.** A mode — Entities or Passages — and the text, run by Enter or Run once it is
not blank. On a wide screen the settings sit in a panel beside the results; on a narrow
one they fold above them into a one-line summary. A scope over one field at a time:
types, indices, or — for passages — document properties, each chosen from a list that can
be searched, indices grouped by type with their kind, a missing method and a state that
is not ready; each field keeps its choice while another is shown. None chosen searches
every type through its managed indices. One choice of methods — Both, Keyword or
Semantic, the last two only on a server with semantic search — with keyword matching by
any or all words and an optional similarity floor. A filter with the
[type table's](workbench.md#type-table) conditions, without `contains`, once every chosen
scope item belongs to one type. A limit, and for passages a cap per entity. A "?" beside
the title explains how search works, step by step over one example.

**Results.** The count, which methods ran, and each limitation as a sentence naming its
types, indices or documents. An entity row has its rank, type chip, name linking to its
detail, the part that matched, its scores and the snippet; a row found through a custom index names
it; a passage row has the entity, the document
property — opening the [document viewer](schema-editing.md#document-viewer-and-editor) — and
the passage text. Beside the part that matched, each method's score — "Semantic 0.82 · Keyword 2.17", two
decimals — with a hover saying the two are not comparable. A rejected field shows its
error under its control; others show verbatim below the form. Results searched with other
settings than the form now shows say so, with a button to run again.
