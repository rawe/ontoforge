# Changesets stored one record per staged write, committed under a lock

Rule: [Storage](../decisions.md#storage)

## Context

A client plans many runtime writes, over hours or days, and hands the plan to a person who
reviews it; the plan must then persist all or nothing. Every immediate write persists one
object per call, and an MCP mount keeps nothing between calls.

## Rejected

- **A database transaction held open per changeset.** It pins a pooled connection and
  holds its row locks for as long as the plan is built, blocking every other writer of
  those rows, and it dies with the connection or the process.
- **Process memory, or a list of writes the client keeps.** Memory is lost on a restart
  and not shared between server instances; a client's list cannot be handed to a
  reviewer, and the server sees nothing of it before the commit.
- **One JSONB document per changeset.** Every staged write rewrites the whole plan, and
  unstaging one write, paging the review and finding a minted id all read it whole.
- **Replay through the service's write functions.** Their per-call graph rules would have
  to be set aside for intermediate states the plan passes through, which changes seven
  signatures, and it is the slowest replay.
- **Set-based SQL for the commit.** It writes the write semantics a second time, beside
  the immediate path's, for a speed the store replay has not been shown to lack.
- **Submit running commit validation, or a separate check verb.** Validation holds the
  ontology's commit lock and row locks on every try for a verdict that is stale by review
  time, and a plan with a fault its proposer cannot fix could never be handed over; a
  check verb adds a term, a tool and a route at a commit's cost.
- **A tombstone, or the kept row, of an ended changeset.** It adds a second lifecycle and
  a sweep for a record that, without users, names nobody.
- **Changesets of the ontology rather than of a lens.** A reviewer would commit values
  their lens cannot see, and reaching a changeset from any lens bends the binding by URL.
