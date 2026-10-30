# Studio screens

The Studio is scoped wholesale to one ontology: its sidebar carries the ontology
switcher and the surface switch beneath it, its navigation covers Schema, Lenses, Search
and Transfer, with authentication on also [Access](README.md#signing-in), and everything it reads and writes belongs to the current ontology. Its
footer holds the theme control and the collapse control. Like the Workbench sidebar, it
collapses to an icon rail whose entries name themselves on hover; both sidebars share one
collapse preference.

Find [schema](#schema), [type pages](#type-page-classic-view), [lenses](#lenses),
[lens detail](#lens-detail), [search](#search), the [index designer](#index-designer),
and [transfer](#transfer) below.

## Schema

One page for the ontology's schema, in two views of the same types: the
[schema graph](schema-editing.md#schema-graph), which is the default, and the classic view — a two-column
list of entity types and relation types, each section with its count, plus a
[type page](#type-page-classic-view) per type. A list card shows the type's key, display
name, property count and description; a relation type card also shows its endpoints. The
Studio sidebar's Schema entry is active on every schema address.

Both views share one selection: at most one entity type or relation type, optionally with
one opened property, held in the address ([Deep links](client-contracts.md#deep-links)). Selecting anywhere —
on the graph, in the [outline](schema-editing.md#schema-outline), the
[command palette](schema-editing.md#schema-command-palette), the [issues list](schema-editing.md#schema-issues) or a jump
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

## Type page (classic view)

One page for both entity types and relation types, built from the same parts as the
graph's [inspector](schema-editing.md#schema-graph) in page density, so both edit alike. A back link leads
to the classic list.

The header edits the display name and the description in place. An empty display name is
refused; a description can be changed but not emptied — an emptied one is not sent, and
the stored text returns with a hint saying so
([capabilities/schema-modeling.md](../capabilities/schema-modeling.md#keys-and-immutability)).
Immutable and labelled as such: the key, and a relation type's endpoints, shown as chips
that jump to those entity types. On an entity type the header holds a "Name property"
select offering the type's `string` properties, which reassigns the name property on
change, and an "Identity" field showing the identity properties in order, or "—". It opens
an editor that ticks 1 to 5 of the type's `string`, `integer` and `date` properties, orders
them with up and down actions, shows an example of the text form, and saves or clears the
identity. Setting one may open the [cascade confirmation](schema-editing.md#cascade-confirmation), which
then says the identity properties become required, lose their defaults and join every
lens's list for the type. When the stored data refuses it, a report in place says nothing
was changed and lists, per rule — without a value, sharing an identity, too long — the
count and the first entities by short id, with Dismiss
([capabilities/entity-identity.md](../capabilities/entity-identity.md#declaring-an-identity)). On a relation type it holds a "Rules" group with the
[relation rules](../capabilities/schema-modeling.md#relation-rules). A "Parent" select —
none, the source or the target, named by their entity types — sets or flips the
[parent end](../capabilities/schema-modeling.md#parent-relations) on change; clearing it asks
for confirmation first. A "One per pair" switch, its help "At most one link of this type
between the same two entities", turns
[one per pair](../capabilities/schema-modeling.md#one-per-pair) on or off; while a parent end
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
trigger the [cascade flow](schema-editing.md#cascade-confirmation). See
[capabilities/schema-modeling.md](../capabilities/schema-modeling.md).

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
([capabilities/schema-modeling.md](../capabilities/schema-modeling.md#deletion)), and that the
server reports what it would change in lens scopes and search indices on confirmation;
the key must be typed to enable Delete. An entity type still used by relation types is
blocked up front: the dialog lists them, each with a Show action that selects it, and
sends nothing. A property asks once and says that its stored values remain in the database
but leave the schema; the name property is blocked. When the server asks for consent, the
dialog turns into the [cascade confirmation](schema-editing.md#cascade-confirmation). A target that no
longer exists is reported as already gone. After a deletion the selection is cleared if
it was the deleted type, so the classic view returns to the list.

## Lenses

A list of the ontology's lenses with their keys and a scope marker — either "unscoped",
or "scoped" with the number of included entity and relation types. Index inclusions are
not counted, and never make a lens scoped. Creation asks for a name, a
derived-but-editable key and a description, and states plainly that a new lens starts
unscoped and therefore exposes everything.

## Lens detail

Inline-editable name and description, an immutable key, a scope marker, an entry into the
Workbench for this lens (on the page matching the open tab, as the surface switch does), and deletion behind a confirmation stating that the lens, its
scope, its agents, retrievers, navigators, saved queries, named searches and changesets,
submitted ones included, go — while the schema and all instance data stay. Seven tabs:

**Scope** — the [scope editor](schema-editing.md#scope-editor).

**Agents** — the authoring surface for the lens's [agents](../capabilities/agents.md#agents),
with a test panel beside the editor; see [Agent editor](assistants.md#agent-editor).

**Retrievers** — the authoring surface for the lens's
[retrievers](../capabilities/retrievers.md), with a test panel beside the
editor; see [Retriever editor](assistants.md#retriever-editor).

**Navigators** — the authoring surface for the lens's
[navigators](../capabilities/navigators.md), with a test panel beside the editor; see
[Navigator editor](assistants.md#navigator-editor).

The three tabs share one frame — list, editor page, the built-in default's page and test
panel; see [Assistant management](assistants.md#assistant-management). A help button in each list's
header, and beside the title of each editor and default page, explains how that kind
works. It shows the steps of one run, with the language-model calls set apart from the steps that only read the lens. One example run plays step by step over the same
example graph and question for all three kinds, beside a run log and the settings that
steer each step. A switch shows the other two kinds.

**Saved queries** — the authoring surface for the lens's stored pipelines, and the only
place multi-step pipelines can be built. Per query: name, derived-and-then-immutable key,
description, an ordered list of steps, and a parameter list. A step is either a query step
carrying query text, or a search step carrying the entity search's fields: search text, a
scope of types or of indices (choosing one clears the other; none searches the whole
lens), the keyword and semantic methods — semantic only with an embedding provider —
filter conditions as key = value rows, and a limit. Steps can be reordered and removed;
every step after the first can bind parameters to fields of an earlier step's results — of
a search step only `_id`, `_entityTypeKey` and `name`. Parameters carry a name, a
description and a scalar data type (document is not offered). An inline runner executes
the query with typed parameter inputs and shows a query result as a table, a search result
as Advanced search's ranked items, or either as raw JSON. See
[capabilities/saved-queries.md](../capabilities/saved-queries.md).

**Named searches** — the authoring surface for the lens's
[named searches](../capabilities/named-searches.md). The list shows each one's name, key,
description and result unit (entities or passages), with edit and delete behind a
confirmation. The editor (`?search=<key>`, a draft `?search=_new`) holds name,
derived-and-then-immutable key and description, and the stored search tree as nested
cards: the root on top, each node's inputs indented below it. A card names its node kind
in plain words, says what it does, and holds its fields — a search's index (from the lens's
search catalog), text, keyword match or semantic floor and parts; a group's unit; a
limit's count and per-entity cap; a filter's entity type and its conditions as
key = value rows. Its menu replaces the node with a fresh one of another kind, wraps it in
a node that takes it as input, or removes it — from its parent's list, or by its single
input taking its place. A merge or fuse adds inputs, a restrict filters. A new named search
starts from a choice — result unit, indices, methods and limit — that writes the canonical
tree, one search per index and method with the text `$query`, which is then edited;
Start over returns to that choice. Saving shows the server's reasons in a summary and each
on the card it names; leaving with unsaved changes asks first. A JSON switch shows the
tree as it is saved, read-only, with a copy button.

**Connect** — a ready-to-paste AI-client configuration for the MCP servers, bound
entirely by their URLs: the modeling server to this ontology, the runtime server to this
lens within it ([interfaces/](../interfaces/mcp.md#how-a-mount-is-bound)). One card per server
states what its connection is bound to, its job, what it covers and what it does not do;
each card can be left out of the configuration, so a client gets only the server its task
needs, or both. The configuration is offered in two formats, Claude Code and Codex, each with where to put it. The URLs start from the
address the server reports for itself ([interfaces/](../interfaces/server.md#server)); when it
reports none, a visible placeholder stands in its place with a note to replace it. A
switch adds an `Authorization: Bearer` header holding a token placeholder for servers
reached through an access-controlled entry point; with authentication on there is no
switch, and a note says OAuth-capable clients sign in through the browser on first
connect. The runtime card's Ruleset select offers
none, the plain lens, or any of the ontology's [rulesets](workbench.md#rulesets), each with its write
access and its anchor; choosing one binds the runtime URL and the entry name to that
ruleset, adds it as a third chip after ontology and lens, and shows one line per rule
saying what the connection may do. A ruleset deleted meanwhile falls back to none. The
same panel opens from the Workbench home's AI-clients card and empty-state guide. In the
Studio the tab also links to the Workbench's Rulesets page.

## Search

The ontology's [search indices](../capabilities/search-indices.md) and its search settings,
in two tabs: Indices and Settings. The whole area exists only on a server that supports
search indices ([Feature gating](README.md#feature-gating)). A "New index" action opens the
[index designer](#index-designer).

**Indices** shows two tables. *Custom indices* show name and key, root entity type, what
they read (field count, relation-group count), their representations (semantic,
keyword) and their status; an empty list explains what a custom index adds. *Managed
indices* — one default index per entity type and one passage index per document property
— show name and key, kind (default or passages), entity type, representations, status and
an on/off switch. Every row opens its index. The status chip names the
[state](../capabilities/search-indices.md#status) — ready, building with its progress, stale
with the pending count, failed with the failed count, disabled, or unavailable — and its
tooltip gives each representation's state. While any listed index is building or stale,
the list refreshes itself every few seconds; otherwise nothing polls.

**Settings** — the [keyword languages](../capabilities/search.md#keyword-language), German
and English, as checkboxes; the last remaining language cannot be unticked. Below, the
managed indices grouped by entity type — the default index and one "Passages of …" row per
document property — each with its status and switch. Both take effect at once, without a
save step; changing the languages says that keyword entries rebuild in the background.

## Index designer

One custom index as a draft that only a Save writes, with the
[cost preview](../capabilities/search-indices.md#cost-preview) in the save bar. Its sections
follow the [definition](../capabilities/search-indices.md#custom-indices):

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

An **entry preview** renders the [entry outline](../capabilities/search-indices.md#entry-outline)
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
[cascade flow](schema-editing.md#cascade-confirmation) for lenses that include the index; it then returns
to the list.

A managed index opens read-only: kind, managed key, description, entity type, its fields
(or document), header and search modes, the on/off switch and the same status block with
Rebuild. It explains that managed indices follow the schema and points to a custom index
for anything else.

## Transfer

Three operations, each with its own explanation. See
[capabilities/transfer.md](../capabilities/transfer.md).

- **Export** — downloads the ontology's whole design — entity types, relation types,
  properties, search indices, keyword languages, lenses, agents, retrievers, navigators,
  saved queries and named searches — as a JSON file named after the ontology key ("Download `<ontologyKey>`.json").
- **Import** — takes a JSON file and writes it into the current ontology. It reports
  malformed JSON before sending anything, and on a
  key conflict explains that pre-existing objects with the same keys block the import and
  that the clashes must be resolved (or a bare ontology used). A successful import
  refreshes every cached view, and warns with the saved queries an older payload's upgrade
  left out.
- **Rebuild search data** — runs the [search-data rebuild](../capabilities/search.md#rebuild)
  for this ontology, behind a confirmation warning about duration and provider cost, then
  live progress per group while it runs and a summary when it finishes. It re-embeds the
  saved-query descriptions and repairs their vector index; search indices keep themselves
  current and are rebuilt one at a time from the [index designer](#index-designer). With
  no embedding provider configured there is nothing to rebuild: the action is disabled,
  with a note saying why.
