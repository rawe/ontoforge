# A full context window ends the conversation

Current behavior: [Turns](../capabilities/threads.md#turns)

## Context

An agent's thread keeps every tool call and result, so it grows until the model's context
window is full. What is sent must stay unchanged from call to call, or no provider can
reuse what it already read.

## Decision

A conversation that no longer fits ends with a clear error; the client starts a new thread.
Nothing already sent is cut, replaced or summarised.

## Rejected

- **A sliding window that drops the oldest messages.** Every turn changes the beginning of
  what is sent, so nothing is reused and every turn costs full price.
- **Summarising the thread when it is full.** One more model call, details can be lost, and
  it is not needed to end cleanly. It can be added at a turn's end later.
- **A configured context window with a check before each call.** The provider's own refusal
  already ends the turn cleanly; the setting only helps a server that drops old messages
  without an error.
