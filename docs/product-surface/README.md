# Product surface

What the web client offers. It is a static application that reaches the server over REST
only and holds no privileged path — see [architecture.md](../architecture.md). [Concepts](../concepts.md)
explain the mental model; the [glossary](../glossary.md) defines its terms. Capability semantics
are not repeated here; each
section links to the capability document that owns them.

This folder is the capability inventory; this file holds what every screen shares. It is
complete on *what the product does* and deliberately silent on how it is built.

## Find a screen or interaction

| Need | Start here |
|---|---|
| Start page, Studio and Workbench orientation, sign-in | [The three levels](#the-three-levels) |
| Working with data, queries, rulesets, changesets and assistants | [Workbench screens](workbench.md) |
| Modeling, lenses, search configuration and transfer | [Studio screens](studio.md) |
| Shared controls, editors, chat and document interactions | [Finding and collecting](finding-and-collecting.md), [assistants](assistants.md), [schema and document editing](schema-editing.md) |
| Availability, client state, links and keyboard access | [Feature gating](#feature-gating), [Client-side contracts](client-contracts.md), [Deep links](client-contracts.md#deep-links), [Keyboard surface](client-contracts.md#keyboard-surface) |

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
  [keyword language set](../capabilities/search.md#keyword-language). Creation lands in the
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
Per-lens client state (see [Local state](client-contracts.md#local-state)) is keyed by ontology plus lens,
so switching either never leaks a working set, a chat or a query history across a
boundary — not even between same-keyed lenses of two ontologies.

### Signing in

Only when the server reports authentication on
([capabilities/authentication.md](../capabilities/authentication.md)); otherwise none of this
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

## Interaction models

Find the [command palette](finding-and-collecting.md#command-palette), [quick add](finding-and-collecting.md#quick-add),
[Explorer working set](finding-and-collecting.md#working-set), [query console](finding-and-collecting.md#query-console),
[assistant panel](assistants.md#assistants-panel), [assistant chat](assistants.md#assistant-chat),
[schema graph](schema-editing.md#schema-graph), [scope editor](schema-editing.md#scope-editor), and
[document viewer and editor](schema-editing.md#document-viewer-and-editor) in their own files.

## Feature gating

The client asks the server once per session which optional capabilities exist — whether
ranked search runs, plus the semantic-search and AI flags — and
treats the answer as never going stale. None is inferred from a failed call — the client
never probes.

Gated areas explain themselves rather than vanishing, except in navigation, where a dead
entry would be worse than an absent one. Navigation is gated optimistically: the Assistants entry
is shown unless the report has explicitly said its capability is off, so it does not
flicker into existence while the report is loading.

| Off | What changes |
|---|---|
| AI | The Assistants navigation entry, the Assistants palette action, the palette's question mode, the Ask an assistant quick action and the Explorer's Ask button and dock are gone. The Assistants screen itself renders an explanation. |
| Ranked search | Entity search falls back to substring matching — per type in parallel when unscoped. |
| Semantic search | Saved-query search falls back to client-side substring filtering over the full list. The search-data rebuild is disabled and explains that there is nothing to rebuild. |

Everything else works unchanged. See [capabilities/search.md](../capabilities/search.md).
