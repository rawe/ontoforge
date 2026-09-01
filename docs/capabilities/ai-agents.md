# AI and agents

Language-model capabilities over a lens: asking a question in natural language, pulling
structured knowledge out of free text, holding a conversation, and exposing any of that
to other systems as an agent.

**All of it requires a configured language-model provider.** With none configured, every
operation that would run a model is rejected. Clients are expected to check the server's
feature flags first and hide what is unavailable — see [../README.md](../README.md). One
asymmetry to know when reimplementing: listing agents and fetching an agent card do not
run a model, so they keep answering normally on a server with no provider. Only a task
sent to that agent fails.

Everything here is runtime, and everything is scoped to one lens of one ontology
([ontology-lenses.md](ontology-lenses.md)). A model is given the lens's schema — the
lens's name and key, the system properties, each entity type with its
properties, their data types and required flags, and each relation type with its
endpoints. Out-of-scope types are not merely filtered out of results; they are never
described to the model in the first place — and nothing of any other ontology ever is.

## What it does

Three task-shaped operations, plus a way to package them.

### Ask a question

One question in, one answer out. The model is given the schema and exactly one tool:
OQL execution. It composes a query, runs it, and writes an answer from the rows.

The response is not just prose. It carries **the generated OQL** and **the raw result
rows** alongside the answer, so a caller can show its work, verify it, or re-run the query
in a console. If the model answered without ever calling the tool, both are absent — which
is itself the signal that the answer was not grounded in data.

### Extract from free text

Text in, proposed entities and relations out, shaped to the lens's schema. The model runs
with no tools at all — only the schema in its prompt — and returns structured output. An
optional list of entity types narrows what it is asked to look for; that is a hint added
to the prompt, not a constraint enforced on the result.

Extraction is **propose-then-persist**. By default nothing is written: the caller receives
proposals and decides. The reason is that the alternative is unreviewable — a language
model reading prose will invent a plausible property value as readily as it will read one,
and a write that happens before a human sees it cannot be compared against the source
text. Persistence is opt-in per call, and the response states whether it happened.

When persistence is requested, entities are created first, then each relation's endpoints
are resolved. The rules there are narrow and worth stating plainly:

- Endpoints are given as `match` maps of property values. They are resolved **only against
  the entities created in this same call**, never against data already in the graph.
- A match map is a **subset** of the entity's properties: an endpoint naming only a name
  resolves an entity that also carries an age. It is compared against what was written,
  after coercion, so a value the write pipeline converted still matches.
- An endpoint that matches **more than one** created entity does not resolve. Neither does
  an empty match map. Ambiguity is never guessed: a relation attached to the wrong entity
  is worse than a missing one, because nothing downstream can tell it was wrong.
- A relation whose endpoints do not both resolve is dropped. The call still succeeds — an
  unresolvable endpoint is not an error — but the response **lists every dropped relation
  with the reason**, so a run that wrote entities and no relations says so.
- Created entities are not deduplicated against anything. Running the same text twice
  creates two sets of entities.

So the persist path is for bulk ingestion into a known-empty region, not for merging into
existing data. Reviewing the proposals and creating through the ordinary entity and
relation operations ([instance-data.md](instance-data.md)) is the path that gives you
matching, deduplication and error reporting.

### Chat

Multi-turn conversation with tools. The model reads the schema, decides which tools to
call, and answers from what they return. Which tools it may call is what an agent
configures.

## Agents

An **agent** is a named language-model configuration belonging to one lens:

| Field | Meaning |
|---|---|
| Key | Addresses the agent within its lens. Matches `^[a-z][a-z0-9_-]*$`, at most 64 characters |
| Name | Human-readable label, also the name on its agent card |
| Description | What it is for; also advertised on its card |
| System prompt | Replaces the built-in chat prompt |
| Tools | Allowlist of tool names, or absent for "every tool available to an agent" |

Every lens also has an **implicit default agent**. It is not stored, cannot be configured
or deleted, has no system prompt of its own and no tool restriction. Its key begins with
an underscore, which no configurable key may, so it can never be shadowed. It appears in
agent listings alongside the configured ones and publishes its own card. Plain chat
without naming an agent is a run of this default agent.

### Rules

- **Agent tools are the read-only subset, always.** The allowlist is validated against
  that set, so a write tool name is not merely ignored — it is rejected at definition
  time and at import. There is no configuration, and no system prompt, that gives an
  agent the ability to create, update or delete anything. This is what makes it safe to
  expose an agent to an untrusted caller over A2A.
- The grantable set is *narrower* than the read tools available over MCP — being read-only
  is not sufficient to be grantable. The tools are named, and the read-only ones left out
  of the set are called out, in
  [../interfaces.md](../interfaces.md#runtime-tools). The exclusion that shapes behaviour
  most: fetching document content is not grantable, so an agent reads document properties
  as the stubs described in [documents.md](documents.md).
- Tools that need an embedding provider — semantic search and saved-query search — are
  dropped from the effective toolset when none is configured. This applies to the default
  agent and to explicit allowlists alike, so an allowlist naming them still works on a
  server without embeddings; it just yields fewer tools.
- An unknown tool name in an allowlist is rejected, and the error names the valid set.
- When an agent defines a system prompt, that prompt is used and the schema description is
  appended to it. When it does not, a built-in prompt containing the schema is used. The
  schema is in the prompt either way; a custom prompt cannot omit it.
- A tool that fails with a not-found or validation error does not fail the run. The error
  message is handed back to the model as the tool's result, so it can correct itself and
  retry within the same turn. Only errors outside that pair abort.
- Agents belong to a lens: keys are unique within it, deleting the lens deletes them, and
  they travel with it through [transfer](transfer.md). Defining or deleting one
  invalidates the schema cache.

### Tool-call trace

A chat call can ask for the trace of tool calls made while producing the answer. It comes
back as an ordered list of tool names with the arguments each was called with — the
arguments only, not the results. It is off by default and requested per call. This is how
a client shows what the model actually did, and how a reviewer notices that an answer came
from no tool call at all.

### Conversation history

The server holds none. Chat is stateless: a caller that wants a multi-turn conversation
sends the prior turns with each request, as an ordered list of role-and-content pairs with
roles limited to user and assistant.

Consequences a reimplementer should not have to discover:

- Only text is carried back. Tool calls and their results from earlier turns are not part
  of history, so the model sees what it *said*, not what it *found*.
- Nothing is truncated, summarized or windowed. The caller owns the transcript and its
  growth, and is the only thing standing between a long conversation and the model's
  context limit.
- History is per caller. Two clients chatting with the same agent share nothing.

## A2A

The agent-to-agent protocol lets an external system use an agent without knowing anything
about OntoForge's own API. Every agent participates — the default one and each configured
one — each with its own card and its own task endpoint.

### The card

A card is a machine-readable JSON description served at a well-known path under the
agent's route. It advertises:

| Advertises | Notes |
|---|---|
| Name and description | The agent's own. An agent with no description gets a generated one naming the lens and listing its entity and relation type keys |
| Task endpoint URL | Absolute, so a client needs nothing else to call it |
| Version | Of the card |
| Capability flags | Streaming and push notifications, both false |
| Skills | Exactly one, a chat skill named for the lens |

The absolute URL is built from the configured public base address; without one, it is
derived from the request's forwarded-protocol and host headers. Deployments behind a
proxy that rewrites neither will advertise an address their callers cannot reach.

### Sending a task

One JSON-RPC 2.0 call over a single request. Exactly one method is supported —
task submission. Any other method name answers a JSON-RPC method-not-found error rather
than an HTTP error.

The request's message carries parts; the text parts are concatenated into the prompt, and
a message with no text answers an invalid-params error. The reply carries the task
identifier — echoed from the request when given, otherwise generated — a status of
completed, and a single artifact holding one text part with the answer.

Three properties follow from that shape and are load-bearing:

- **Non-streaming.** The call blocks until the answer is complete and returns it whole.
  There is no incremental delivery, no polling, and no state other than completed.
- **Single skill.** A card never advertises more than the one chat skill, whatever the
  agent's tools are.
- **No conversation.** Each task is independent. The task identifier is echoed, not
  remembered, and no history is carried, so a caller cannot build a conversation out of
  successive tasks.

## Through the interfaces

Configuring agents is modeling; running them is runtime. Complete operation index:
[../interfaces.md](../interfaces.md).

| | Where | Operations |
|---|---|---|
| Configure agents | Modeling REST, modeling MCP, the studio's agents tab | List, upsert by key, delete |
| Ask, extract, chat | Runtime REST only | One operation each; chat also in a per-agent form |
| Discover agents | Runtime REST | Lists the default agent and every configured one |
| A2A | Runtime REST | A card and a task endpoint per agent, including the default |
| Web UI | The workbench's AI surface | Chat with an agent picker and persisted local threads, one-shot ask with the generated query shown, and extract with a review step that creates through the ordinary write operations |

Note the deliberate gap: **there are no MCP tools for ask, extract or chat.** An MCP
client is itself a language model; wrapping a second one behind a tool call would put a
model inside a model's tool. An MCP client gets the underlying tools directly instead.
