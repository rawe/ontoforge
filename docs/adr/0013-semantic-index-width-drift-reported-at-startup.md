# 0013. Semantic-index width drift is reported at startup, repaired on rebuild

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

A vector index fixes its width when it is created, and the `IF NOT EXISTS` DDL that
ensures indexes on startup is a no-op against an index that already exists. Changing the
embedding model therefore left indexes that reject every vector the new model produces,
with no symptom at all until the first semantic search failed.

## Decision

Startup reads each existing index's width, compares it against the configured provider,
and warns per mismatch — naming the entity type, document property, or search scope, both
widths, and the remedy. It does not repair.

The rebuild-embeddings operation does repair, because there the drop is immediately
followed by regeneration at the new width — the operator asked for exactly that, and the
endpoint's documentation already named a changed embedding model as a reason to run it.

## Consequences

The defect becomes visible at startup instead of at the first failed search. Startup does
not repair, because dropping an index destroys the vectors it holds, and doing that
unasked would trade a loud failure for an empty index and a silently wrong answer.

No opt-in setting was added: the two paths that already exist express the distinction.

The warning is emitted inside the adapter rather than crossing the port, because index
width is not a domain concept and the port would gain a return type for one log line. The
no-vendor, no-physical-naming rule of 0010 is met by phrasing the messages in API
vocabulary.

## Alternatives considered

- **Repair at startup** — rejected as destructive without consent.
- **Document the manual recovery only** — rejected: it leaves the actual defect, the
  invisibility, in place.
