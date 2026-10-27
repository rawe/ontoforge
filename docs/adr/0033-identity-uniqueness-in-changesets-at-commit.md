# Identity uniqueness in changesets judged at the commit, under a deferred constraint

Current behavior: [Identity in a changeset](../capabilities/entity-identity.md#in-a-changeset) and [storage obligations](../storage-adapters.md#obligations-beyond-storage)

## Context

A changeset stages many writes over a long time and commits them in fixed phases, creates
before updates and deletes last. A plan may swap two identities or replace an entity by a
new one with the same identity, so an identity can be held twice in the middle of a commit.
Immediate writes take no commit lock and can take an identity while a commit runs.

## Rejected

- **Uniqueness checked at every staged call.** A swap or a replacement could never be
  staged, because one of its halves always collides with the stored state.
- **Re-resolving a stale staged create into an update at the commit.** The commit would
  then write something other than what the reviewer saw.
- **The generic storage error for a violation at the end of the commit.** The caller would
  read a server failure where the answer is that an identity was taken meanwhile and the
  plan only needs another check.
