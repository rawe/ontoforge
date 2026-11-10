# Threads

Every assistant — an [agent](agents.md), a [retriever](retrievers.md), a
[navigator](navigators.md) or the [Studio helper](studio-helper.md) —
converses in **threads** the server holds. A client sends only its new message and, to
continue, the thread's id; the server continues from what the thread kept. How the server
stores threads, and the numbers below (turns a thread holds, lifetime, how much a thread
and the store hold): [../architecture.md](../architecture.md#thread-store).

## Starting and continuing

A message without a thread id starts a new thread, bound to the assistant it was sent to —
its ontology, its lens (none for the Studio helper, which works on the whole ontology),
kind and key. The answer names the thread's id first. A message with
that id continues the thread. The id is random and unguessable; knowing it is what lets a
client continue or read a thread.

A thread belongs to exactly one assistant and, with [authentication](authentication.md)
on, to the principal that started it. Sent to any other assistant, or by any other
principal, its id is unknown, exactly as an id that never existed or has expired: the
message is refused as not found before anything runs, and the client starts a new thread.

Saving an assistant does not end its threads. A retriever's and a navigator's next turn
runs the saved configuration; an agent's thread keeps the prompt its first turn ran with,
so a client that wants a conversation under a new prompt starts a new thread. There is no
delete: a client done with a thread drops its id, and
[retention](#lifetime) removes the thread.

## Turns

A turn is one user message, the assistant's work on it and its answer. For an agent the
work is its tool calls and their results; they stay in the thread with the turn.

- **One run per thread.** A message to a thread whose previous message is still being
  answered, on whichever server, is refused as busy before anything runs — never queued,
  since two runs would fork the conversation.
- **A turn is atomic.** A turn cancelled — the client disconnects — or failed leaves
  nothing in the thread: not the user's message, not partial tool work, so no tool call is
  left without its result. A thread only ever holds complete turns, and while a turn runs
  it reads back as of its last completed one. An interrupted turn is asked again, never
  resumed. A thread grown too large to keep refuses its turn; the client starts a new one.
- **The model sees the whole thread** — for an agent and the Studio helper including
  their tool calls and results — but never a model's reasoning. For those two, nothing a
  thread sent is ever changed: its instructions stay as its first turn set them, and what
  changes later (the schema, what the person has open) goes with a message — so a provider
  can reuse what it already read, and one that caches only on request is asked to.
- **A thread holds a bounded number of turns.** A message beyond them is refused before
  anything runs; the client starts a new thread. Nothing is removed.
- **A conversation that no longer fits the model ends.** Nothing is cut or summarised to
  make room: the turn fails as too long, and the client starts a new thread
  ([ADR 0034](../adr/0034-a-full-context-window-ends-the-conversation.md)).

A retriever's and a navigator's thread also keep what a follow-up question may refer to
([retrievers.md](retrievers.md#follow-up-questions),
[navigators.md](navigators.md#follow-up-questions)).

## The entities a turn met

Every assistant reports the entities its turn met the same way, beside its own work: each
real entity the lens shows, with a ref it keeps for the turn (`E1`, `E2`, …), its type,
label, its [identity](entity-identity.md) when the lens shows one, and a few visible fields, whether it was handed to the model that wrote
the answer — its **evidence** — and the stored relations between them. A client can open
each one. Which entities an assistant reports is its own: an
[agent](agents.md#live-tool-activity) the entities its entity tools returned, a
[retriever](retrievers.md#evidence-and-the-answer) the results its answer was given, a
[navigator](navigators.md#what-the-client-sees) everything its walk met. Only a
navigator's answer cites them by ref. An entity reported again replaces what was reported
for its ref. They belong to the turn's stream only: a thread
does not keep them.

The shared card does not claim a common relevance or provenance judgment: each kind
meets entities differently. What is shared is the entity's identity and label and whether
it was handed to the answer model; kind-specific context keeps its own meaning.

All kinds use the shared `entities` event for these cards; a kind's own events and tool
events do not carry the cards ([ADR 0027](../adr/0027-one-shared-entities-event.md)).

## Lifetime

A thread expires after a period without activity: a message accepted for it or a turn
completed. Reading a thread is not activity. Every server sharing the thread store sees
the same threads. A thread is lost before it expires only when its store is: a server
holding threads in its memory restarts, or the shared store is reset. No thread is removed
to make room: a full store refuses new threads and completed turns as a storage failure.
Continuing or reading a thread that is gone answers not found, as above.

## Reading a thread back

A thread reads back as its user messages and the assistant's answers, in order — the
turns it keeps, without tool calls or their results. An answer carries the artifacts its
turn left: for the Studio helper, the turn's last schema proposal with its check. A client restores a conversation from
it. Reading runs no model, so it needs no language-model provider; it is available
wherever the assistant kind's list is.

## Through the interfaces

REST only, per assistant kind: the chat request's optional thread id, the stream's leading
thread event, the read route, and the refusals for an unknown and a busy thread
([../interfaces/](../interfaces/assistants-rest.md#assistant-chat-and-threads)). No MCP tool reaches a thread.
