# AI and agents

Language-model capabilities over a lens: holding a conversation with tools, configured
as agents.

**All of it requires a configured language-model provider.** With none configured, every
operation that would run a model is rejected. Clients are expected to check the server's
feature flags first and hide what is unavailable — see [../README.md](../README.md). One
asymmetry to know when reimplementing: listing agents does not run a model, so it keeps
answering normally on a server with no provider. Only a chat with an agent fails.

Everything here is runtime, and everything is scoped to one lens of one ontology
([ontology-lenses.md](ontology-lenses.md)). A model is given the lens's schema — the
lens's name and key, the system properties, each entity type with its
properties, their data types and required flags, and each relation type with its
endpoints. Out-of-scope types are not merely filtered out of results; they are never
described to the model in the first place — and nothing of any other ontology ever is.

## What it does

One task-shaped operation, plus a way to package it.

### Chat

Multi-turn conversation with tools. The model reads the schema, decides which tools to
call, and answers from what they return. Which tools it may call is what an agent
configures.

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
its structured result as soon as it completes. Repeated calls remain distinguishable, and
one slow parallel call does not hide another's result. Schema-invalid arguments and
recoverable validation/not-found failures remain visible while the model corrects them.
The assistant answer appears once, complete, after tool work finishes; a turn using no tools
still produces an answer. The wire contract lives in [interfaces](../interfaces.md#ai).

A fatal failure retains earlier results and marks the turn incomplete. Disconnect cancels
further model and tool work; cancellation of already-running operations is best effort.
Abandoned turns do not continue in the background or automatically restart.

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

## Through the interfaces

Configuring agents is modeling; running them is runtime. Complete operation index:
[../interfaces.md](../interfaces.md).

| | Where | Operations |
|---|---|---|
| Configure agents | Modeling REST, modeling MCP, the studio's agents tab | List, read one (REST), upsert by key, delete |
| Chat | Runtime REST only | One operation per agent, the default addressed by its key |
| List agents | Runtime REST | Every agent of the lens — key, name, description, whether built in — the default first |
| Web UI | The workbench's AI surface | Chat with an agent picker and persisted local threads |

Note the deliberate gap: **there are no MCP tools for chat.** An MCP
client is itself a language model; wrapping a second one behind a tool call would put a
model inside a model's tool. An MCP client gets the underlying tools directly instead.
