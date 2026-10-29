# Workbench screens

Find the [home](#home), [type table](#type-table), [entity detail](#entity-detail),
[Explorer](#explore), [query](#query), [rulesets](#rulesets), [changesets](#changesets),
and [assistants](#assistants) screens below.

## Shell

A collapsible sidebar (collapse state persists) carrying: the ontology switcher, the
surface switch and the lens switcher beneath it, a search
trigger, a create-entity trigger, fixed entries for Home, Explore, Query, Assistants when
available, [Rulesets](#rulesets), which carries the number of rulesets whose anchor is
deleted as a red count (a red dot when collapsed), and [Changesets](#changesets), which
carries the number of submitted changesets of the lens as a grey count (a grey dot when
collapsed), then a data section listing every entity type the lens exposes, each with
its type colour. Below: the collapse control and a theme control cycling system → light →
dark. While a changeset is pinned, a [bar](#changesets) runs above every page. Every
screen renders through the lens's schema; there is no hand-written per-type interface
anywhere, so adding an entity type immediately produces a table, a form, a detail page,
palette coverage and canvas support for it.

Each type key is assigned a colour deterministically from a fixed palette, so a given type
looks the same in the sidebar, chips, table badges, canvas nodes, the
[schema graph](schema-editing.md#schema-graph) and search results. Colour is derived from the key alone and needs no server support.

## Home

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
explanation linking to the lens's scope in the Studio; when it exposes types but holds no instances, a
two-step guide — create the first entity from the first type's table, or connect an AI
client through its MCP configuration.

## Type table

A server-driven table over one entity type. Paging, sorting, filtering and text search all
happen on the server; the table only renders what came back. See
[capabilities/instance-data.md](../capabilities/instance-data.md).

Capabilities: page through results (25 rows per page); sort by any property column and by
the created and updated timestamps; free-text search across the type (debounced); add and
remove typed filter conditions; show and hide columns; export the current page as CSV;
select rows and delete them in bulk; open a row's detail; jump a row straight into the
Explorer; read a document property without leaving the table.

Column order puts required properties first, then the rest, then updated and created (the
created column starts hidden). A type with an [identity](../capabilities/entity-identity.md)
the lens shows gets an Identity column, monospaced and shown by default, which sorts,
filters with the string operators, and is part of the CSV export. Document values render as a size badge that opens the
[document viewer](schema-editing.md#document-viewer-and-editor) — never as inline content, and never as
something the row click can swallow.

A filter condition has a subject — a property of the type, or a relation type in one
direction — and the operators on offer depend on it:

| Subject | Operators |
|---|---|
| string property, or the identity | contains, equals, does not equal, is set, is not set |
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
([interfaces/](../interfaces/README.md#listing-sorting-filtering)): strict greater-than and
less-than, and query paths in either form, are not offered. This lists every difference
from the server's vocabulary: a change to the filter vocabulary decides whether the table
offers it and updates this list.

Any change to search, filters or sort returns to the first page. Switching to another type
resets search, filters, sort, column visibility, selection and page. If deleting the last
rows of a trailing page leaves the current page beyond the end, the table clamps back to
the last populated page. Two distinct empty states are shown: "nothing exists yet" (with a
create action) and "nothing matches" (with a clear-filters action).

## Entity detail

Header: display label, type chip, the entity's identity when it has one, creation and
update timestamps, and actions to add a
relation, open the entity in the Explorer, and delete it behind a confirmation that states
the relations will go with it. Above the label, a breadcrumb shows the entity's
[hierarchy path](../capabilities/instance-data.md#the-path-read) from the path read —
ancestors as links, the entity itself last and muted — and nothing for a hierarchy root.
The rulesets whose anchor is the entity show as a chip after the type chip, "Anchor of"
and their keys, linking to the [Rulesets](#rulesets) page, and the delete confirmation
then warns that their writes will be refused until the anchor is moved or removed.
Delete is disabled, saying to delete the children first, while the entity has children
the lens shows; one whose children the lens hides gets the server's refusal as a
message. Opening an entity records it in the recents list used by the command palette and
the Explorer's empty state.

**Properties.** Every property the lens exposes, click-to-edit in place. Editing one field
saves that one field. Enter saves, Escape cancels, booleans save the moment they are
toggled, and a save that would not change anything just closes the editor. Clearing a
required property is refused client-side; server field errors appear under the field.
Saving a changed identity property first asks for confirmation: "This renames the identity.
Anything that addresses this entity by its old identity stops finding it." A taken identity
shows under the field, naming the identity.
Empty optional properties show as a dimmed placeholder and are editable.

Document properties render last, as collapsed rows showing a size badge. Expanding fetches
and renders the content; a separate action opens the [document editor](schema-editing.md#document-viewer-and-editor).
See [capabilities/documents.md](../capabilities/documents.md).

**Staged here.** While the [pinned changeset](#changesets) stages the entity, a strip
under the header shows its staged object as a card of the review, with Remove, Cut and
Accept current — disabled while it is submitted — and links to the review. A property with a staged value shows its
stored value struck through beside the staged one, with its drift marker; a document
shows "staged" with its size and a View action opening the staged text, or "staged ·
removed". A staged delete adds "Deleted in this changeset" to the header. Editing starts
from the staged value.

**Parent and Children.** For an ontology with
[parent relations](../capabilities/schema-modeling.md#parent-relations), the hierarchy comes
first, set apart in the parent colour. *Parent* is one section over every parent relation
whose child end is this entity's type: the entity's parent with an unlink action, or "a
root" when it has none, and an add action. *Children* is one section per parent relation
whose parent end is this entity's type, with its count, its children and a
"+ {child type} under {entity}" button. The button opens [quick add](finding-and-collecting.md#quick-add) with that
type and this parent fixed, so the entity and its parent relation are created in one
request ([capabilities/instance-data.md](../capabilities/instance-data.md#the-create-with-a-parent-relation)).
Parent relations do not appear again among the relations below.

**Relations.** One section per relation type that applies to this entity's type, with a
direction indicator, an exact neighbour count, and the neighbours themselves — each a link
to its detail page, with its identity beside the label where it has one, with a compact summary of the relation's own properties and an unlink
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
   — semantically when available, by substring otherwise — showing each candidate's
   identity beside its label, and offers to create a new entity of that type inline,
   using the same schema-driven form as elsewhere; a taken identity shows under the
   identity properties. A newly
   created entity is selected automatically.
3. Fill the relation's own properties, if it has any. When the relation type has no
   properties this step is skipped and picking a target creates the relation immediately;
   a failure then returns to a properties step so the attempt can be corrected and retried
   rather than lost.

Endpoint errors from the server are surfaced as form-level errors, not silent failures; a
second parent is named by the child's label ("T1 already has a parent"), and a pair a
one-per-pair relation type already links says "Already linked by this relation".

## Explore

The graph canvas, and beside it the ask dock, where an assistant's answers fill the canvas.
See [Working set](finding-and-collecting.md#working-set) for both.

## Query

Two tabs — Console and Library — which both stay live, so results survive a switch. See
[Query console](finding-and-collecting.md#query-console) and [Saved-query library](finding-and-collecting.md#saved-query-library).

## Rulesets

The ontology's [rulesets](../capabilities/rulesets.md), shown through the current lens: one
row per ruleset with its key and a cell per rule. A note under the table says the URLs use
the current lens, that rulesets belong to the ontology, and that every change takes effect
on the client's next call. Per row: copy the ruleset's MCP URL; edit it; show its anchor in
the Explorer; delete it, which needs its key typed and says that clients using its URL get
not found. **New ruleset** and **Edit…** open one dialog: the key on create — part of the
MCP URL, validated live against the ruleset key rule and the existing keys, permanent —
then one section per rule. A save that loosens a rule first asks, one line per loosened
rule; one that only tightens saves at once.

- **Write access:** in the row, the level's chip, its tooltip saying what the level
  allows. In the dialog, the three levels as cards from `none` to `full`, each saying what
  the client can and cannot do, `full` marked as the default. Raising the level loosens.
- **Anchor:** in the row, the anchor's hierarchy path with a link to the entity, "No
  anchor", the deleted entity's type and short id for a deleted anchor, whose row is marked
  red and says every write is refused, or "Hidden by this lens". In the dialog, no anchor
  or an entity, picked by type and search with each result's hierarchy path shown, and
  what it covers. Removing the anchor, moving it out of its subtree, or re-pointing a
  deleted one loosens.

A help button beside the title explains what a ruleset does to a client: write access as a
staircase from `none` to `full`, then the anchor and its subtree, that a write must pass
both, and the two escapes. One example hierarchy plays step by step through it, and the
help links to the [Changesets](#changesets) one for the workflow.

The Studio manages no rulesets: its Connect tab links here.

## Changesets

The lens's [changesets](../capabilities/changesets.md), those started through a ruleset
included, as the lens shows them now. The page starts, reviews, checks, submits, commits and
discards them, and pins one to work in. A help button beside the title of the list and of each review explains the workflow: the states and who
may take each way between them, a client or a person. One example changeset plays step by
step through it in nine steps: calls becoming staged objects with their values, a later
call changing the same object, a document keeping one staged text that takes small edits,
drift found at review, removing an object, cutting a value, accepting current, and the
commit in its phases.

- **The list:** one row per changeset — its number, state, note, ruleset, number of staged objects, the
  types it names (two, then a count, and how many the lens no longer shows) and its age —
  by number, lowest first, submitted ones tinted. A row opens its review. Empty, it
  says the lens has no changesets.
- **The review:** a header with the number, the state, the ruleset — linking to the
  Rulesets page, struck through once the ruleset is deleted — the staged objects per
  operation, the version and the times, and the note. Below, the staged objects in the
  order they were first touched, a page of 100 at a time, each a card: its action, the
  type, the target by name — "(new)" for a create, `from → to` for a relation, a short id
  when the lens shows no name — its markers, the identity it gives an entity (`before →
  after` on a rename, the new one alone on a create), and its values: `key: before → after` for an
  update, with the current value on drift as "(now …)", the values for a create. A marker
  chip with its message sits on the card or under the value it concerns, and tints the
  card; `duplicate identity` says which identity another entity would share. An object the lens no longer shows says so; a document value shows its length, and a View action opens the staged text, as a
  commit would leave it, in the [document viewer](schema-editing.md#document-viewer-and-editor).
- **On a draft**, each card offers Remove, taking the object out with its values; each
  value a scissors action, cutting it out; and a value with drift "Accept current",
  rebasing it so its before becomes the current value. While submitted they are disabled,
  saying it is frozen.
- **Commit**, behind a confirmation naming the number of staged objects, sends the version on the
  screen. When the changeset changed since, it says so and reloads the review; any other
  conflict shows its message and reloads too. A rejected commit lists its violations in a
  panel, each named by its object and property where the page shows them, and each of a
  ruleset's kinds under a label saying what went wrong, which on a
  submitted changeset offers to unsubmit it at once with those
  violations as its note, cut to 1,000 characters. A successful one returns to the list
  and refreshes every runtime view of the ontology.
- **Check**, beside Submit, on a draft or a submitted changeset, runs the commit without
  persisting anything: a pass says how many staged objects a commit would persist, and a
  failure lists the violations in the same panel, with the version checked.
- **Submit** asks for an optional note, which replaces the stored one, and works on a draft
  only; while submitted it is disabled, saying so. A submit refused by its faults lists its
  violations in the same panel, and the changeset stays a draft.
- **Unsubmit** asks for the required note and works on a submitted changeset only; on a
  draft it is disabled, saying so. **Discard**, behind a confirmation, works on a draft
  changeset only; while submitted it is disabled, saying it is frozen.

A changeset that is gone — committed, discarded or expired, or not reached through this
lens — shows a not-found state linking to the list.

**Working in a changeset.** A person stages by pinning a draft. "Start changeset" above
the list starts one, with an optional note, pins it and opens its review; "Work in this
changeset", on a draft's row and in its review's header, pins it in place of any other;
"Leave", there and on the bar, unpins it, and so does committing or discarding it from its
review. One changeset is pinned per lens, [remembered](client-contracts.md#local-state) in the browser, and
every open tab follows a pin or a leave at once. While one is pinned:

- **The bar** above every Workbench page names it by its number and note, with its number
  of staged objects, that staging is refused once it is submitted, Review and Leave.
- **Every Workbench write is staged** into it instead of written — the entity page's
  edits, delete, unlinks and added relations, a target created on the way included,
  [quick add](finding-and-collecting.md#quick-add) with its parent relation, and a table's bulk delete — except the
  Explorer canvas's ([Working set](finding-and-collecting.md#working-set)). Each answers with a toast saying it was
  staged — for an entity delete, with how many staged relations at it went too — a bulk
  delete with one for all, linking to the review; live views stay as they are.
- **A staged create** on the review of a draft offers "Edit values…" — the entity form
  with its staged values, staging an update of what changed — and "Add ‹child type›…" per
  parent relation its type is the parent end of, naming the relation where two reach the
  same child type, opening quick add under it. While the
  changeset is not the pinned one, the card says to work in it to extend it.
- **A pinned changeset that is gone** is left, with a message that writes are live again.

## Assistants

Three tabs — Agents, Retrievers and Navigators. See [Assistants panel](assistants.md#assistants-panel). Without a language-model
provider the navigation entry is gone and the screen renders an explanation; see
[Feature gating](README.md#feature-gating).
