# Threads

Every assistant — an [agent](ai-agents.md) or a [retriever agent](retriever-agents.md) —
converses in **threads** the server holds. A client sends only its new message and, to
continue, the thread's id; the server continues from what the thread kept. How the server
stores threads, and the numbers below (turns kept, turns the model sees, lifetime, how
many threads a server holds): [../architecture.md](../architecture.md#thread-store).

## Starting and continuing

A message without a thread id starts a new thread, bound to the assistant it was sent to —
its ontology, lens, kind and key. The answer names the thread's id first. A message with
that id continues the thread. The id is random and unguessable; knowing it is what lets a
client continue or read a thread — there are no users or owners.

A thread belongs to exactly one assistant. Sent to any other, its id is unknown, exactly
as an id that never existed or has expired: the message is refused as not found before
anything runs, and the client starts a new thread.

Each turn runs the assistant's **current** configuration. Saving an assistant does not end
its threads; a client that wants a conversation under the new configuration only starts a
new thread. There is no delete: a client done with a thread drops its id, and
[retention](#lifetime) removes the thread.

## Turns

A turn is one user message, the assistant's work on it and its answer. For an agent the
work is its tool calls and their results; they stay in the thread with the turn.

- **One run per thread.** A message to a thread whose previous message is still being
  answered is refused as busy before anything runs — never queued.
- **A turn is atomic.** A turn cancelled — the client disconnects — or failed leaves
  nothing in the thread: not the user's message, not partial tool work. A thread only ever
  holds complete turns. An interrupted turn is asked again, never resumed.
- **The model sees the recent turns,** not the whole thread — for an agent including those
  turns' tool calls and results. A thread keeps a bounded number of turns; older ones are
  removed.

A retriever agent's thread also keeps what a follow-up question may refer to
([retriever-agents.md](retriever-agents.md#follow-up-questions)).

## Lifetime

A thread expires after a period without a turn, and a server holds a bounded number of
threads, removing the one unused the longest when it is full. Threads live as long as the
server process: a restart loses them all. Continuing or reading a thread that is gone
answers not found, as above. Reading a thread does not count as use.

## Reading a thread back

A thread reads back as its user messages and the assistant's answers, in order — the
turns it keeps, without tool calls or their results. A client restores a conversation from
it. Reading runs no model, so it needs no language-model provider; it is available
wherever the assistant kind's list is.

## Through the interfaces

REST only, per assistant kind: the chat request's optional thread id, the stream's leading
thread event, the read route, and the refusals for an unknown and a busy thread
([../interfaces.md](../interfaces.md#assistant-chat-and-threads)). No MCP tool reaches a thread.
