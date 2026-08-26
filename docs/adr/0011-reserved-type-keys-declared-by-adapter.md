# 0011. Reserved type keys are declared by the adapter, enforced by the service

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

A type key whose physical form would collide with a storage adapter's own schema objects
must be rejected. Which keys collide depends entirely on the adapter's physical naming, so
the knowledge lives below the persistence port — but the rejection belongs in the
validation pipeline above it.

## Decision

The adapter derives its reserved sets from its physical naming and exposes them through
the persistence port as plain type keys — `reservedEntityTypeKeys()` and
`reservedRelationTypeKeys()` on the modeling store. The modeling service rejects a
colliding key on every write path with a `VALIDATION_ERROR` that names neither the vendor
nor the physical name.

## Consequences

The check runs in one place and is inherited by every future adapter, which only has to
declare its own reserved sets.

Types created before the check existed are not migrated — renaming a type key is
destructive and is the operator's decision — but the server names each one in a startup
warning.

## Alternatives considered

- **A constant in `core/`** — rejected: it would encode Neo4j-derived names in
  database-agnostic code, breaking 0008.
- **Rejection inside the store at write time** — rejected: it would deliver the error from
  persistence rather than from the service validation pipeline, and each future adapter
  would have to reimplement it.
