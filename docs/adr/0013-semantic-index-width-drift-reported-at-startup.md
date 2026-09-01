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

The rebuild-embeddings operation does repair, in three phases: it drops every mismatched
index, regenerates every vector at the new width, and only then builds the indexes it
dropped. The three cannot be collapsed into fewer — an index rejects every vector of a
width other than its own, so while a drifted one stands the new vectors cannot be written,
and it cannot be built over the old ones. The operator asked for exactly this, and the
endpoint's documentation already named a changed embedding model as a reason to run it.

## Consequences

The defect becomes visible at startup instead of at the first failed search. Startup does
not repair, because a drop takes semantic search down until every vector has been
regenerated — one model call per stored item, and minutes of it — and spending that
unasked would trade a loud failure for a silently empty index. The vectors themselves are
not at stake: they live in the store's own column, and dropping an index leaves them
untouched.

No opt-in setting was added: the two paths that already exist express the distinction.

The warning is emitted inside the adapter rather than crossing the port, because index
width is not a domain concept and the port would gain a return type for one log line. The
no-vendor, no-physical-naming rule of 0010 is met by phrasing the messages in API
vocabulary.

## Alternatives considered

- **Repair at startup** — rejected: it spends a full re-embedding, and the downtime that
  comes with it, without consent.
- **Document the manual recovery only** — rejected: it leaves the actual defect, the
  invisibility, in place.
