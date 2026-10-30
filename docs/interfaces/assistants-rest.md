# Assistants REST

The assistant routes of a lens, under the [runtime REST](runtime-rest.md) prefix
`/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. Shared conventions — addressing,
errors, who may call — are in the [interfaces index](README.md).

## Assistant chat and threads

Every assistant kind — `agents`, `retrievers`, `navigators` — converses through the same request, the
same stream frame and the same threads. Semantics:
[capabilities/threads.md](../capabilities/threads.md). The kind's own section below lists its
routes, its extra request fields and its own events.

| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/assistants/<kind>/{assistantKey}/chat` | One message: a new thread, or a turn on an existing one |
| GET | `/ai/assistants/<kind>/{assistantKey}/threads/{threadId}` | Read a thread back |

**Request.** `message` (1 to 2,000 characters) and optionally `threadId`; a kind may add
fields, and unknown fields are rejected. Without `threadId` the message starts a new
thread bound to the addressed assistant; with it, the message continues that thread. A
thread that is unknown, expired, bound to another assistant or started by another
principal answers `RESOURCE_NOT_FOUND` with `details.code` `THREAD_NOT_FOUND`; a thread
whose previous message is still being answered answers `RESOURCE_CONFLICT` with
`details.code` `THREAD_BUSY`. Both are plain error responses before the stream opens, like every other
refusal the kind lists; a busy message is never queued.

**Stream.** Every successful REST assistant chat uses `application/x-ndjson`; there is no
non-streaming mode. Tool activity is visible while the turn runs. Each line is one complete
JSON object with a `type`.

Agent turns stream their tool activity, not the agent reply; retrievers and navigators
send answer deltas ([ADR 0021](../adr/0021-rest-chat-tool-streaming.md)).

The shared events mean the same for every kind:

| Event `type` | Fields | Meaning |
|---|---|---|
| `thread` | `threadId` | Always first: the thread this turn runs on |
| `delta` | `text` | A fragment of the answer, for kinds that stream their answer |
| `entities` | `entities` — each `ref`, `id`, `type`, `typeName`, `label`, `fields` (`name`, `value`), `evidence`, and as the kind sends them `reason`, `role`, `hop` — and `links` — each `id` (the stored relation's id), `from`, `to` (refs, directed as stored), `type`, `label` | The entities the turn met and the stored relations between them; a later card replaces an earlier one with the same `ref`, a link is identified by its `id` |
| `final` | `reply` | Terminal: the complete answer |
| `error` | `error` | Terminal: the public error object with `code`, `message` and optional `details` |

Refs are `E1`, `E2`, … in the order the turn met the entities, unique within a turn; an
entity keeps its ref for the turn. `id` and `type` are the entity's id and type key, so a
client reads the entity through the runtime; `evidence` says the entity was handed to the
model that wrote the answer. A link's ends are cards of the same turn. Which entities a
kind sends is in its section below.

Only the shared `entities` event carries entity cards; a kind's own events and tool events
never do ([why](../capabilities/threads.md#the-entities-a-turn-met)).

A kind's own events are named `<kind>.<event>` — `agent.…`, `retriever.…`, `navigator.…`; a client may
ignore those it does not know. A writable stream has exactly one terminal `final` or
`error`; EOF without one means an incomplete turn — so does a stream a stopping server
cuts. A closed connection cancels the turn so work nobody will receive stops, and a cancelled or failed turn leaves nothing
in its thread. A turn whose result cannot be kept ends with `error`: `THREAD_NOT_FOUND`
when its thread is gone meanwhile, `THREAD_BUSY` when it lost its hold on the thread,
`VALIDATION_ERROR` when the thread grew too large to keep, `STORAGE_ERROR` when the thread
store is full or fails. Unexpected failures after streaming begins have the generic `INTERNAL_ERROR` message `Internal Server Error`.
Delivery bounds buffering and terminates stalled or oversized streams.

There is no background continuation after a disconnect.

**Read a thread.** `200` with `threadId` and `messages` — the user messages and the
assistant's answers in order, each `role` (`user` or `assistant`) and `content`, at most
the turns a thread keeps, without tool payloads. Unknown, expired, another assistant's or
another principal's thread: `THREAD_NOT_FOUND`. Reading needs no language-model provider
and does not count as use; it is gated like the kind's list.

## Retriever list, chat and retrieve

The stored retriever runs — or, under the key `_default`, the lens's
[default retriever](../capabilities/retrievers.md#the-default-retriever);
a request can never supply or override its configuration. Semantics:
[capabilities/retrievers.md](../capabilities/retrievers.md#answering-a-question)
and [retrieve](../capabilities/retrievers.md#retrieve).

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/retrievers` | List the lens's retrievers, the default first |
| POST | `/ai/assistants/retrievers/{assistantKey}/chat` | Stream the answer to one question |
| GET | `/ai/assistants/retrievers/{assistantKey}/threads/{threadId}` | Read a thread back |
| POST | `/ai/assistants/retrievers/{assistantKey}/retrieve` | The entities one query finds, without an answer |

**List.** Every retriever of the lens, runnable or not, as `key`, `name`,
`description` and `builtIn`; the default comes first, keyed `_default`, named `Default`,
with `builtIn` true. The list carries no configuration and no validation, and needs no
language-model provider.

**Chat.** The [shared request](#assistant-chat-and-threads) plus `diagnostics` (boolean,
default false). Without a language-model provider the route answers
`FEATURE_DISABLED`, as the AI routes do. An unknown retriever answers not found, a retriever its
lens can no longer run `VALIDATION_ERROR` with the errors under `details.errors`, a
default retriever with nothing to search `VALIDATION_ERROR`, an unknown or busy thread as
shared — each before the stream opens.

The response streams the [shared frame](#assistant-chat-and-threads): `thread`, the answer
as `delta` events, then one terminal `final` or `error`. Before the answer, when results
reached the answer model, one `entities` event carries them, all evidence, without links —
with or without diagnostics. Its own events:
`retriever.phase` (`phase` `plan`, `retrieve` or `answer`, `status` `start` or `end`, an
end with `durationMs`), and — only with `diagnostics` true — `retriever.diagnostics`
events, which carry:

| Field | Content |
|---|---|
| `plan` | `subQueries` — each `indices`, `relations`, `query`, `variants`, `mode`, `filters` (`id`, `value`, `quote`, and the filter's definition from the retriever's configuration: `entityType`, `path`, `field`) and `previous` — and `unsupportedReason` |
| `results` | One row per entity and sub-query that found it, in fused order: `entityId`, `entityType`, `label`, `subQuery`, `matched` when the search ranked the entity, `answerFields` |
| `limitations` | What the answer model was told limits the results |
| `searchCalls` | The number of index searches run |
| `timings` | Milliseconds: `plan`, `retrieve`, `answer`, `planModel`, `validation`, `search`, `context`, `firstDelta`, `answerModel`, `total`; `planModel` and `validation` add up both planning calls when planning was repeated |
| `modelIO` | Bounded system prompt, input and output traces of every model call, each with its `phase` — `plan`, `replan` for a follow-up's repeated planning, `answer` — and with usage and finish reason where the provider reports them |
| `llmCalls` | The number of model calls: 2, or 3 when planning was repeated |

`matched` has the form [capabilities/search.md](../capabilities/search.md#what-matched) describes.

**Read a thread.** As [shared](#assistant-chat-and-threads).

**Retrieve.** The body carries `query` (1 to 2,000 characters); unknown fields — a thread
id or `diagnostics` among them — are rejected.
It is refused exactly as chat is, with plain error responses: `FEATURE_DISABLED` without
a language-model provider, not found for an
unknown retriever, `VALIDATION_ERROR` for a retriever its lens can no longer run (errors under
`details.errors`), a default retriever with nothing to search, a planner input over the cap,
a failed planning call or a malformed plan. A closed connection cancels the work.

The response is `200` with `results` — best first, each `entityId`, `entityType`,
`label`, `conditions` (`filter`, `value`, `text`) and `matched` (a search hit's form, or
null) — `limitations` and `unsupportedReason` when no index can answer. No results is not
an error.

A question or a retrieve needs a language-model provider; without an embedding provider it
searches by keyword only. Neither route has an MCP equivalent.

## Navigator list and chat

The stored navigator runs — or, under the key `_default`, the lens's
[default navigator](../capabilities/navigators.md#the-default-navigator); a request can never
supply or override its configuration. Semantics:
[capabilities/navigators.md](../capabilities/navigators.md#answering-a-question).

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/navigators` | List the lens's navigators, the default first |
| POST | `/ai/assistants/navigators/{assistantKey}/chat` | Stream the work and the answer for one question |
| GET | `/ai/assistants/navigators/{assistantKey}/threads/{threadId}` | Read a thread back |

**List.** As for retrievers: `key`, `name`, `description` and `builtIn`, the default first,
no configuration, no validation, no language-model provider needed.

**Chat.** The [shared request](#assistant-chat-and-threads), nothing more. Without a
language-model provider the route answers `FEATURE_DISABLED`; an unknown navigator answers
not found, a navigator its lens can no longer run `VALIDATION_ERROR` with the errors under
`details.errors`, an unknown or busy thread as shared — each before the stream opens. The
response streams the shared frame — `thread`, the answer as `delta` events, one terminal
`final` or `error` — the `entities` met after the anchors, after each walk and after the
focus, with each card's `reason`, `role` (`anchor`, `reached`, `focus`) and `hop` — and
its own events, all in display names, never ids or keys:

| Event `type` | Fields | Meaning |
|---|---|---|
| `navigator.graph` | `steps` (`id`, `label`, `description`, `model`), `edges` (`from`, `to`, optional `label`; an edge to itself is a repeat) | The pipeline, once, right after `thread` |
| `navigator.step` | `id`, `status` (`running`, `done`, `skipped`, `failed`), `round`, and when it ends `durationMs` and an optional `summary` | One step starting or ending; every `running` is followed by exactly one end of the same `id` and `round`, unless the turn is cancelled; `skipped` arrives alone, with a summary and no duration |
| `navigator.summary` | `modelCalls`, `durationMs`, `entities`, `evidence`, `hops`, `timings` (milliseconds per step id) | Once, before `final` |

The answer cites evidence by ref in square brackets, one or several: `[E2]`, `[E2, E5]`.

**Read a thread.** As [shared](#assistant-chat-and-threads). No MCP equivalent exists.

## AI

Semantics: [capabilities/agents.md](../capabilities/agents.md). Chat requires a
language-model provider; the list remains available without one.

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/agents` | List the lens's agents, the default first |
| POST | `/ai/assistants/agents/{assistantKey}/chat` | Converse with one agent |
| GET | `/ai/assistants/agents/{assistantKey}/threads/{threadId}` | Read a thread back |

The default agent is implicit — it needs no configuration, exists on every lens and is
addressed by the key `_default` like any configured agent. The list names every agent as
`key`, `name`, `description` and `builtIn`; the default comes first, named `Default`, with
`builtIn` true.

Chat takes the [shared request](#assistant-chat-and-threads) and streams the shared frame:
`thread`, then the agent's tool events, then one terminal `final` or `error`; the answer
arrives whole in `final`, never as `delta`. Tool events are unconditional; there is no
response-mode option.

| Event `type` | Fields | Meaning |
|---|---|---|
| `agent.tool_call` | `callId`, `tool`, `args` | One invocation begins, including schema-invalid arguments |
| `agent.tool_result` | `callId`, `result` | That invocation completes; result retains its native JSON structure |

After a successful result of `get_entity`, `list_entities`, `get_neighbors`, `search` or
`search_documents`, an `entities` event carries the lens's entities it returned that the
turn had not sent yet, all evidence, and for `get_neighbors` the relations to them. Other
tools send none; the tool events are the same either way.

Call IDs are unique within a turn. Calls precede their results, and parallel results arrive
as each completes. An unknown agent, an unavailable provider and an unknown or busy thread
are rejected before streaming, using the ordinary HTTP error response. Disconnect cancels
further agent work, with best-effort cancellation of running operations. Reading a thread
needs no provider, as the list does.
