# A tool result is bounded where it is made

Current behavior: [Tools](../capabilities/agents.md#tools)

## Context

An agent's thread keeps every tool result and sends it again with each later model call,
and nothing already sent may change ([ADR 0034](0034-a-full-context-window-ends-the-conversation.md)).
One unbounded result — a whole document, every row of a query — could fill the window on
its own, and a short result gave the model no way to reach the rest.

## Decision

Each agent tool bounds its own result to about 24,000 characters, cut at a whole row or a
piece of a document, and a result that leaves something out says in one sentence how to
get it. The model and the web client are given the same result.

## Consequences

A large answer takes several calls, and each one stays in the thread. A plain value
longer than the bound cannot be read further. A paged query runs again for every page.

## Rejected

- **One character limit in the tool loop.** It needs no knowledge of the tools, but it
  cuts JSON in the middle: the web client can no longer draw the result, and the model is
  told only that something is missing, not how to ask for it.
- **The whole result for the web client, a cut one for the model.** The person would see
  rows the model never read, and the thread would hold two versions of one result.
- **A bound derived from a configured context window.** No such setting exists
  ([ADR 0034](0034-a-full-context-window-ends-the-conversation.md)); one fixed number is
  enough for every result to stay a small part of any window in use.
