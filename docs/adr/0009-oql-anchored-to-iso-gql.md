# 0009. OQL: OntoForge's own query language, anchored to ISO GQL

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

The user-facing query feature — the query endpoint, saved queries, and AI query generation
— was built on a read-only, openCypher-shaped subset that OntoForge had already validated.
Left as "a Cypher subset", the feature would remain defined by a vendor dialect, which
does not survive an exchangeable storage backend (0008).

## Decision

The query feature uses OQL: that same validated subset, now specified as OntoForge's own
language over ontology type keys. Its normative reference is the ISO GQL standard
(ISO/IEC 39075:2024) and its GPML pattern sublanguage (shared with SQL/PGQ,
ISO/IEC 9075-16), not Neo4j Cypher. Where validator behaviour diverges from the standard,
the spec follows ISO.

## Consequences

Parsing and validation are database-independent; compilation to the native dialect is
adapter-private. The language surface — supported clauses, blocked operations, reserved
names, error codes — is specified in `api-contracts/runtime-api.md` §7; no separate spec
document is maintained.

The ISO anchoring was settled explicitly by the user.
