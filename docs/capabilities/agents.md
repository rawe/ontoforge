# AI and agents

Language-model capabilities over a lens: holding a conversation with tools, configured
as agents.

**All of it requires a configured language-model provider.** With none configured, every
operation that would run a model is rejected. Clients are expected to check the server's
feature flags first and hide what is unavailable — see [optional capabilities](../concepts.md#optional-capabilities). One
asymmetry to know when reimplementing: listing agents and reading a thread back do not
run a model, so they keep answering normally on a server with no provider. Only a chat
with an agent fails.

Everything here is runtime, and everything is scoped to one lens of one ontology
([ontology-lenses.md](ontology-lenses.md)). A model is given the lens's schema — the
lens's name and key, the system properties, each entity type with its
properties, their data types and required flags and its [identity](entity-identity.md) properties, and each relation type with its
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
| Key | Addresses the agent within its lens. A lens-resource [key](../glossary.md#schema-and-design), at most 64 characters |
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
  time and at import. An agent acts on a model's judgment; granting a write tool would
  let that judgment change stored data.
- The grantable set is the ten [tools](#tools) below. It is *narrower* than the read tools
  available over MCP — being read-only is not sufficient to be grantable; the read-only
  tools left out are called out in [../interfaces/](../interfaces/mcp.md#runtime-tools).
- **An agent reads documents by passage.** `search_documents` returns passages, each
  naming its document and its character offset and length. `get_document` reads those
  coordinates. MCP exposes the same document-search tool; neither surface takes a method
  block or a similarity floor, and both apply the fixed floor of
  [search.md](search.md#similarity-floor).
- Entity and document search tools are available whenever ranked search can run: the
  store ranks by keyword, or an embedding provider is installed. Only saved-query
  discovery requires an embedding provider specifically. This applies to the default
  toolset and explicit allowlists. The search tools return the search's response.
- An unknown tool name in an allowlist is rejected, and the error names the valid set.
  `get_schema` and `list_relations` are the exception when an allowlist is read from
  storage or from an imported file: they are not agent tools, and the allowlist is read
  without them instead of failing.
- When an agent defines a system prompt, that prompt is used and the schema description is
  appended to it. When it does not, a built-in prompt containing the schema is used. The
  schema is in the prompt either way; a custom prompt cannot omit it, and an agent
  therefore has no tool that reads the schema. The built-in prompt names no tool: an agent
  may have any subset, and each tool's description says what it is for.
- A tool that fails with a not-found or validation error does not fail the run. The error
  message is handed back to the model as the tool's result, so it can correct itself and
  retry within the same turn. A call to a tool name outside the agent's toolset is handed
  back the same way, with an error naming the called tool and the available tools. Only
  errors outside these cases abort.
- Agents belong to a lens: keys are unique within it, deleting the lens deletes them, and
  they travel with it through [transfer](transfer.md).

### Live tool activity

REST chat reports every tool invocation as it starts, with complete arguments, and attaches
its structured result as soon as it completes — always, with no switch: tool activity is
part of the product, not diagnostics. Repeated calls remain distinguishable, and one slow
parallel call does not hide another's result. Schema-invalid arguments and recoverable
validation/not-found failures remain visible while the model corrects them. The assistant
answer appears once, complete, after tool work finishes; a turn using no tools still
produces an answer. The wire contract lives in [interfaces](../interfaces/assistants-rest.md#ai).

Beside a successful result of an entity tool — reading, listing, searching entities or
document passages, or an entity's neighbours — the turn reports the entities it returned
that the lens shows, as [every assistant does](threads.md#the-entities-a-turn-met), with
the relations a neighbour read returned. Other tools report none, and the tool's own
activity is the same either way.

A fatal failure keeps the results already reported in the stream, ends the turn with an
error, and leaves nothing of the turn in its thread. Disconnect cancels further model and
tool work, and the turn with it; cancellation of already-running operations is best
effort. Abandoned turns do not continue in the background or automatically restart.

### Conversation

A conversation is a [thread](threads.md): the client sends its new message and the
thread's id, and the server continues from what the thread kept. What an agent's thread
adds to the rules there:

- **The model sees what it found, not only what it said.** A thread keeps each turn's tool
  calls and their results, and the model sees them — a follow-up can build on an earlier
  result without querying again.
- **A thread keeps the prompt its first turn ran with;** each turn uses the agent's
  current tools. A saved prompt applies to new threads.
- **Threads are per conversation, not per agent.** Two clients chatting with the same
  agent share nothing unless they share a thread id.

## Tools

An agent has up to ten tools, all reads through its lens:

| Tool | What it reads |
|---|---|
| `list_entities` | The entities of one type, a page at a time: filtered (also through one relation type), searched by a term, sorted |
| `get_entity` | One entity, by id |
| `get_neighbors` | One entity's neighbours with the relations that join them, by direction and relation type |
| `search` | Entities ranked for a text |
| `search_documents` | Document passages ranked for a text |
| `get_document` | The text of a document property, a piece at a time |
| `execute_query` | An [OQL](oql.md) query |
| `list_saved_queries`, `search_saved_queries` | The lens's [saved queries](saved-queries.md) |
| `run_saved_query` | One saved query, by its key |

They run the operations the runtime interfaces run, but they answer a different reader. A
model reads every result again with each later step of its conversation, cannot ask for
the rest unless the tool offers it, and takes what it sees for the whole. The rules below
follow from that, and they are what sets an agent's tool apart from the MCP tool of the
same name.

### Result size

**A result holds at most about 24,000 characters of data** — about 6,000 tokens, read
again with every later model call. The tool cuts its own result where it is made:

- at a whole row — an entity, a neighbour, a query row, a search item — never inside one;
- for a document, at the end of a piece: `get_document` returns at most 20,000
  characters per call — written out, quotes and line breaks take more room than they
  have characters — and without a range the first piece;
- inside one row or value that is larger than the bound alone: a long text ends with a
  marker saying how many of its characters are shown, a long list with one saying how
  many of its items; an object that is still too large keeps its leading values.

The result keeps its shape, the thread keeps it as it was sent
([threads.md](threads.md#turns)), and the web client is given the same result as the
model. The list of saved queries is not cut: it is as long as the saved queries a person
designed for the lens. Why the bound sits in the tools:
[ADR 0035](../adr/0035-a-tool-result-is-bounded-where-it-is-made.md).

### What a result left out

A result that leaves something out says so in `more`: one sentence for the model that
names what is missing and the call that gets it.

| Tool | `more` says |
|---|---|
| `list_entities` | Which rows of the total are shown, and the `offset` of the next ones |
| `execute_query`, `run_saved_query` | The same; both take an `offset` of rows to skip, and the query runs again for each page. Without ORDER BY the order of rows can change between calls, and the sentence says that too |
| `get_document` | Which characters are shown, and the `offset` where the text goes on |
| `get_neighbors` | Each direction that has more neighbours than were read. Neighbours cannot be paged, because they are read in no fixed order: the sentence names what narrows them — the relation type, the direction, fewer fields |
| `search`, `search_documents` | How many found items did not fit; a passage search can be repeated without the passages' text |

`get_entity` carries no `more`: a cut value says so itself. A value of a plain property
that is longer than the bound cannot be read further — long text belongs in a
[document property](documents.md), which is read in pieces.

### Selecting properties

`list_entities`, `get_entity` and `get_neighbors` take `fields`, the property keys to
return in place of every property; the id, the type and the name are always returned. A document
property is a [stub](documents.md) in every result, also when `fields` names it: only
`get_document` reads its text. A query result follows
[the query language's own rule](oql.md#results) for a renamed document column; the size
bound cuts such a value like any other.

### Arguments

Every parameter is described in the tool's own schema, a fixed choice is an enumeration,
and a limit has its range. An argument outside them, an argument the tool does not have,
an unknown property in `fields`, an unknown sort field or an unknown relation type goes
back to the model as the call's error, naming what is valid — never as another meaning
of the call.

`get_neighbors` reads each direction with its own limit, so one direction never takes the
other's room, as it can in the [runtime read](instance-data.md#traversal).

## Through the interfaces

Configuring agents is modeling; running them is runtime. Complete operation index:
[../interfaces/](../interfaces/README.md).

| | Where | Operations |
|---|---|---|
| Configure agents | Modeling REST, modeling MCP, the studio's agents tab | List, read one, upsert by key, delete |
| Chat | Runtime REST only | One operation per agent, the default addressed by its key; reading a thread back |
| List agents | Runtime REST | Every agent of the lens — key, name, description, whether built in — the default first |
| Web UI | The workbench's Assistants page, Agents tab | Chat with an agent picker; conversations restored from their server threads |

Note the deliberate gap: **there are no MCP tools for chat.** An MCP
client is itself a language model; wrapping a second one behind a tool call would put a
model inside a model's tool. An MCP client gets the underlying tools directly instead.
