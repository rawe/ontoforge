# One shared opt-in diagnostics event of steps; progress and content stay each kind's own

Current behavior: [Diagnostics](../capabilities/threads.md#diagnostics),
[the event](../interfaces/assistants-rest.md#diagnostics)

## Context

Tuning any assistant needs to see where a turn's time and tokens went, step by step, and
what a step decided. The kinds' work events — an agent's tool activity, a
retriever's phases, a navigator's steps — differ in shape and are what each kind's view is
built from; times, token counts and model-call counts were spread over them and over
kind-specific fields.

## Decision

Every assistant kind takes the same opt-in `diagnostics` request field and answers it with
one shared `diagnostics` event: the turn's steps — each model call and each other piece of
work — in one shape, measured by the server, with an optional detail on any step, one
string with the exact data it produced, then the turn's time; nothing a kind adds besides, so
a client shows every kind's diagnostics without knowing the kind. The kinds' events keep their names and
say what was done and found, never how long it took or what it cost.

## Rejected

- **A shared `step` progress event for every kind.** The kinds' work differs in shape,
  and each client view already reads its kind's own events; a common always-on event would
  add a second account of the same work that no view needs. The diagnostics steps are
  sent only on request and when a step has ended, and give a time one place instead of
  several.
- **Usage totals always on `final`.** Model calls and tokens are for debugging and tuning,
  not for every answer; keeping them behind the request keeps the default stream free of
  cost numbers.
- **Removing the kind prefix from event names.** The readers on both sides are already
  shared through the prefix; the rename would change every client and save nothing.
- **An always-on plan event.** A retriever's plan says what it decided to search, but it
  serves tuning, not the answer's reader; it is the detail of its planning step in
  diagnostics.
- **A second opt-in for the plan.** A second request field would bring a second switch and
  a second channel for one kind's tuning data; the plan is small enough to come with the
  steps.
- **A structured value on a step, shaped by its kind.** A retriever's plan as an object
  and a navigator's as another would make a client know the kind to read a step, and every
  new kind would need work in every client; one string, shown as written, reads the same
  for all.
