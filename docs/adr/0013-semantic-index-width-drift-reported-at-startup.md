# Vector index width drift is reported at startup and repaired on rebuild

Current behavior: [Vector index width drift](../capabilities/search.md#vector-index-width-drift)

## Context

A vector index fixes its width when created, and the idempotent DDL that ensures indexes
at startup does nothing against one that already exists. A changed embedding model
therefore leaves a vector index outside search indices rejecting every new vector, with
no symptom until the first operation that touches it fails.

## Decision

Startup warns about every width mismatch and repairs nothing; the search-data rebuild
repairs.

## Rejected

- **Repair at startup.** A drop takes semantic search down until every vector is
  regenerated, one model call per stored item. Spending that unasked trades a loud
  failure for a silently empty index.
- **An opt-in setting for startup repair.** The two existing paths already express the
  distinction: startup reports, the search-data rebuild repairs.
- **Documenting the manual recovery only.** It leaves the actual defect, that drift is
  invisible, in place.
