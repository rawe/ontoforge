# AI and agents

Language-model capabilities over a lens: holding a conversation with tools, configured
as agents.

**All of it requires a configured language-model provider.** With none configured, every
operation that would run a model is rejected. Clients are expected to check the server's
feature flags first and hide what is unavailable — see [../README.md](../README.md). One
asymmetry to know when reimplementing: listing agents and reading a thread back do not
run a model, so they keep answering normally on a server with no provider. Only a chat
with an agent fails.

Everything here is runtime, and everything is scoped to one lens of one ontology
([ontology-lenses.md](ontology-lenses.md)). A model is given the lens's schema — the
lens's name and key, the system properties, each entity type with its
properties, their data types and required flags, and each relation type with its
endpoints. Out-of-scope types are not merely filtered out of results; they are never
described to the model in the first place — and nothing of any other ontology ever is.

## What it does

One task-shaped operation, plus a way to package it.

### Chat

Multi-turn conversation with tools, held by the server as a
[thread](threads.md). The model reads the schema, decides which tools to call, and
answers from what they return. Which tools it may call is what an agent configures.

## Agents

An **agent** is a named language-model configuration belonging to one lens:

| Field | Meaning |
|---|---|
| Key | Addresses the agent within its lens. A lens-resource [key](../README.md), at most 64 characters |
| Name | Human-readable label |
| Description | What it is for |
| System prompt | Replaces the built-in chat prompt |
| Tools | Allowlist of tool names, or absent for "every tool available to an agent" |

Every lens also has an **implicit default agent**. It is not stored, cannot be configured
or deleted, has no system prompt of its own and no tool restriction. Its key begins with
an underscore, which no configurable key may, so it can never be shadowed. It is
addressed by that key like any configured agent, and is named `Default`. Modeling does not
know it: it is not listed, read or written there.

### Rules

- **Agent tools are the read-only subset, always.** The allowlist is validated against
  that set, so a write tool name is not merely ignored — it is rejected at definition
  time and at import. Agents are read-only so that no configuration, and no system
  prompt, can make one create, update or delete anything.
- The grantable set is *narrower* than the read tools available over MCP — being read-only
  is not sufficient to be grantable. The tools are named, and the read-only one left out
  of the set is called out, in [../interfaces.md](../interfaces.md#runtime-tools).
- **An agent reads documents by passage.** `search_documents` returns entities with
  document matches naming the property and character range. `get_document` reads those
  coordinates. MCP exposes the same document-search tool; neither surface takes a strategy
  or a similarity floor, and both apply the fixed floor of [search.md](search.md#similarity-floor)
  whenever the default strategy ranks semantically.
- Entity and document search tools are available whenever a search strategy is available.
  Only saved-query discovery requires an embedding provider specifically. This applies to
  the default toolset and explicit allowlists. The search tools return the full envelope
  and state the relative-score promise in their descriptions.
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

### Live tool activity

REST chat reports every tool invocation as it starts, with complete arguments, and attaches
its structured result as soon as it completes — always, with no switch: tool activity is
part of the product, not diagnostics. Repeated calls remain distinguishable, and one slow
parallel call does not hide another's result. Schema-invalid arguments and recoverable
validation/not-found failures remain visible while the model corrects them. The assistant
answer appears once, complete, after tool work finishes; a turn using no tools still
produces an answer. The wire contract lives in [interfaces](../interfaces.md#ai).

A fatal failure keeps the results already reported in the stream, ends the turn with an
error, and leaves nothing of the turn in its thread. Disconnect cancels further model and
tool work, and the turn with it; cancellation of already-running operations is best
effort. Abandoned turns do not continue in the background or automatically restart.

### Conversation

A conversation is a [thread](threads.md): the client sends its new message and the
thread's id, and the server continues from what the thread kept. What an agent's thread
adds to the rules there:

- **The model sees what it found, not only what it said.** A thread keeps each turn's tool
  calls and their results, and the model sees them for the recent turns — a follow-up can
  build on an earlier result without querying again.
- **Each turn runs the agent's current configuration** — its prompt, its tools — against
  the conversation so far, so a saved change applies from the next turn on.
- **Threads are per conversation, not per agent.** Two clients chatting with the same
  agent share nothing unless they share a thread id.

## Through the interfaces

Configuring agents is modeling; running them is runtime. Complete operation index:
[../interfaces.md](../interfaces.md).

| | Where | Operations |
|---|---|---|
| Configure agents | Modeling REST, modeling MCP, the studio's agents tab | List, read one, upsert by key, delete |
| Chat | Runtime REST only | One operation per agent, the default addressed by its key; reading a thread back |
| List agents | Runtime REST | Every agent of the lens — key, name, description, whether built in — the default first |
| Web UI | The workbench's AI surface | Chat with an agent picker and persisted local threads |

Note the deliberate gap: **there are no MCP tools for chat.** An MCP
client is itself a language model; wrapping a second one behind a tool call would put a
model inside a model's tool. An MCP client gets the underlying tools directly instead.
