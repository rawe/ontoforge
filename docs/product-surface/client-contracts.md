# Client contracts, deep links and keyboard

What the client guarantees beyond the API, the links into it and its keyboard surface.

## Client-side contracts the API does not imply

None of the following is visible from the server's surface — the operations involved are
indexed in [interfaces/](../interfaces/README.md). A reimplementation that honours the API and
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
type's [name property](../capabilities/schema-modeling.md#the-name-property), read from the
current lens's runtime schema, when it is a non-empty string; otherwise the first twelve
characters of the identifier. There is no fallback to other properties, so a lens that
hides the name property labels its entities by identifier. It is applied everywhere an
entity is named — tables, detail headers, search results, canvas nodes, relation rows,
toasts.

**Query rows omit relation endpoints.** A relation read returns its endpoint identifiers; a
relation inside a query result does not ([capabilities/oql.md](../capabilities/oql.md)).
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

**Bulk delete is a client loop.** Deleting a selection issues
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
server’s ranking order and show no score. What found a hit is shown only as the
[matched-via](finding-and-collecting.md#matched-via) line, whose relation-group label the client resolves through
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
| `/o/{ontologyKey}/w/{lensKey}/rulesets` | The [Rulesets](workbench.md#rulesets) page |
| `/o/{ontologyKey}/w/{lensKey}/changesets` | The [Changesets](workbench.md#changesets) list |
| `/o/{ontologyKey}/w/{lensKey}/changesets/{changesetId}` | One changeset's review |
| `/o/{ontologyKey}/studio` · `/o/{ontologyKey}/studio/schema` | Redirects to the schema graph |
| `/o/{ontologyKey}/studio/schema/graph` | The [schema graph](schema-editing.md#schema-graph), nothing selected |
| `/o/{ontologyKey}/studio/schema/graph?sel=entity:{typeKey}` · `?sel=relation:{typeKey}` | The graph with that type selected and revealed, its inspector open |
| `/o/{ontologyKey}/studio/schema/graph?sel=…&prop={propertyKey}` | The same, with that property opened and highlighted |
| `/o/{ontologyKey}/studio/schema/types` | The classic list |
| `/o/{ontologyKey}/studio/schema/types/entity/{typeKey}` · `.../types/relation/{typeKey}` | A [type page](studio.md#type-page-classic-view) |
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
| `/o/{ontologyKey}/studio/access` | Who holds which role in the ontology ([Signing in](README.md#signing-in)) |
| `/admin/users` | The Users page ([Signing in](README.md#signing-in)) |

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
| Schema screen, both views | Cmd/Ctrl+K | Toggle the [schema command palette](schema-editing.md#schema-command-palette), also while typing |
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
