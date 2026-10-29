# Assistants

Interaction models for assistants: the panel, their management and editors, the evidence
sidebar and the chat.

## Assistants panel

Three tabs over one lens, one per assistant kind: Agents, Retrievers and Navigators. All
require a language-model provider; see [capabilities/agents.md](../capabilities/agents.md).
All tabs are the same [assistant chat](#assistant-chat).

A toolbar picker selects the assistant: the kind's assistants as the server lists them —
`Default`, the built-in one, first — each with its key. The address names the chosen
assistant, so it survives a reload; without one — or with one the lens does not have —
`Default` is shown and the address updated to name it. Each assistant has its own
conversation, restored from the server when it is picked.

**Agents** — the side panel has two tabs: *Entities*, the cards of the
[entities the answer met](../capabilities/threads.md#the-entities-a-turn-met), each linking to
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

**Retrievers** — chat with the lens's [retrievers](../capabilities/retrievers.md); `Default`
is the lens's [default retriever](../capabilities/retrievers.md#the-default-retriever). The
side panel shows the cards of the
[results the answer was given](../capabilities/threads.md#the-entities-a-turn-met), each linking
to the entity's page. A "Show diagnostics" switch, off by default and remembered, requests
diagnostics with every answer and shows them in the
[diagnostics panel](#assistant-chat), a second tab beside the entities; off, none are
requested. A question to a retriever
the lens cannot run shows the server's refusal with its reasons.

**Navigators** — chat with the lens's [navigators](../capabilities/navigators.md); `Default`
is the lens's [default navigator](../capabilities/navigators.md#the-default-navigator). Each
answer cites the entities it names with small numbered markers in their
type's color; a marker selects that entity in the [evidence sidebar](#evidence-sidebar),
which is the side panel of this tab. A "Show evidence" switch, on by default and
remembered, shows the sidebar. Answers restored from the server have no evidence and show
no markers.

## Assistant management

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

## Agent editor

The Studio lens detail's Agents tab, in the [shared frame](#assistant-management). Its
configuration semantics are owned by [capabilities/agents.md](../capabilities/agents.md#agents).

**List.** Each card shows the agent's tool posture: all tools, or how many.

**Editor.** After the identity, **Behaviour**: the system prompt, and either all tools or
an explicit checklist of the read-only runtime tools, at least one required. An agent is
never invalid in its lens.

**Test panel.** The agent's side panel — entities and tool calls, as in the
[Assistants panel](#assistants-panel) — is always shown.

## Retriever editor

The Studio lens detail's Retrievers tab, in the [shared frame](#assistant-management).
Its configuration semantics are owned by
[capabilities/retrievers.md](../capabilities/retrievers.md).

**List.** Each card shows valid, invalid or unsupported, the number of warnings, and which
indices it searches with its filter count. "Import", in the header, creates a new
retriever from an exported JSON, from a file or pasted; it never replaces a retriever with
the same key.

**Editor.** After the identity, four sections:

- **Search indices** — the indices of the lens's
  [search catalog](../capabilities/search.md#the-search-catalog), grouped by entity type,
  each with its name, key, kind, description and, unless ready, its build state. A chosen
  index with relation groups offers all of them or only chosen relation types. A chosen
  index opens on demand what its entries hold — the
  [entry previews](studio.md#index-designer) of its definition, without editing, those of relation
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
Ask, and shows only the found entities, as the palette's [question mode](finding-and-collecting.md#question-mode)
does, without "Show all in Explorer"; saving clears the result. An invalid or unsupported
retriever also blocks questions.

## Navigator editor

The Studio lens detail's Navigators tab, in the [shared frame](#assistant-management). Its
configuration semantics are owned by
[capabilities/navigators.md](../capabilities/navigators.md).

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

## Evidence sidebar

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

## Assistant chat

One conversation with one assistant on a server-held [thread](../capabilities/threads.md),
the same for every assistant kind — the Workbench's Assistants tabs, the test panels of
the Studio's [assistant editors](#assistant-management) and, compact, the Explorer's [ask dock](finding-and-collecting.md#working-set), which shows an
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
  [matched-via](finding-and-collecting.md#matched-via) line; expanding one shows the answer fields sent as
  evidence and the index that found it.
- **Model calls** — each model call under its name — Planner, Planner (repeated) when a
  follow-up's planning was repeated, Response — with token usage, finish reason,
  instructions, input and output, marked where the trace is truncated.

No score is shown anywhere. See
[capabilities/retrievers.md](../capabilities/retrievers.md#diagnostics).
