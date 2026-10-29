# Access data in a database of its own

Current behavior: [Authentication and authorization](../architecture.md#authentication-and-authorization)

## Context

With authentication on, every protected request on every server reads who the caller is
and which roles it holds. That data must be durable, outside anything an ontology's design,
transfer or deletion can touch, and kept apart from what may be lost.

The separation protects access authority from ontology contents; deleting a resource
still removes its role assignments, without deleting principals or unrelated access data.

## Decision

With authentication enabled, persist principals, verified identities and role assignments
in an access database of their own, behind a port separate from ontology persistence
and from recoverable shared state.

## Consequences

Ontology schema changes and transfer cannot redefine the authority deciding access.
The separate database allows independent credential and backup management; it does not
require credentials to differ. Moving it to another instance changes its address rather
than its data model. Resource deletion cleans its assignments rather than the security
store as a whole. There
is no shared transaction with ontology creation/deletion: a creator assignment precedes
the ontology under its never-reused id, and assignments left by deletion are inert.

## Rejected

- **Tables in the ontology database.** Ontology creation and deletion could then share a
  transaction with the assignments they touch, but security data would share the ontology
  storage's lifecycle, credentials and backups, and moving it to an instance of its own
  would need a migration instead of a new address. Without a shared transaction, a creator's
  assignment is written before the ontology, under its id, and a deletion's leftover
  assignments are inert because ids are never reused.
- **An ontology holding the users.** Ordinary schema edits, imports and deletes would then
  decide who may do what.
- **Shared state.** It may lose and expire what it holds; a lost role would lock people
  out, and a restored one could reopen what was revoked.
