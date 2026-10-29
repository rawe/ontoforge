# Changesets stored as one record per staged object and per staged value, committed in fixed phases under a lock

Current behavior: [Changesets](../capabilities/changesets.md) and [changeset storage](../storage-adapters/contract.md#the-changeset-store)

## Context

A client plans many runtime writes, over hours or days, and hands the plan to a person who
reviews it; the plan must then persist all or nothing. Every immediate write persists one
object per call, and an MCP mount keeps nothing between calls. A plan touches the same
object many times — a rename and another, a document edited in small steps — and the
reviewer must see, cut and fix each change on its own. A check runs the commit's own
steps and rolls them back, holding the commit lock while it runs.

## Decision

Persist a changeset as a set of staged objects and individually addressable staged
values, bound to one lens, rather than a journal of calls or one whole-plan document.
Commit the plan atomically in fixed dependency phases under a lock, each phase applied
through batch writes on the port that behave as the single writes in sequence, so the
write semantics stay defined once; a check runs the same validation and commit steps and
rolls them back. Keep the captured before-state
until the caller explicitly rebases it. Do not hold a database transaction open while
the plan is being built.

## Consequences

A plan survives process restarts, is shared between servers and can be handed to a
reviewer. Repeated edits fold into the current staged value, which can be inspected or
cut independently, including partial document edits. Fixed phases handle graph
dependencies rather than relying on staging-call order. The representation requires
its own persisted lifecycle and commit validation; a reviewer sees only the lens-bound
plan, and ending a changeset does not add a retained-record or tombstone lifecycle.

## Rejected

- **An append-only journal of one record per staged call.** A document edited in small
  steps becomes a chain of edits, each holding a full copy of the text; the same property
  sits in several records, so cutting it means finding every one; and unstaging one
  record changes what another means.
- **A journal whose records can be revised.** Documents fold into one record, but the
  other properties still repeat across records: only half a set, with a call order the
  commit still depends on.
- **One record per staged object, its values in one JSON document.** Every rename
  rewrites a large document staged beside it, and one value has no key to cut it by.
- **Applying the staged objects in the order they were first touched.** Once later calls
  merge into earlier objects, that order says nothing about what depends on what; fixed
  phases create every end before its relations and delete every relation before its ends.
- **Refreshing the before at every staging call.** A change someone made meanwhile would
  be taken as the new before and overwritten without a trace; accepting it is an explicit
  rebase instead.
- **Document values staged only whole.** A client editing a long document would resend
  all of it for every small edit, and could not use the partial writes it uses without a
  changeset.
- **A database transaction held open per changeset.** It pins a pooled connection and
  holds its row locks for as long as the plan is built, blocking every other writer of
  those rows, and it dies with the connection or the process.
- **Process memory, or a list of writes the client keeps.** Memory is lost on a restart
  and not shared between server instances; a client's list cannot be handed to a
  reviewer, and the server sees nothing of it before the commit.
- **One JSONB document per changeset.** Every staged call rewrites the whole plan, and
  unstaging one object, paging the review and finding one staged object all read it whole.
- **Applying the plan through the service's write functions.** Their per-call graph rules
  would have to be set aside for intermediate states the plan passes through, which
  changes seven signatures, and it is the slowest way to apply it.
- **Submit running commit validation.** A plan with a fault its proposer cannot fix could
  never be handed over.
- **A tombstone, or the kept row, of an ended changeset.** It adds a second lifecycle and
  a sweep for a record that, without users, names nobody.
- **Changesets of the ontology rather than of a lens.** A reviewer would commit values
  their lens cannot see, and reaching a changeset from any lens bends the binding by URL.
