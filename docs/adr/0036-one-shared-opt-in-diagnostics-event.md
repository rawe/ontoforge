# One shared opt-in diagnostics event; work events stay each kind's own

Current behavior: [Diagnostics](../capabilities/threads.md#diagnostics),
[the event](../interfaces/assistants-rest.md#diagnostics)

## Context

Tuning any assistant needs to see its model calls — how long each took, what it cost in
tokens, why it stopped — but only the retriever reported anything of the kind, in its own
event. The kinds' work events — an agent's tool activity, a retriever's phases, a
navigator's steps — differ in shape and are what each kind's view is built from.

## Decision

Every assistant kind takes the same opt-in `diagnostics` request field and answers it with
one shared `diagnostics` event: its model calls in one shape, plus fields a kind adds.
The kinds' work events keep their names and payloads, and nothing new is sent without the
request.

## Rejected

- **A shared `step` progress event for every kind.** The kinds' work differs in shape,
  and each client view already reads its kind's own events; a common event would add a
  second account of the same work that no view needs.
- **Usage totals always on `final`.** Model calls and tokens are for debugging and tuning,
  not for every answer; keeping them behind the request keeps the default stream as it is.
- **Removing the kind prefix from event names.** The readers on both sides are already
  shared through the prefix; the rename would change every client and save nothing.
