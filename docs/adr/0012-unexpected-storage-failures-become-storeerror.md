# 0012. Unexpected storage failures become `StoreError`, correlated by error id

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

The persistence port's contract rule 4 says driver exceptions never cross the port, but
nothing enforced it. An unexpected driver failure surfaced to the caller as a bare
`Internal Server Error`, which could not be traced back to the stack that produced it.

## Decision

Rule 4 is implemented rather than reworded. The adapter opens every database session
through a single translating helper, so any driver failure surfaces as `StoreError` and is
answered with a structured `500 STORAGE_ERROR` body.

`StoreError` carries no storage detail — the driver's message names the vendor and
physical objects, which 0010 keeps out of the public surface. The adapter logs the
original against a generated `errorId` and returns only that id in `details`.

## Consequences

A reported 500 can be traced to its server-side stack via the error id — the practical
difference between a structured error and a generic one. Expected conditions keep their
existing paths and are unaffected.

## Alternatives considered

- **A condition taxonomy** — a retryable `503` for connection loss and `409` for
  database-raised constraint violations. Rejected as speculative: those conditions are not
  currently observed, and duplicate keys are already pre-checked before reaching the
  database. A second adapter, or a real incident, is the trigger to revisit this.
