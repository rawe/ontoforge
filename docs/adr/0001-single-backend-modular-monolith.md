# 0001. Single backend, modular monolith

- **Status:** Accepted

## Context

OntoForge covers two distinct concerns — designing the schema and using it at runtime.
They could be built as separate deployable services or as one application with an internal
boundary between them.

## Decision

One Python backend application, with separate code modules for `modeling`, `runtime`, and
a shared `core`.

## Consequences

The two concerns are separated in code but deployed together. The module boundary is kept
sharp enough that the modules can be separated into services later if that ever becomes
necessary.

## Alternatives considered

- **Two separate services** — rejected in favour of a single application with internal
  modules.
