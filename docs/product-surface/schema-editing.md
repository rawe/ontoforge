# Schema and document editing

Interaction models for editing a design and long text: the schema graph, outline,
palette and issues, the scope editor, cascade confirmation, and the document viewer and
editor.

## Schema graph

The default view of the [Schema](studio.md#schema) screen and the place where the schema is edited
visually. Every gesture writes at once, through the same operations, confirmations and
cascade flow as the classic view.

**Nodes and edges.** One node per entity type in its colour, with display name, key and
its property list — the name property first, then the rest by key, each row showing the
key, a required marker, a tag on the name property and the data type. After six rows the
rest folds behind "+N more". A node's chevron collapses its list to a property count;
`H` collapses or expands every node, Shift+H only the selected one, and the collapsed
lists are remembered per ontology. One edge per relation type, with an arrowhead at the
target and the key as its label; a parent relation's edge is drawn thicker in the parent
colour, violet, with a dot on its parent end; another one-per-pair relation type's label
carries a small "one per pair" badge. Relation types between the same two entity types, in
either direction, curve apart so none overlap; self-relations are loops above their node,
nesting outward; a label slides along its edge to stay clear of nodes and earlier labels.
A relation type whose endpoint type is missing is not drawn. The canvas follows the app's
theme, and each node carries its [issue](#schema-issues) count.

**Layout — computed once, then kept.** The first open lays the graph out automatically,
left to right, and remembers the positions. After that only the user moves nodes:
dragging is remembered, and schema edits never re-lay out. A type created on the canvas
stays where it was created; one created elsewhere — the palette, the classic view,
another client — goes to the free spot nearest the centre of the view. *Tidy layout*
re-runs the automatic layout, animates once, fits the view and remembers the result.
Positions are remembered per ontology in the browser only ([Local state](client-contracts.md#local-state)):
the server never sees them, and they are not part of export or import. Pan and zoom are
kept for the session, so coming back from the classic view shows the graph as it was
left. With nothing to restore or reveal, the first view fits all nodes.

**Selection.** Clicking a node selects its entity type, clicking an edge or its label the
relation type, and clicking the empty canvas clears the selection; clicking a property row
on a node selects the type with that property opened. A selection made on the canvas does
not move the view, except to keep the selected node fully visible: when the canvas narrows
— the inspector opens or the sidebar expands — or a type is created on it, the view pans just enough to show the
node. One made anywhere else — outline, palette, issues, the address, a jump link, a
return from the classic view with another selection — pans to the node or frames the
relation type's two endpoints.

**Creating and connecting.** Double-clicking the empty canvas, the toolbar's
"+ Entity type", or `N` (at the centre of the view) shows a placeholder node and a naming
popover; Enter creates the entity type where the placeholder stood and selects it, while
Escape, Cancel or a click on the canvas closes the popover with nothing sent. Hovering or
selecting a node shows a "+" handle; dragging it draws a connection line, and the whole of
every node becomes a drop target, the one under the pointer marked. Dropping on another
node opens "New relation type" with source and target shown and a pending edge; dropping
on the same node opens "New self-relation"; dropping on empty canvas opens "New relation
to a new entity type", which creates the entity type at the drop point first and then the
relation type. If the relation type then fails, the entity type stays and the popover
switches to the relation type against it, keeping the typed name and showing the error.
Escape during a drag ends it with no popover. Nothing reaches the server before Enter.
Keys and endpoints are permanent: there is no reverse or retarget.

**Inspector.** While a type is selected, a panel docks beside the canvas, which stays
usable: the type's header, properties and — for an entity type — relation types, then
delete; the same parts as the [type page](studio.md#type-page-classic-view), in compact form. Its
top row switches to the classic view or closes the panel, clearing the selection. With no
relation type yet, it says to drag the node's "+" onto another type. `Del` or Backspace
deletes the selected type through the [delete dialog](studio.md#type-page-classic-view).

**Focus and search.** Focus mode — `F`, the toolbar or the palette — keeps the selected
entity type and its one-hop neighbours, or a selected relation type's two endpoints, and
dims the rest; the view fits them, and a pill names what is in focus. It follows the
selection; with nothing selected it hints to select a type first; `F` or Escape leaves it.
While the [outline](#schema-outline)'s search is active, matching nodes are ringed, edges
stay lit when they or both their endpoints match, the rest dims, and a pill counts the
matching entity and relation types.

**Hierarchy.** The toolbar's Hierarchy toggle dims every entity type no parent relation
touches and every other relation type, like focus mode but without moving the view, and
combines with focus and search. It is not remembered.

**Toolbar and hints.** The toolbar offers "+ Entity type", tidy layout, fit view, hide or
show all properties, focus and Hierarchy; zoom controls sit at the bottom, and a hint bar inside the
canvas lists the gestures and keys. Escape steps back in order: the drag or popover, then
focus mode, then the selection.

## Schema outline

On the left of the [Schema](studio.md#schema) screen in both views: a search box, then the entity
types (colour, display name, key, issue count, property count) and the relation types
(display name, key, source → target, issue count, property count; a parent relation with
a dot in the parent colour naming its parent end, another one-per-pair relation type with
the "one per pair" badge), each row expandable to
its properties — key, name-property tag, required marker, issue marker and data type. Clicking a type selects
and reveals it; clicking a property selects its owner with that property opened. The
selected row scrolls into view, and a property opened elsewhere expands its owner here.

Search matches the keys and display names of types and properties, case-insensitively,
anywhere in the text. The outline narrows to matching types, matching properties are
highlighted with their owners expanded, and the [graph](#schema-graph) highlights the
matches. Enter selects the first match; Escape clears the search and leaves the box; when
nothing matches the outline says so. `/` from anywhere on the page focuses the search.
The outline collapses to a narrow rail, remembered per ontology; `/` opens it again.

## Schema command palette

The Schema screen's own palette, distinct from the Workbench's
[command palette](finding-and-collecting.md#command-palette). Cmd/Ctrl+K, also while typing, or the header's
Commands button opens it in both views; each open starts at the root with an empty input.

- **Actions** — new entity type, new relation type, add a property to the selected type
  or to a chosen one, focus, switch view, hide or show all properties and those of the
  selected entity type, tidy layout, delete the selected type, a theme toggle, and
  collapse or expand the sidebar. Focus, the property toggles and tidy layout are offered
  on the graph only. Every command whose key works in the current view shows it.
- **Go to** — every type with its key, a relation type also with its endpoints; choosing
  one selects and reveals it.
- **Quick create** — a line `source -name-> target` or `source name target` creates a
  relation type. An endpoint matches an entity type's key or display name,
  case-insensitively, or the key derived from it; unknown endpoints are named and created
  as new entity types first, each once. An invalid or taken relation key, or an invalid
  key for a new entity type, disables the entry and says why. Running it selects and reveals the new relation type; types created before a
  failure stay.
- **Add property** — one entry per type, once something is typed.

New entity type takes a display name, derives and checks the key, and creates the type.
Adding a property takes "Name" or "Name : type" and lists the matching data types,
`string` first and document only for entity types; Enter adds it as an optional property
and selects its owner. "Open the full property form…" opens the owner's add form in the
inspector or on the type page instead. Backspace on an empty input returns to the root,
and a footer names the keys. Single-key shortcuts work straight after the palette closes.

## Schema issues

Quality hints computed in the client from the loaded schema — warnings only, never in the
way of a change, and costing no request:

- an entity type, relation type or property without a description;
- an isolated entity type, which no relation type uses as source or target (a
  self-relation counts as use);
- an entity type with no property besides its name property.

The header's Issues button shows the count, marked amber when there are any. Its popover
groups them by kind and states that nothing there blocks a change; clicking one selects and
reveals its type and, for a property, opens that property. Graph nodes and outline type
rows carry an amber count, outline property rows an amber dot.

## Scope editor

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
amber, [warnings](../capabilities/ontology-lenses.md#validation-warnings) — such as an
included search index reading a property the lens hides; warnings never fail it.

An unscoped lens is called out prominently: it exposes the whole schema, and checking any
type begins scoping — after which *only* checked types remain visible. This is the one
transition in the product that silently narrows what a running client can see, so it is
stated rather than implied.

A **Search indices** section follows the types. A scoped
lens lists every index of the ontology, managed and custom, grouped by root entity type
in schema order, each with its name, key, entity type, kind and an "off" marker when
switched off in the search settings; its checkbox includes or removes the index at once.
An index can be included only while its entity type is: otherwise its checkbox is
disabled with a hint to include the type first. Including an entity type also includes
its managed indices — switched-off ones too — which can then be unticked; a failure there
is reported and never undoes the type inclusion. Removing an entity type keeps the index
inclusions rooted on it, flagged as not in scope. An unscoped lens shows only a note that
every index is available
([capabilities/ontology-lenses.md](../capabilities/ontology-lenses.md#search-through-a-lens)).

The right pane is a **live lens preview** rendered from the lens's own runtime schema: the
entity types it exposes with their exposed property keys and required markers, and the
relation types with their endpoints and properties. Every scope edit refreshes it, so the
consequence of a checkbox is visible immediately and in the same terms the runtime API
uses. This is what makes the inferred relation-type inclusion comprehensible without
reading the rules. See [capabilities/ontology-lenses.md](../capabilities/ontology-lenses.md).

## Cascade confirmation

A change that would invalidate a lens or a custom search index is refused by the server
and named. The client turns that refusal into a two-step confirmation rather than an
error: it captures the conflict and shows, in its own words rather than the server's
message, what the cascade updates — the scope of the lenses, the search indices (an index
left with nothing to read is deleted) — above a list of the affected lenses and a list of
the affected search indices. It offers to apply the change *with* the cascade, which
re-runs the identical operation with explicit consent. Cancelling leaves nothing changed.
The flow is attached wherever such a change can originate: deleting an entity or relation
type, deleting a property, adding a required property, deleting a custom search
index, and setting an entity type's identity, where it adds what the identity changes. For a schema deletion, the [delete dialog](studio.md#type-page-classic-view) itself turns
into this confirmation. See
[capabilities/schema-modeling.md](../capabilities/schema-modeling.md#the-cascade-protocol).

## Document viewer and editor

Document properties never appear inline anywhere — every read carries a size stub, and the
client renders it as a size badge. Two surfaces open them.

The **viewer** is a read-only overlay that fetches the full content on open and renders it
as Markdown. It is reachable from a table cell, from the Explorer's node panel, from the
entity detail row, and from a changeset's review and an entity's staged values, where it
shows the staged text; it is the same overlay everywhere.

The **editor** is a large two-tab surface — write as Markdown, preview as rendered — that
loads the current content, edits it as one whole string, and saves it as an ordinary
property update. Clearing the text clears the property, which is refused when the property
is required. The write pane keeps a fixed height and scrolls internally rather than growing
with the document. The client does not offer partial or ranged document edits; those exist
on the API for programmatic callers. See
[capabilities/documents.md](../capabilities/documents.md).
