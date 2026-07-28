# 0004. Shared schema models in core/

- **Status:** Accepted

## Context

The Pydantic models for the ontology export format (`ExportPayload`, `ExportOntology`, and
the rest) are needed by both the modeling and the runtime module. Placing them in either
module would make the other depend on it.

## Decision

The export-format models live in `core/schemas.py`. Both modules import them from `core/`.
The runtime module never imports from the modeling module.

## Consequences

The dependency graph stays clean and acyclic: `modeling` → `core` ← `runtime`, with no
cross-dependency between the two feature modules.
