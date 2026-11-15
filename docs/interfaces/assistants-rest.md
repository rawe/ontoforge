# Assistants REST

The assistant routes of a lens, under the [runtime REST](runtime-rest.md) prefix
`/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`, and the
[Studio helper](#studio-helper)'s, under the [modeling REST](modeling-rest.md) prefix. Shared conventions — addressing,
errors, who may call — are in the [interfaces index](README.md).

## Assistant chat and threads

Every assistant kind — `agents`, `retrievers`, `navigators`, and the Studio helper — converses through the same request, the
same stream frame and the same threads. Semantics:
[capabilities/threads.md](../capabilities/threads.md). The kind's own section below lists its
routes, its extra request fields and its own events.

| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/assistants/<kind>/{assistantKey}/chat` | One message: a new thread, or a turn on an existing one |
| GET | `/ai/assistants/<kind>/{assistantKey}/threads/{threadId}` | Read a thread back |

**Request.** `message` (1 to 2,000 characters), optionally `threadId`, and optionally
`diagnostics` (boolean, default `false`) to receive the turn's
[`diagnostics` events](#diagnostics); a kind may add fields, and unknown fields are
rejected. Without `threadId` the message starts a new
thread bound to the addressed assistant; with it, the message continues that thread. A
thread that is unknown, expired, bound to another assistant or started by another
principal answers `RESOURCE_NOT_FOUND` with `details.code` `THREAD_NOT_FOUND`; a thread
whose previous message is still being answered answers `RESOURCE_CONFLICT` with
`details.code` `THREAD_BUSY`, and one that holds its most turns `RESOURCE_CONFLICT` with
`details.code` `THREAD_FULL`. All are plain error responses before the stream opens, like every other
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
| `diagnostics` | `steps` (one finished step) or `durationMs` (the whole turn) | Only when the request asked for diagnostics; [below](#diagnostics) |
| `final` | `reply`, and `artifacts` when the turn left any (each `type`, `version`, `value`) | Terminal: the complete answer |
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
store is full or fails. A turn whose language model fails or cuts its answer off ends with
`error` `MODEL_ERROR` ([its reasons](README.md#errors)); `delta` text sent before it is not
an answer. A turn that reaches its step limit ends with `error` `VALIDATION_ERROR`,
`details.code` `TOO_MANY_STEPS`. Unexpected failures after streaming begins have the generic `INTERNAL_ERROR` message `Internal Server Error`.
Delivery bounds buffering and terminates stalled or oversized streams.

There is no background continuation after a disconnect.

**Read a thread.** `200` with `threadId` and `messages` — the user messages and the
assistant's answers in order, each `role` (`user` or `assistant`), `content` and, on an
answer whose turn left any, `artifacts` — each `type`, `version` and `value` —, at most
the turns a thread keeps, without tool payloads. Unknown, expired, another assistant's or
another principal's thread: `THREAD_NOT_FOUND`. Reading needs no language-model provider
and does not count as use; it is gated like the kind's list.

### Diagnostics

With `diagnostics` true, a turn sends `diagnostics` events
([semantics](../capabilities/threads.md#diagnostics)), all before the terminal event: one
as each step ends, a failed step included, each `steps` holding that one step; then one
with the turn's `durationMs` in whole milliseconds, right before `final`, or before `error`
while the stream is still open. A step is one model call or one other piece of work, the
same shape for every kind:

| Field | Content |
|---|---|
| `index` | 1, 2, … in the order the steps started; the step's identity |
| `name` | A retriever's `plan`, `replan`, `retrieve`, `answer`; a navigator's step id (a repeated step is one step per round); the tool's name for an agent and the Studio helper. Absent on their model calls |
| `model` | `true` on a step that is one model call; absent on other work |
| `startMs` | Whole milliseconds from the turn's start, measured by the server; steps that ran in parallel overlap |
| `durationMs` | Whole milliseconds |
| `usage` | Model steps only: `input` (the whole prompt, cached parts included), `output`, `cacheRead`, `cacheWrite` — each only when the provider reported it, a reported 0 kept; absent when nothing was reported |
| `finishReason` | Model steps only, as the provider gave it, when it did |
| `failed` | `true` for a step that threw; a failed model call has no usage. A tool that answered with an error has not failed |
| `plan` | What a planning step decided, when its output could be read: on a retriever's `plan` and `replan` steps the plan below; on a navigator's `understand` step `summary`, the sentence it read the question as |

A client merges a turn's events: `steps` by `index`, and `durationMs` replaces the one
before. Totals — model calls, tokens — are the client's to add up. Time outside every step
shows only as the gap to `durationMs`. Without `diagnostics` no such event is sent.

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

**Chat.** The [shared request](#assistant-chat-and-threads). Without a language-model
provider the route answers `FEATURE_DISABLED`, as the AI routes do. An unknown retriever answers not found, a retriever its
lens can no longer run `VALIDATION_ERROR` with the errors under `details.errors`, a
default retriever with nothing to search `VALIDATION_ERROR`, an unknown or busy thread as
shared — each before the stream opens.

The response streams the [shared frame](#assistant-chat-and-threads): `thread`, the answer
as `delta` events, then one terminal `final` or `error`. Before the answer, when results
reached the answer model, one `entities` event carries them, all evidence, without links —
with or without diagnostics. Its own events:
`retriever.phase` (`phase` `plan`, `retrieve` or `answer`, `status` `start` or `end`).
Its [diagnostics](#diagnostics) steps are `plan`, `replan` for a follow-up's repeated
planning, `retrieve` and `answer`. The `plan` of a planning step: `subQueries` — each
`indices`, `relations`, `query`, `variants`, `mode`, `filters` (`id`, `value`, `quote`, and
the filter's definition from the retriever's configuration: `entityType`, `path`, `field`)
and `previous` — and `unsupportedReason`. The plan the answer used is the last step's that
carries one.

**Read a thread.** As [shared](#assistant-chat-and-threads).

**Retrieve.** The body carries `query` (1 to 2,000 characters); unknown fields — a thread
id or `diagnostics` among them — are rejected.
It is refused exactly as chat is, with plain error responses: `FEATURE_DISABLED` without
a language-model provider, not found for an
unknown retriever, `VALIDATION_ERROR` for a retriever its lens can no longer run (errors under
`details.errors`), a default retriever with nothing to search, a planner input over the cap
or a malformed plan; a failed planning call answers `MODEL_ERROR`. A closed connection cancels the work.

The response is `200` with `results` — best first, each `entityId`, `entityType`,
`label`, `conditions` (`filter`, `value`, `text`) and `matched` (the form
[capabilities/search.md](../capabilities/search.md#what-matched) describes, or null) — `limitations` and `unsupportedReason` when no index can answer. No results is not
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
| `navigator.graph` | `steps` (`id`, `label`, `description`), `edges` (`from`, `to`, optional `label`; an edge to itself is a repeat) | The pipeline, once, right after `thread` |
| `navigator.step` | `id`, `status` (`running`, `done`, `skipped`, `failed`), `round`, and when it ends an optional `summary` of what it did | One step starting or ending; every `running` is followed by exactly one end of the same `id` and `round`, unless the turn is cancelled; `skipped` arrives alone, with a summary. `understand` ends without a summary: its sentence is the `plan` of its [diagnostics](#diagnostics) step |

The answer cites evidence by ref in square brackets, one or several: `[E2]`, `[E2, E5]`.

**Read a thread.** As [shared](#assistant-chat-and-threads). No MCP equivalent exists.

## AI

Semantics: [capabilities/agents.md](../capabilities/agents.md). Chat requires a
language-model provider; the list remains available without one.

| Method | Path | Purpose |
|---|---|---|
| GET | `/ai/assistants/agents` | List the lens's agents, the default first |
| GET | `/ai/assistants/agent-schema` | The schema text every agent of the lens is given |
| POST | `/ai/assistants/agents/{assistantKey}/chat` | Converse with one agent |
| GET | `/ai/assistants/agents/{assistantKey}/threads/{threadId}` | Read a thread back |

The default agent is implicit — it needs no configuration, exists on every lens and is
addressed by the key `_default` like any configured agent. The list names every agent as
`key`, `name`, `description` and `builtIn`; the default comes first, named `Default`, with
`builtIn` true.

The schema read answers `{ "text": … }`: the description of the lens's schema that follows
every agent's prompt, its own or the built-in one, exactly as the model receives it. Like
the list it needs no provider, and the ontology's administrators may read it as they read
the lens's schema.

Chat takes the [shared request](#assistant-chat-and-threads) and streams the shared frame:
`thread`, then the agent's tool events, then one terminal `final` or `error`; the answer
arrives whole in `final`, never as `delta`. Tool events are unconditional; there is no
response-mode option.

| Event `type` | Fields | Meaning |
|---|---|---|
| `agent.tool_call` | `callId`, `tool`, `args` | One invocation begins, including schema-invalid arguments |
| `agent.tool_result` | `callId`, `result` | That invocation completes; result retains its native JSON structure, as the model was given it: [bounded, with `more` when it left something out](../capabilities/agents.md#result-size) |

After a successful result of `get_entity`, `list_entities`, `get_neighbors`, `search` or
`search_documents`, an `entities` event carries the lens's entities it returned that the
turn had not sent yet, all evidence, and for `get_neighbors` the relations to them. Other
tools send none; the tool events are the same either way.

Call IDs are unique within a turn. Calls precede their results, and parallel results arrive
as each completes. An unknown agent, an unavailable provider and an unknown or busy thread
are rejected before streaming, using the ordinary HTTP error response. Disconnect cancels
further agent work, with best-effort cancellation of running operations. Reading a thread
needs no provider, as the list does.

## Studio helper

Under the modeling prefix `/api/ontologies/{ontologyKey}/model`, for the ontology's
administrators. Semantics: [capabilities/studio-helper.md](../capabilities/studio-helper.md).
Chat requires a language-model provider; reading a thread does not.

| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/chat` | Converse with the Studio helper |
| GET | `/ai/threads/{threadId}` | Read a thread back |

Chat takes the [shared request](#assistant-chat-and-threads) plus optional `focus`, what the
page shows, and `draft`, the open editor's unsaved values. It streams `thread`, then the
tool events `studio.tool_call` and `studio.tool_result`, shaped as the
[agent's](#ai), then one terminal `final` or `error`; the answer arrives whole in `final`.
