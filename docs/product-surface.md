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
  Workbench (or, with none, a link to create one in the Studio), an "Open Studio"
  action, and a ⋯ menu with Rename and Delete. Rename
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
| Addressed by | Ontology key and lens key, then type keys | Ontology key, then type keys and lens identifiers |
| Answers | "What is in the graph?" | "What can be in the graph?" |

The two never mix. Nothing in the Workbench edits the schema, a lens, a search index or a
retriever — it only uses them; nothing in the Studio touches instance data. Each surface
has its own shell, and the [surface switch](#the-surface-switch) leads from any page of
one to its equivalent on the other.

### The surface switch

A two-part "Studio | Workbench" control beneath the ontology switcher, in the same place
in both sidebars; the current surface is filled, the other names on hover where it leads.
The switch and every entry that opens a surface carry that surface's one icon; links to a
particular lens carry the lens icon.

| From the Workbench | Leads to the Studio's |
|---|---|
| A type table or an entity of that type | Schema graph, that entity type selected |
| Query | Lens detail of the current lens, Saved queries tab |
| Assistants | Lens detail, the tab of the open assistant kind |
| Home, Explore, Changesets | Lens detail, Scope tab |
| Rulesets | Lens detail of the current lens, Connect tab |

| From the Studio | Leads to the Workbench's |
|---|---|
| Lens detail | That lens: Saved queries → Query's library, an assistant tab → that kind in Assistants, any other tab → Home |
| Schema, an entity type selected | That type's table in the target lens; the lens's Home with a notice when the type is not in its scope |
| Anything else | Home of the target lens |

The **target lens** is the ontology's remembered last-used lens, else its first unscoped
lens, else its first lens. With no lens at all the Workbench part shows as unavailable and
leads to the Studio's lens list.

An entity type the lens does not show — reached by the switch, or by the address of its
table or of one of its entities — is named as such, with links to the same type in each of the ontology's lenses that show it and to the
lens's scope in the Studio.

### The two switchers

Two stacked dropdowns in the sidebar, one per containment level — never a combined menu.

- The **ontology switcher** sits atop the sidebar of both surfaces. Switching keeps the
  surface: from a Studio it goes to the other ontology's Studio; from a Workbench it
  goes to the target ontology's target lens (see above) — a stale remembered key being
  forgotten rather than retried — and to its Studio's lens list when it has no lens.
  Its "Manage…" entry leads to the start page.
- The **lens switcher** sits beneath the surface switch in the Workbench only, listing
  only the current ontology's lenses. Choosing one records it as that ontology's last-used
  lens. Its "Manage lenses…" entry leads to the Studio's lens list.

A lens becomes the last-used one only once the Workbench has loaded its schema. A
remembered lens that answers not found, or is no longer among the ontology's lenses, is
forgotten.

Navigating to an unknown ontology — in the Workbench or the Studio — shows a dedicated
not-found state offering the start page; an unknown lens shows one which forgets the
remembered lens and offers the ontology's lens list in the Studio as well as the start
page. Neither silently redirects. The browser tab names the surface: the lens, "Workbench"
and the ontology in the Workbench, "Studio" and the ontology in the Studio.
Per-lens client state (see [Local state](#local-state)) is keyed by ontology plus lens,
so switching either never leaks a working set, a chat or a query history across a
boundary — not even between same-keyed lenses of two ontologies.

### Signing in

Only when the server reports authentication on
([capabilities/authentication.md](capabilities/authentication.md)); otherwise none of this
exists and every control is offered.

- **Sign-in screen.** Anyone not signed in sees only the product mark and a Sign in
  button, which leads to the identity provider and back to the address they came from. A
  failed attempt, or a disabled account, is named above the button. A request that answers
  unauthenticated, such as an ended session, brings the screen back. When the sign-in
  state cannot be read at all, a screen says so with Retry, and nothing else is shown.
- **No access assigned.** A signed-in user holding no role sees their name, that no role
  has been given yet, and Sign out — nothing else.
- **User menu.** In the sidebar of both surfaces and on the start page: the user's name
  with their email or username, Users for those who manage users, and Sign out, which ends
  the session and opens the provider's sign-out page.
- **Users page** (`/admin/users`), for Platform Administrators and Ontology
  Administrators. A searchable table — name, email or username, kind (user or service),
  status, last sign-in — opens one user beside it: kind, username, last sign-in, when
  added, their roles, each removable by whoever may revoke it, and an Add role form
  choosing role, then ontology, then lens as far as the role needs. A Platform
  Administrator also disables and enables the user, may add every role, and admits a
  service by its name and its subject at the identity provider; an Ontology
  Administrator sees and adds only Reader, Proposer and Writer on the lenses of the
  ontologies it administers.
- **Access** (`/o/{ontologyKey}/studio/access`), a Studio page: the ontology's
  administrators, then each lens with who reads, proposes and writes through it, each
  removable; an add form picks a user by search, a lens and Reader, Proposer or Writer.

**What each role sees.** Controls a role does not allow are not shown; the server refuses
them all the same.

| Where | Shown only to |
|---|---|
| Start page | The ontologies the user holds a role in; on a card, the lenses the user holds a role on ("No lens assigned to you" when none) |
| "+ New ontology" | Ontology Creators |
| A card's Open Studio, Rename and Delete; the Studio itself | The ontology's administrators; anyone else opening the Studio sees "No access to the Studio" |
| The Workbench of a lens | Its Readers, Proposers and Writers; anyone else sees "No access to this lens" |
| Lens switcher, a type's links to other lenses | The lenses the user holds a role on |
| Surface switch, "Manage lenses…", links into the Studio | The ontology's administrators |
| New entity, quick add, editing, deleting, relating, documents' edit | Writers of the lens; Proposers while a changeset is pinned, into which every such write is staged |
| The Explorer's connecting drag, which writes live only | Writers of the lens while no changeset is pinned |
| Starting, pinning, editing, checking and submitting a changeset | Proposers and Writers of the lens; a Reader reviews |
| Committing a changeset | Writers of the lens |
| Ruleset maintenance | The ontology's administrators; everyone else uses the rulesets |

---

## Workbench screens

### Shell

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
[schema graph](#schema-graph) and search results. Colour is derived from the key alone and needs no server support.

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
explanation linking to the lens's scope in the Studio; when it exposes types but holds no instances, a
two-step guide — create the first entity from the first type's table, or connect an AI
client through its MCP configuration.

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
created column starts hidden). A type with an [identity](capabilities/entity-identity.md)
the lens shows gets an Identity column, monospaced and shown by default, which sorts,
filters with the string operators, and is part of the CSV export. Document values render as a size badge that opens the
[document viewer](#document-viewer-and-editor) — never as inline content, and never as
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
([interfaces.md](interfaces.md#listing-sorting-filtering)): strict greater-than and
less-than, and query paths in either form, are not offered. This lists every difference
from the server's vocabulary: a change to the filter vocabulary decides whether the table
offers it and updates this list.

Any change to search, filters or sort returns to the first page. Switching to another type
resets search, filters, sort, column visibility, selection and page. If deleting the last
rows of a trailing page leaves the current page beyond the end, the table clamps back to
the last populated page. Two distinct empty states are shown: "nothing exists yet" (with a
create action) and "nothing matches" (with a clear-filters action).

### Entity detail

Header: display label, type chip, the entity's identity when it has one, creation and
update timestamps, and actions to add a
relation, open the entity in the Explorer, and delete it behind a confirmation that states
the relations will go with it. Above the label, a breadcrumb shows the entity's
[hierarchy path](capabilities/instance-data.md#the-path-read) from the path read —
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
and renders the content; a separate action opens the [document editor](#document-viewer-and-editor).
See [capabilities/documents.md](capabilities/documents.md).

**Staged here.** While the [pinned changeset](#changesets) stages the entity, a strip
under the header shows its staged object as a card of the review, with Remove, Cut and
Accept current — disabled while it is submitted — and links to the review. A property with a staged value shows its
stored value struck through beside the staged one, with its drift marker; a document
shows "staged" with its size and a View action opening the staged text, or "staged ·
removed". A staged delete adds "Deleted in this changeset" to the header. Editing starts
from the staged value.

**Parent and Children.** For an ontology with
[parent relations](capabilities/schema-modeling.md#parent-relations), the hierarchy comes
first, set apart in the parent colour. *Parent* is one section over every parent relation
whose child end is this entity's type: the entity's parent with an unlink action, or "a
root" when it has none, and an add action. *Children* is one section per parent relation
whose parent end is this entity's type, with its count, its children and a
"+ {child type} under {entity}" button. The button opens [quick add](#quick-add) with that
type and this parent fixed, so the entity and its parent relation are created in one
request ([capabilities/instance-data.md](capabilities/instance-data.md#the-create-with-a-parent-relation)).
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
second parent is named by the child's label ("T1 already has a parent").

### Explore

The graph canvas, and beside it the ask dock, where an assistant's answers fill the canvas.
See [Working set](#working-set) for both.

### Query

Two tabs — Console and Library — which both stay live, so results survive a switch. See
[Query console](#query-console) and [Saved-query library](#saved-query-library).

### Rulesets

The ontology's [rulesets](capabilities/rulesets.md), shown through the current lens: one
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

### Changesets

The lens's [changesets](capabilities/changesets.md), those started through a ruleset
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
  commit would leave it, in the [document viewer](#document-viewer-and-editor).
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
review. One changeset is pinned per lens, [remembered](#local-state) in the browser, and
every open tab follows a pin or a leave at once. While one is pinned:

- **The bar** above every Workbench page names it by its number and note, with its number
  of staged objects, that staging is refused once it is submitted, Review and Leave.
- **Every Workbench write is staged** into it instead of written — the entity page's
  edits, delete, unlinks and added relations, a target created on the way included,
  [quick add](#quick-add) with its parent relation, and a table's bulk delete — except the
  Explorer canvas's ([Working set](#working-set)). Each answers with a toast saying it was
  staged — for an entity delete, with how many staged relations at it went too — a bulk
  delete with one for all, linking to the review; live views stay as they are.
- **A staged create** on the review of a draft offers "Edit values…" — the entity form
  with its staged values, staging an update of what changed — and "Add ‹child type›…" per
  parent relation its type is the parent end of, naming the relation where two reach the
  same child type, opening quick add under it. While the
  changeset is not the pinned one, the card says to work in it to extend it.
- **A pinned changeset that is gone** is left, with a message that writes are live again.

### Assistants

Three tabs — Agents, Retrievers and Navigators. See [Assistants panel](#assistants-panel). Without a language-model
provider the navigation entry is gone and the screen renders an explanation; see
[Feature gating](#feature-gating).

---

## Studio screens

The Studio is scoped wholesale to one ontology: its sidebar carries the ontology
switcher and the surface switch beneath it, its navigation covers Schema, Lenses, Search
and Transfer, with authentication on also [Access](#signing-in), and everything it reads and writes belongs to the current ontology. Its
footer holds the theme control and the collapse control. Like the Workbench sidebar, it
collapses to an icon rail whose entries name themselves on hover; both sidebars share one
collapse preference.

### Schema

One page for the ontology's schema, in two views of the same types: the
[schema graph](#schema-graph), which is the default, and the classic view — a two-column
list of entity types and relation types, each section with its count, plus a
[type page](#type-page-classic-view) per type. A list card shows the type's key, display
name, property count and description; a relation type card also shows its endpoints. The
Studio sidebar's Schema entry is active on every schema address.

Both views share one selection: at most one entity type or relation type, optionally with
one opened property, held in the address ([Deep links](#deep-links)). Selecting anywhere —
on the graph, in the [outline](#schema-outline), the
[command palette](#schema-command-palette), the [issues list](#schema-issues) or a jump
link — replaces the address; switching views adds a history entry, so back and forward
restore view and selection. Switching is instant and keeps the selection and the opened
property in both directions. In the classic view a selected type is shown as its type page
and the list when nothing is selected. An opened property's row opens, is highlighted
briefly and scrolls into view — in the graph's inspector or on the type page. A type key
the schema does not have shows a not-found state with a link to the list in the classic
view; on the graph it is dropped from the address with a message naming it.

The header carries Validate, the issues button, a Commands button opening the schema
command palette, and the Graph | Classic switch; in the classic view it adds
"+ Entity type" and "+ Relation type", which open the create dialogs — the graph creates
in place. Validation results appear inline as a pass marker or a list of path-and-message
issues. Below the header sit the outline and the current view; the page itself never
scrolls. Every change is written the moment it is made — there is no draft and no save
step — and the header says so. An empty ontology shows, on the graph, a hint to
double-click or press `N` for the first entity type, and in the classic view "No types
yet" with a create action.

The create dialogs ask for a display name, a key and a description; the graph's naming
popover and the palette ask for a display name and a key. The key is proposed from the
display name (lower-cased, non-alphanumerics collapsed to underscores, leading digits and
underscores dropped, cut to the maximum key length), validated live against the key
pattern, and permanent — the form says so. The entity type dialog additionally asks for
the key of its name property, `name` by default and validated against the same pattern;
it explains that the type belongs to this ontology, where every lens can include it, and
that the name property's value labels instances. Created anywhere else, an entity type
gets the default name property. Creating a relation type additionally asks for source and
target entity types, which are permanent too.

### Type page (classic view)

One page for both entity types and relation types, built from the same parts as the
graph's [inspector](#schema-graph) in page density, so both edit alike. A back link leads
to the classic list.

The header edits the display name and the description in place. An empty display name is
refused; a description can be changed but not emptied — an emptied one is not sent, and
the stored text returns with a hint saying so
([capabilities/schema-modeling.md](capabilities/schema-modeling.md#keys-and-immutability)).
Immutable and labelled as such: the key, and a relation type's endpoints, shown as chips
that jump to those entity types. On an entity type the header holds a "Name property"
select offering the type's `string` properties, which reassigns the name property on
change, and an "Identity" field showing the identity properties in order, or "—". It opens
an editor that ticks 1 to 5 of the type's `string`, `integer` and `date` properties, orders
them with up and down actions, shows an example of the text form, and saves or clears the
identity. Setting one may open the [cascade confirmation](#cascade-confirmation), which
then says the identity properties become required, lose their defaults and join every
lens's list for the type. When the stored data refuses it, a report in place says nothing
was changed and lists, per rule — without a value, sharing an identity, too long — the
count and the first entities by short id, with Dismiss
([capabilities/entity-identity.md](capabilities/entity-identity.md#declaring-an-identity)). On a relation type it holds a "Rules" group with the
[relation rules](capabilities/schema-modeling.md#relation-rules). A "Parent" select —
none, the source or the target, named by their entity types — sets or flips the
[parent end](capabilities/schema-modeling.md#parent-relations) on change; clearing it asks
for confirmation first. A "One per pair" switch, its help "At most one link of this type
between the same two entities", turns
[one per pair](capabilities/schema-modeling.md#one-per-pair) on or off; while a parent end
is set it shows on and locked, "Implied by the parent end". When the stored data refuses a
change, a report replaces it: nothing was changed, the count per rule — two parents,
cycles, or pairs linked more than once — with the listed entities as Workbench links
labelled by type and short id and "and N more" beyond them, a hint to fix the data in the
Workbench and retry, and Dismiss. The field keeps the stored value.

The properties list puts the name property first, then the rest by key, with key, display
name, data type, required flag, default and description per row. Clicking a row opens its
details in place: display name, default (an input matched to the data type; emptying it
clears the default), description and the required flag, each saved as it changes, with
the key and data type stated as permanent. The name property's row carries a "Name" badge
and its delete action is disabled, explaining that another name property must be chosen
first. An identity property's row carries an "Identity" badge; its required switch and
default are disabled and its delete is blocked, each saying to remove it from the identity
first, in the row and in the delete dialog. "Add property" opens an inline form — display name with a derived key, data type,
required flag and default — which stays open after each add, clearing the name, key,
required flag and default but keeping the data type; Escape closes it. Document is offered
as a data type on entity types only. Adding a required property without a default may
trigger the [cascade flow](#cascade-confirmation). See
[capabilities/schema-modeling.md](capabilities/schema-modeling.md).

On an entity type, a list of the relation types that touch it follows — direction, key
and the entity type at the other end — each selecting that relation type. Below it, a
**Search indices** section lists every search index rooted on the type — managed and custom — with its name, key, kind and
[status](#search), each linking to the index; "New index" opens the
[index designer](#index-designer) with the type pre-selected. A type with no index says
why: it has no string or document property and no custom index.

**Deleting.** One dialog serves types and properties, wherever deletion starts — the type
page, the inspector, a property's delete action, `Del` on the graph, or the palette. For a
type it states how many property definitions go with it, if any, that stored entities or
relations under its key stay in the database but become unreachable
([capabilities/schema-modeling.md](capabilities/schema-modeling.md#deletion)), and that the
server reports what it would change in lens scopes and search indices on confirmation;
the key must be typed to enable Delete. An entity type still used by relation types is
blocked up front: the dialog lists them, each with a Show action that selects it, and
sends nothing. A property asks once and says that its stored values remain in the database
but leave the schema; the name property is blocked. When the server asks for consent, the
dialog turns into the [cascade confirmation](#cascade-confirmation). A target that no
longer exists is reported as already gone. After a deletion the selection is cleared if
it was the deleted type, so the classic view returns to the list.

### Lenses

A list of the ontology's lenses with their keys and a scope marker — either "unscoped",
or "scoped" with the number of included entity and relation types. Index inclusions are
not counted, and never make a lens scoped. Creation asks for a name, a
derived-but-editable key and a description, and states plainly that a new lens starts
unscoped and therefore exposes everything.

### Lens detail

Inline-editable name and description, an immutable key, a scope marker, an entry into the
Workbench for this lens (on the page matching the open tab, as the surface switch does), and deletion behind a confirmation stating that the lens, its
scope, its agents, retrievers, navigators, saved queries and changesets, submitted ones
included, go — while the schema and all instance data stay. Six tabs:

**Scope** — the [scope editor](#scope-editor).

**Agents** — the authoring surface for the lens's [agents](capabilities/agents.md#agents),
with a test panel beside the editor; see [Agent editor](#agent-editor).

**Retrievers** — the authoring surface for the lens's
[retrievers](capabilities/retrievers.md), with a test panel beside the
editor; see [Retriever editor](#retriever-editor).

**Navigators** — the authoring surface for the lens's
[navigators](capabilities/navigators.md), with a test panel beside the editor; see
[Navigator editor](#navigator-editor).

The three tabs share one frame — list, editor page, the built-in default's page and test
panel; see [Assistant management](#assistant-management). A help button in each list's
header, and beside the title of each editor and default page, explains how that kind
works. It shows the steps of one run, with the language-model calls set apart from the steps that only read the lens. One example run plays step by step over the same
example graph and question for all three kinds, beside a run log and the settings that
steer each step. A switch shows the other two kinds.

**Saved queries** — the authoring surface for the lens's stored pipelines, and the only
place multi-step pipelines can be built. Per query: name, derived-and-then-immutable key,
description, an ordered list of steps, and a parameter list. A step is either a query step
carrying query text, or a search step carrying an entity type, search text and a result
limit — it has no minimum score. Steps can be reordered and removed; every step after the
first can bind parameters to fields of an earlier step's results. Parameters carry a name,
a description and a scalar data type (document is not offered). An inline runner executes
the query with typed parameter inputs and shows the result as a table or as raw JSON. See
[capabilities/saved-queries.md](capabilities/saved-queries.md).

**Connect** — a ready-to-paste AI-client configuration for the MCP servers, bound
entirely by their URLs: the modeling server to this ontology, the runtime server to this
lens within it ([interfaces.md](interfaces.md#how-a-mount-is-bound)). One card per server
states what its connection is bound to, its job, what it covers and what it does not do;
each card can be left out of the configuration, so a client gets only the server its task
needs, or both. The configuration is offered in two formats, Claude Code and Codex, each with where to put it. The URLs start from the
address the server reports for itself ([interfaces.md](interfaces.md#server)); when it
reports none, a visible placeholder stands in its place with a note to replace it. A
switch adds an `Authorization: Bearer` header holding a token placeholder for servers
reached through an access-controlled entry point; with authentication on there is no
switch, and a note says OAuth-capable clients sign in through the browser on first
connect. The runtime card's Ruleset select offers
none, the plain lens, or any of the ontology's [rulesets](#rulesets), each with its write
access and its anchor; choosing one binds the runtime URL and the entry name to that
ruleset, adds it as a third chip after ontology and lens, and shows one line per rule
saying what the connection may do. A ruleset deleted meanwhile falls back to none. The
same panel opens from the Workbench home's AI-clients card and empty-state guide. In the
Studio the tab also links to the Workbench's Rulesets page.

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
  explained as the text retrievers choose the index by. The key `new` is refused, because the
  designer's own address for a new index ends in it.
- **Entity type** — every hit is an entity of it. Changing it clears fields, header and
  relation groups.
- **Own fields** — a checklist of the type's text and scalar properties and at most one
  document property, with a running count against the field limit; the choice of how the
  own entry's semantic text is written; and the entry previews of the own entry and, with
  a document, of its passages.
- **Owner line (header)** — the name property (the default), chosen text fields, or none;
  it says where it applies — the relation groups, the passages of the chosen document —
  and that the own entry never has one, and it is faded while it applies to nothing.
- **Relation groups** — one card per group: a relation type in one direction (each
  combination once) and the group's name beside it — its label, the relation's display
  name when empty — then its relation fields, the target type's fields, the choice of how
  its entries' semantic text is written, and the entry preview of the group's entries.
  The group count runs against its limit.
- **Search modes** — semantic and keyword switches.

The **semantic text** of an own entry or a group's entries is either labelled lines or a
template, chosen by a two-way switch shown while semantic search is on — for the own entry
only while an own text field is chosen. Only the template choice shows the template field.
A template set aside by choosing labelled lines comes back on choosing the template again,
until the designer is left or saved; an empty template saves as none.

An **entry preview** renders the [entry outline](capabilities/search-indices.md#entry-outline)
of one entry kind, saying how many such entries an entity gets: the semantic text beside
the keyword text — only those the draft switches on — with each field as a chip coloured
by the type that owns it, named with its owner where no label tells (keyword text,
template prose, and the far end of a relation from a type to itself as the "other" one).
Its owner line is marked by a thin rule and a small tag, the field chips keeping their
colours; text from a template has none. It marks semantic text that comes from the template, says when the template renders
nothing and which of its placeholders never have a value, and which fields a template
leaves to keyword matching alone. A relation group's preview warns when none of the
relation's own properties, or nothing of the entity at the other end, is in its entries.
Text properties left out are listed under the preview, each added to the draft with one
click. While a newer draft is being composed, the previous outline stays, dimmed. A
template field offers the placeholders it can resolve, inserted at the cursor.

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
  properties, search indices, keyword languages, lenses, agents, retrievers, navigators
  and saved queries — as a JSON file named after the ontology key ("Download `<ontologyKey>`.json").
- **Import** — takes a JSON file and writes it into the current ontology. It reports
  malformed JSON before sending anything, and on a
  key conflict explains that pre-existing objects with the same keys block the import and
  that the clashes must be resolved (or a bare ontology used). A successful import
  refreshes every cached view.
- **Rebuild search data** — runs the [search-data rebuild](capabilities/search.md#rebuild)
  for this ontology, behind a confirmation warning about duration and provider cost, then
  live progress per group while it runs and a summary when it finishes. It re-embeds the
  saved-query descriptions and repairs their vector index; search indices keep themselves
  current and are rebuilt one at a time from the [index designer](#index-designer). With
  no embedding provider configured there is nothing to rebuild: the action is disabled,
  with a note saying why.

---

## Interaction models

### Command palette

One overlay, five modes, opened from anywhere in the Workbench. Each open starts fresh —
empty input, no type scope, a new snapshot of recents — except for the retriever chosen
for questions, which is remembered.

| Prefix | Mode | Behaviour |
|---|---|---|
| *(none)* | Entities | Cross-type entity search — ranked under the server's default strategy when any strategy is available, otherwise a parallel substring search over every exposed type. Starts at two characters; below that it shows recents or a hint. |
| `#` | Types | Filter the exposed entity types; choosing one *scopes* the palette to that type rather than navigating. |
| `?` | Saved queries | Semantic search over query descriptions when available, substring filtering over the full list otherwise. An empty query lists everything. |
| `>` | Actions | Navigation to each Workbench area, the Studio, and a theme toggle. |
| `!` | Question | A question to a [retriever](capabilities/retrievers.md#retrieve), answered with the entities it finds. Sent on purpose, never as you type — see [Question mode](#question-mode). Only on a server with a language-model provider. |

Scoping to a type replaces the prefix with a persistent type chip; the search then runs
within that type, an empty query lists that type's first entities, and Backspace on an
empty input removes the scope. Prefixes are inert while a type scope is active.

Entity results retain global ranking order. Each row carries a type chip and display
label, the entity's identity beside it where it has one, and, when the hit was found through a relation or a passage, one muted
[matched via](#matched-via) line beneath. No number, score bar, percentage, numeric aria
label or passage text is displayed. The relation target picker uses the same search hook
and row; its empty input lists the first ten entities. Both use ranked search whenever
the strategy list is nonempty, falling back to literal entity lists otherwise. Enter
opens entity detail; Cmd/Ctrl+Enter focuses the Explorer.

#### Question mode

Typing runs nothing; the input says "Press Enter to ask", and Enter sends the question
(1 to 2,000 characters). While it runs, a status line shows, and Escape — or editing the
question — cancels it without closing the palette. A changed question needs Enter again;
until then the previous results stay, dimmed and marked as answering an earlier question.
Once results arrive, the arrow keys move through them, Enter opens the entity's detail and
Cmd/Ctrl+Enter focuses it in the Explorer, as in entities mode; Enter on the unchanged
question does not resend it.

A chip beside the prefix names the retriever; clicking it lists the lens's retrievers
as the server lists them: `Default` — the lens's
[default retriever](capabilities/retrievers.md#the-default-retriever) —
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

### Matched via

Search results never show a score: it would be read as relevance or confidence, which a
relative score is not. Where the server names the entry that found a hit
([capabilities/search.md](capabilities/search.md#response)), a hit found through a
relation or a passage carries one short line:

- a relation entry — `via <label> → <target>`: the relation group's label from the lens's
  [search catalog](capabilities/search.md#the-search-catalog), else the relation type's
  display name, and the target's label, else its truncated identifier, followed by the
  target's identity in parentheses where it has one;
- a passage entry — `via passage in <property>`, the document property's display name;
- the entity's own fields — no line.

The line never shows the entry's text. The palette and the relation target picker use the
[default search](capabilities/search.md#ranked-search), which reads only managed indices,
so no relation line appears there; relation lines appear in
a retriever's diagnostics and in the palette's question results, whose searches
reach custom indices.

### Quick add

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
entity, unless the create was [staged](#changesets).

The same form primitives back quick add, inline target creation in the relation flow and
the relation-property steps, so all of them accept exactly what the lens accepts.

### Working set

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
While a [changeset is pinned](#changesets), nodes offer no connecting drag: the canvas
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
[assistant chat](#assistant-chat) with one of the lens's assistants — any agent, retriever
or navigator:

- **Open or closed.** Open, it is resizable. Closing cancels a running answer; reopening
  restores the conversation from its thread.
- **Header.** An assistant picker grouped by kind — navigators, retrievers, agents —
  each kind's `Default` first; another assistant cancels a running answer and shows that
  assistant's own conversation, the same thread as its Workbench tab. Then "New
  conversation" and close.
- **Answers** as in the chat, a navigator's citations as markers. Under each, collapsible
  parts: *Found* — the [entities the answer met](capabilities/threads.md#the-entities-a-turn-met)
  as compact cards, a navigator's grouped as in the [evidence sidebar](#evidence-sidebar),
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

### Assistants panel

Three tabs over one lens, one per assistant kind: Agents, Retrievers and Navigators. All
require a language-model provider; see [capabilities/agents.md](capabilities/agents.md).
All tabs are the same [assistant chat](#assistant-chat).

A toolbar picker selects the assistant: the kind's assistants as the server lists them —
`Default`, the built-in one, first — each with its key. The address names the chosen
assistant, so it survives a reload; without one — or with one the lens does not have —
`Default` is shown and the address updated to name it. Each assistant has its own
conversation, restored from the server when it is picked.

**Agents** — the side panel has two tabs: *Entities*, the cards of the
[entities the answer met](capabilities/threads.md#the-entities-a-turn-met), each linking to
the entity's page, and *Tool calls*. Tool calls stream into a **tool-call panel** that
follows the running answer:
each call in order, with a readable name, a one-line summary of what it asked for, its
state, and its time inside the tool. Calls start collapsed and open by hand. An open call
shows its arguments and its result in a form fitting the result — a table for query rows,
hits with relative scores and matched snippets, entities, neighbours with their relation
and direction, document text — linking entities to their pages, with the raw result one
click away; a tool that answers with an error shows it highlighted. The panel heads with
the question, the number of calls, the time spent inside tools — parallel calls once, said
so when calls overlapped, the model's thinking not at all — and how long the answer took.
Each answer's button shows the count of calls and of entities. A "Show details" switch,
remembered per browser and on by default, shows the panel and the buttons; off hides both. Tool calls live
as long as the open chat: answers restored from the server have none, and the panel says
so. A failed or stopped answer marks its unfinished calls interrupted.

**Retrievers** — chat with the lens's [retrievers](capabilities/retrievers.md); `Default`
is the lens's [default retriever](capabilities/retrievers.md#the-default-retriever). The
side panel shows the cards of the
[results the answer was given](capabilities/threads.md#the-entities-a-turn-met), each linking
to the entity's page. A "Show diagnostics" switch, off by default and remembered, requests
diagnostics with every answer and shows them in the
[diagnostics panel](#assistant-chat), a second tab beside the entities; off, none are
requested. A question to a retriever
the lens cannot run shows the server's refusal with its reasons.

**Navigators** — chat with the lens's [navigators](capabilities/navigators.md); `Default`
is the lens's [default navigator](capabilities/navigators.md#the-default-navigator). Each
answer cites the entities it names with small numbered markers in their
type's color; a marker selects that entity in the [evidence sidebar](#evidence-sidebar),
which is the side panel of this tab. A "Show evidence" switch, on by default and
remembered, shows the sidebar. Answers restored from the server have no evidence and show
no markers.

### Assistant management

The frame the Studio lens detail's Agents, Retrievers and Navigators tabs share. What an
assistant is configured with, and how its kind lists and tests it, is the kind's own: see
[Agent editor](#agent-editor), [Retriever editor](#retriever-editor) and
[Navigator editor](#navigator-editor).

**List.** A header with the kind's name, how many assistants the lens defines, the help
button and "New …". First the built-in `Default` — a dashed card with its key, marked
built in, and one sentence on what it is and that it cannot be edited; then a card per
assistant: name, key, the kind's badges, the description and, where the kind has one, a
summary line. With none defined, a card beside the default's offers "New …". A card opens
the assistant's editor, the default's card its read-only page.

**Editor.** A page with a title row — back to the list, the name as typed, the help
button, the key once saved, and the status: "Not saved yet", "Unsaved changes", "Invalid
in this lens" for a kind the lens validates, or "Saved" — and the form beside the test
panel. The address names the open assistant, so it can be linked; a key the lens does not
have shows a not-found state with the way back. "New …" opens a draft that exists only in
the client until its first save. The form is a draft that only a save writes:

- **Action bar** — heads the form: "Create …" or Save, enabled once the draft is changed
  and valid; Discard changes; the kind's extras; and Delete, behind a confirmation. A
  refused save lists its reasons below the bar under "Not saved:".
- **Identity** — Name, Key and Description. A new assistant's key follows the name until
  edited, and is refused when the lens has it already or it exceeds 64 characters; once
  saved it is permanent.
- The kind's own sections follow.

Leaving the editor with unsaved changes — by the back action, another tab or another
page — asks first.

**Default page.** The built-in default's read-only page: the same title row with "Built
in" as status, its sentence and "New …" in place of the form, and the test panel asking
the default.

**Test panel.** Beside the form: a header with the kind's controls and one line on what it
asks, then the kind's [assistant chat](#assistant-chat) with no picker. It asks the saved
version; saving starts a new conversation, and none is restored. A new or changed
assistant blocks questions and says why; a kind may block more. Without a
language-model provider the panel says that the kind cannot answer.

### Agent editor

The Studio lens detail's Agents tab, in the [shared frame](#assistant-management). Its
configuration semantics are owned by [capabilities/agents.md](capabilities/agents.md#agents).

**List.** Each card shows the agent's tool posture: all tools, or how many.

**Editor.** After the identity, **Behaviour**: the system prompt, and either all tools or
an explicit checklist of the read-only runtime tools, at least one required. An agent is
never invalid in its lens.

**Test panel.** The agent's side panel — entities and tool calls, as in the
[Assistants panel](#assistants-panel) — is always shown.

### Retriever editor

The Studio lens detail's Retrievers tab, in the [shared frame](#assistant-management).
Its configuration semantics are owned by
[capabilities/retrievers.md](capabilities/retrievers.md).

**List.** Each card shows valid, invalid or unsupported, the number of warnings, and which
indices it searches with its filter count. "Import", in the header, creates a new
retriever from an exported JSON, from a file or pasted; it never replaces a retriever with
the same key.

**Editor.** After the identity, four sections:

- **Search indices** — the indices of the lens's
  [search catalog](capabilities/search.md#the-search-catalog), grouped by entity type,
  each with its name, key, kind, description and, unless ready, its build state. A chosen
  index with relation groups offers all of them or only chosen relation types. A chosen
  index opens on demand what its entries hold — the
  [entry previews](#index-designer) of its definition, without editing, those of relation
  groups the retriever leaves out dimmed. An index the lens no longer offers stays listed for
  removal.
- **Filters** — the exact conditions a question may set: a result type, a path (the
  result's own field, or up to two relation hops away) and a field. Document fields are
  not offered.
- **Answer fields** — per result type, up to twelve of its properties, documents
  included, passed to the answer model; answer fields for a type no chosen index finds
  are listed for removal.
- **Answer** — the similarity threshold as a slider from −1 to 1, explained as a cosine
  cut-off with its equivalent on the 0–1 similarity scale of index search, applied only
  to sub-queries no filter or previous reference restricts, never to keyword matches, and dependent on the
  embedding model; and the maximum characters per answer field.

The action bar adds Save as copy, which asks for a name and key and stores the current
state, unsaved changes included, as a new retriever while the original stays as last
saved. The saved retriever's validation errors and warnings appear in a validation panel
below the bar, the draft's own problems next to their section. Rarer operations sit under
More, below the form: export of the saved version as JSON, copy or move to another lens of
the ontology under the same key, and the configuration as editable JSON applied to the
draft. A retriever whose configuration has an unsupported version or shape shows no
sections and opens with More expanded, where it can be exported or replaced by a version 2
configuration.

**Test panel.** A Chat / Retrieve switch in the header, its position remembered. Chat is
the chat with diagnostics always on. Retrieve asks one question, sent on Enter or with
Ask, and shows only the found entities, as the palette's [question mode](#question-mode)
does, without "Show all in Explorer"; saving clears the result. An invalid or unsupported
retriever also blocks questions.

### Navigator editor

The Studio lens detail's Navigators tab, in the [shared frame](#assistant-management). Its
configuration semantics are owned by
[capabilities/navigators.md](capabilities/navigators.md).

**List.** Each card shows valid or invalid, the number of warnings, and a one-line summary
of its walk — hops, how many relation and anchor types, evidence cards.

**Editor.** After the identity, **Walk** — hops 1 to 3, the relation types the walk may
follow and the entity types a mention may resolve to, each either every one the lens shows
or a checklist with each relation's endpoints — and **Answer** — the number of evidence
cards and the instructions. A type the lens no longer shows stays listed for removal. The
saved navigator's validation errors and warnings appear in a validation panel below the
action bar.

**Test panel.** The chat with the [evidence sidebar](#evidence-sidebar) always shown. An
invalid navigator also blocks questions.

### Evidence sidebar

The side panel of a navigator's answer, filling while the question runs — the entities
appear before the answer. Three views, each with its count where it has one:

- **Entities** — the cards, grouped as anchors (named in the question), carried over
  from the previous answer, and reached by the walk, each group explained in a line. A
  card shows the type, the label, its identity where it has one, its ref, its distance, whether it was handed to the
  answer as evidence, why it is there — "Lena Fischer manages Kira Novak", or that it is
  only the closest match for a name the question used — up to six fields, and a link to
  the entity's page. A selected card is scrolled into view and marked.
- **Graph** — the cards as a read-only node-link view, anchors on the left and each hop a
  column further right, borders colored by role, evidence bold and the rest faded, links
  labelled with the relation. A click on a node selects its card; a selected card is
  brought into view. Large graphs open on the anchors.
- **Steps** — the navigator's pipeline as a vertical list: each step's name, whether it
  calls the model, what it does, its live state — waiting, running, done, skipped, failed
  or interrupted — its time, and its one-line summary; a repeated step shows its rounds,
  and the repeat edge its reason. A footer sums up model calls, total time, entities and
  evidence.

### Assistant chat

One conversation with one assistant on a server-held [thread](capabilities/threads.md),
the same for every assistant kind — the Workbench's Assistants tabs, the test panels of
the Studio's [assistant editors](#assistant-management) and, compact, the Explorer's [ask dock](#working-set), which shows an
answer's entities and its kind's insight under it instead of in a side panel. The browser remembers
only the current thread per ontology, lens, kind and assistant (not in a test panel) and
restores its messages from the server.

- **Empty conversation** — the assistant's name and description, and one line on what
  its kind does.
- **Messages** — the question in a bubble, the answer beside its kind's icon,
  rendered as Markdown; answer text appears as it streams. While an answer runs it shows
  the elapsed seconds and what it is doing now: an agent's running tool, a retriever's or
  a navigator's current step.
- **Input** — at most 2,000 characters, growing to a few lines; Enter sends, Shift+Enter
  adds a line, and a hint below says so and that follow-ups refer to earlier answers.
  While an answer runs, Send becomes Stop.
- **New conversation** — in the toolbar (in the test panel, in its header) once there
  are messages, not while an answer runs; confirmed, it starts a new thread. The browser
  forgets the old one, which the server removes when it expires.
- **Side panel** — beside the conversation, stacked below it on a narrow screen, showing
  the kind's insight into one answer. A button under each answer selects it; by default,
  and after every new question, the panel follows the latest answer that has any.

Follow-up questions refer to earlier completed answers of the thread. A failed answer
keeps what arrived and says "Incomplete" with the reason; a stopped one says it is not
part of the conversation. The thread keeps nothing of either, so a restored conversation
does not show them. A closed connection without a terminal event is a failure; turns
never retry. A message to a thread still answering an earlier one is refused and shown as
the answer's error. When the thread has expired — found on opening, or when a message is
refused for it — the chat says so and starts a new conversation; a refused message goes
back into the input. Switching assistant, tab, ontology or lens cancels the active request;
late events cannot enter another thread. Storage failure does not break live chat.

A retriever's **diagnostics panel** shows the selected answer, with the answer's total time
on its button, in four tabs, filling while the question runs:

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
[capabilities/retrievers.md](capabilities/retrievers.md#diagnostics).

### Schema graph

The default view of the [Schema](#schema) screen and the place where the schema is edited
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
Positions are remembered per ontology in the browser only ([Local state](#local-state)):
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
delete; the same parts as the [type page](#type-page-classic-view), in compact form. Its
top row switches to the classic view or closes the panel, clearing the selection. With no
relation type yet, it says to drag the node's "+" onto another type. `Del` or Backspace
deletes the selected type through the [delete dialog](#type-page-classic-view).

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

### Schema outline

On the left of the [Schema](#schema) screen in both views: a search box, then the entity
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

### Schema command palette

The Schema screen's own palette, distinct from the Workbench's
[command palette](#command-palette). Cmd/Ctrl+K, also while typing, or the header's
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

### Schema issues

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
type, deleting a property, adding a required property, deleting a custom search
index, and setting an entity type's identity, where it adds what the identity changes. For a schema deletion, the [delete dialog](#type-page-classic-view) itself turns
into this confirmation. See
[capabilities/schema-modeling.md](capabilities/schema-modeling.md#the-cascade-protocol).

### Document viewer and editor

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
[capabilities/documents.md](capabilities/documents.md).

---

## Feature gating

The client asks the server once per session which optional capabilities exist — the
available search strategies plus the semantic-search and AI flags — and
treats the answer as never going stale. None is inferred from a failed call — the client
never probes.

Gated areas explain themselves rather than vanishing, except in navigation, where a dead
entry would be worse than an absent one. Navigation is gated optimistically: the Assistants entry
is shown unless the report has explicitly said its capability is off, so it does not
flicker into existence while the report is loading.

| Off | What changes |
|---|---|
| AI | The Assistants navigation entry, the Assistants palette action, the palette's question mode, the Ask an assistant quick action and the Explorer's Ask button and dock are gone. The Assistants screen itself renders an explanation. |
| No search strategies | Entity search falls back to substring matching — per type in parallel when unscoped. |
| Semantic search | Saved-query search falls back to client-side substring filtering over the full list. The search-data rebuild is disabled and explains that there is nothing to rebuild. |

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
toasts.

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

**Having children is synthesized.** Delete is disabled on an entity detail from one relation
list request with a page size of one per Children section, which counts only the children
the lens shows; the server's refusal remains the rule, and a refused delete refreshes the
counts.

**Bulk delete is a client loop.** There is no bulk endpoint. Deleting a selection issues
one request at a time, sequentially, advancing a progress indicator and counting failures.
The outcome is reported as a partial result when some failed. The selection is cleared and
the list refreshed regardless of outcome. While a changeset is pinned each request stages
a delete instead; a pin or leave during the run stops it, and the rest are reported as
skipped.

**CSV export is entirely client-side.** The server is not involved. From a table it covers
the current page and the currently visible columns, plus the identifier; from a result set
it covers every row and the result's own columns. Object values are JSON-encoded; any value
containing a quote, a comma or a newline is quoted with its quotes doubled.

**The search-data rebuild is a stream, not a response.** The rebuild call answers with
newline-delimited JSON objects, one per line, which must be read incrementally — a client
that waits for a complete JSON body will hang until the whole rebuild finishes. Two event
kinds appear: progress events carrying a group key, a processed count and a total — the
saved queries form one pseudo-group, present only when a provider is
configured — and exactly one final summary carrying the overall processed and failed counts and
whether the embeddings were skipped. A stream that ends without a summary is an error,
not a success.

**Entity search shows no number.** The palette and relation target picker use the
server’s ranking order and ignore relative scores. What found a hit is shown only as the
[matched-via](#matched-via) line, whose relation-group label the client resolves through
the lens's search catalog; no passage text is shown. Saved-query discovery keeps its
separate cosine score.

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
| Sidebar collapsed (Workbench and Studio alike) | Global | — |
| Explorer working set | Per ontology + lens | Bounded by the hard node cap |
| Explorer ask dock — open or closed, its width, its assistant (kind and key), the switch that adds cited entities | Per ontology + lens | — |
| Recently opened entities | Per ontology + lens | 10 |
| Recent query texts | Per ontology + lens | 10 |
| Pinned changeset | Per ontology + lens | One |
| Current conversation thread id (Workbench Agents, Retrievers and Navigators tabs, Explorer ask dock) | Per ontology + lens + kind + assistant | One |
| Agent details panel switch (Workbench) | Global | — |
| Retriever diagnostics switch (Workbench) | Global | — |
| Navigator evidence sidebar switch (Workbench) | Global | — |
| Retriever test panel mode (Chat or Retrieve) | Global | — |
| Retriever for palette questions | Per ontology + lens | — |
| Schema graph node positions | Per ontology | — |
| Schema graph collapsed property lists | Per ontology | — |
| Schema outline collapsed | Per ontology | — |

Per-lens state is keyed by ontology **and** lens because lens keys are unique only
within their ontology — two ontologies' `default` lenses must never share a canvas or a
chat. The remembered last-used lens exists per ontology, and only to pick the target lens of
the surface switch and the ontology switcher; nothing at the root consumes it.

The working set stores only identifiers, type keys, positions and pin flags — entities and
relations are re-fetched on restore, so a stale canvas can never display stale property
values. Conversations themselves are held by the server; the browser keeps only the
current thread's id and restores the messages from the server. Question results are
in-memory for the session and deliberately not persisted; the Workbench's selected
assistant lives in the address.
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
| `/o/{ontologyKey}/w/{lensKey}/ai` | The Assistants panel, Agents tab; an unknown `tab` shows Agents as well |
| `/o/{ontologyKey}/w/{lensKey}/ai?tab=retriever` | The Retrievers tab |
| `/o/{ontologyKey}/w/{lensKey}/ai?assistant={key}` · `?tab=retriever&assistant={key}` | That tab with that assistant — `_default` for the default one; the default one when the lens has no such assistant |
| `/o/{ontologyKey}/w/{lensKey}/rulesets` | The [Rulesets](#rulesets) page |
| `/o/{ontologyKey}/w/{lensKey}/changesets` | The [Changesets](#changesets) list |
| `/o/{ontologyKey}/w/{lensKey}/changesets/{changesetId}` | One changeset's review |
| `/o/{ontologyKey}/studio` · `/o/{ontologyKey}/studio/schema` | Redirects to the schema graph |
| `/o/{ontologyKey}/studio/schema/graph` | The [schema graph](#schema-graph), nothing selected |
| `/o/{ontologyKey}/studio/schema/graph?sel=entity:{typeKey}` · `?sel=relation:{typeKey}` | The graph with that type selected and revealed, its inspector open |
| `/o/{ontologyKey}/studio/schema/graph?sel=…&prop={propertyKey}` | The same, with that property opened and highlighted |
| `/o/{ontologyKey}/studio/schema/types` | The classic list |
| `/o/{ontologyKey}/studio/schema/types/entity/{typeKey}` · `.../types/relation/{typeKey}` | A [type page](#type-page-classic-view) |
| `/o/{ontologyKey}/studio/schema/types/entity/{typeKey}?prop={propertyKey}` · `.../types/relation/{typeKey}?prop={propertyKey}` | The type page with that property opened and highlighted |
| `/o/{ontologyKey}/studio/entity-types/{id}` · `.../relation-types/{id}` | Redirects to that type's page in the classic view; an unknown identifier shows the not-found state |
| `/o/{ontologyKey}/studio/lenses` | The lens list |
| `/o/{ontologyKey}/studio/lenses/{id}` | A lens, Scope tab |
| `/o/{ontologyKey}/studio/lenses/{id}?tab=agents` · `?tab=retriever-agents` · `?tab=navigators` · `?tab=queries` · `?tab=connect` | The other lens tabs |
| `/o/{ontologyKey}/studio/lenses/{id}?tab=agents&agent={key}` · `?tab=retriever-agents&retriever={key}` · `?tab=navigators&navigator={key}` | That assistant's editor and test panel — `_new` for a new draft, `_default` for the built-in default's read-only page |
| `/o/{ontologyKey}/studio/search` | The search index list |
| `/o/{ontologyKey}/studio/search?tab=settings` | The search settings |
| `/o/{ontologyKey}/studio/search/new` | The index designer on a new custom index |
| `/o/{ontologyKey}/studio/search/new?entityType={typeKey}` | The same, with the entity type pre-selected |
| `/o/{ontologyKey}/studio/search/{indexKey}` | An index: the designer for a custom index, the read-only view for a managed one |
| `/o/{ontologyKey}/studio/transfer` | Export, import, rebuild search data |
| `/o/{ontologyKey}/studio/access` | Who holds which role in the ontology ([Signing in](#signing-in)) |
| `/admin/users` | The Users page ([Signing in](#signing-in)) |

Two consumed parameters are stripped from the address as soon as they are acted on, so that
a reload does not repeat the action: the quick-add trigger and the Explorer focus target.
A schema address's `prop` without a selected type is ignored.
Any unrecognised address returns to the root.

## Keyboard surface

| Where | Key | Effect |
|---|---|---|
| Anywhere in the Workbench | Cmd/Ctrl+K | Toggle the command palette |
| Anywhere in the Workbench | `c` | Open quick add — ignored while typing and while any dialog is open |
| Anywhere in the Workbench or the Studio | `[` | Collapse or expand the sidebar — the key as typed on the keyboard layout, also where it needs Option or AltGr; ignored while typing and while a dialog, popover, menu or list is open |
| Palette | ↑ / ↓ | Move through results, wrapping |
| Palette | Enter | Open the selection |
| Palette | Cmd/Ctrl+Enter | Open the selected entity in the Explorer |
| Palette | Backspace on empty input | Leave the type scope |
| Palette | `#` `?` `>` `!` as first character | Switch mode |
| Palette, question mode | Enter on a new question | Ask it |
| Palette, question mode | Escape while a question runs | Cancel it |
| Palette | Escape | Close |
| Table | Enter on a focused row | Open the entity |
| Table | ↑ / ↓ on a focused row | Move focus between rows |
| Table filter popover | Enter | Apply the condition |
| Inline property edit | Enter | Save |
| Inline property edit | Escape | Cancel |
| Inline property edit (multi-line) | Shift+Enter | Newline |
| Studio inline text | Enter (Cmd/Ctrl+Enter when multi-line) | Save |
| Studio inline text | Escape | Cancel without saving |
| Schema screen, both views | Cmd/Ctrl+K | Toggle the [schema command palette](#schema-command-palette), also while typing |
| Schema screen, both views | `V` | Switch Graph ⇄ Classic, keeping the selection and the opened property |
| Schema screen, both views | `/` | Expand the outline and focus its search |
| Schema graph | `N` | New entity type at the centre of the view |
| Schema graph | `F` | Toggle focus mode on the selection |
| Schema graph | `H` | Hide or show the properties on every node |
| Schema graph | Shift+H | Hide or show the selected entity type's properties |
| Schema graph | Delete / Backspace | Delete the selected type, through the delete dialog |
| Schema graph | Escape | Cancel the drag or the popover, else leave focus mode, else clear the selection |
| Schema naming popover | Enter / Escape | Create / cancel |
| Schema outline search | Enter | Select the first match |
| Schema outline search | Escape | Clear the search and leave the box |
| Add-property form | Enter | Add, keeping the form open for the next one |
| Add-property form | Escape | Close the form, even when focus has left it |
| Schema delete dialog | Enter | Delete, once the key is typed |
| Schema command palette | ↑ / ↓ · Enter · Backspace on empty input · Escape | Move · run · back to the root · close |
| Query editor | Cmd/Ctrl+Enter | Run |
| Explorer | `F` | Fit the view |
| Explorer | `P` | Pin or unpin the selection |
| Explorer | `A` | Open or close the ask dock |
| Explorer | Delete / Backspace | Remove selected nodes from the canvas |
| Explorer | Shift or Cmd while clicking | Extend the selection |
| Assistant chat | Enter | Send |
| Assistant chat | Shift+Enter | Newline |
| Retriever test panel, Retrieve | Enter | Ask |
| Forms | Enter | Submit the form |

Single-letter shortcuts are suppressed inside text inputs and while a dialog or popover
layer is open, so typing never triggers navigation.
