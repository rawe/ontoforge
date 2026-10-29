# Unexpected storage failures become one storage error with an error id

Current behavior: [Errors](../interfaces.md#errors)

## Context

An unexpected driver failure has to reach the caller as something. Passed through, it
names the vendor and its physical objects; swallowed, it becomes a bare 500 that cannot
be traced back to the stack that produced it.

## Decision

An unexpected storage failure answers `STORAGE_ERROR` with a generated `errorId` only; the
adapter logs the original against that id.

## Rejected

- **A condition taxonomy**: a retryable 503 for connection loss and a 409 for any
  database-raised constraint violation. Speculative: connection loss is not an observed
  condition, and a constraint violation that matters is one a service pre-check guards,
  which is answered with that pre-check's own error.
