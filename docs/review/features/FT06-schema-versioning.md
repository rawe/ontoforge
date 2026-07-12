# FT06 — Schema Versioning & Change Safety

> **Type: Feature concept** · **Effort: Large** · **Priority: Lower — but decide the direction early**
> Picks up the PRD "Versioned schema migrations" future extension; informed by the observed
> format churn (2.0 → 2.1 → 2.2 with breaking changes and "no migration path" notes).

## Problem

The project's own history demonstrates the gap: the lens-model pivot shipped as "breaking change,
no migration path — recreate your setup", and the export format has moved three versions with
docs disagreeing about which one is current. That was acceptable while OntoForge had one user;
it stops being acceptable the moment external applications treat OntoForge as their persistence
layer (which is the declared intended workflow). Schema changes then need to be *safe by
default* — for instance data and for API consumers.

## Concept — deliberately staged, earn each stage

**Stage 1 — Change impact visibility (small, do this soon)**
- A read-only `GET /api/model/schema/impact?change=...` style dry-run, or simpler: extend the
  existing validate endpoints to report what a proposed delete/modify would affect — instance
  counts per type, affected scoped ontologies, saved queries referencing the type (execution-time
  validation already exists; make it design-time). Much of the cascade machinery already computes
  this; it only lacks a "tell, don't do" mode.

**Stage 2 — Schema snapshots & diff**
- Persist a snapshot (the export payload) with a label/timestamp on demand; a diff endpoint
  compares two snapshots or snapshot-vs-live. Enables review workflows and honest release notes.
  Storage is trivial (the export format already is the snapshot format).

**Stage 3 — Guided instance migration (only when concretely needed)**
- On breaking schema edits (property rename, type change), generate a migration plan (Cypher
  batch steps) that the user approves and runs. Explicitly **not** an automatic migration engine
  — a generator for reviewable scripts, keeping the human in the loop.

**Format discipline (immediate, costs nothing)**
- One documented current `formatVersion` (fix via F08), a changelog section for format changes,
  and import that either upgrades known older versions or rejects with a precise message.
  Coordinate pending format additions (FT03 `embeddable`, FT05 constraints) into single bumps.

## Dependencies

- Format discipline depends on F08/F09; Stage 1 builds on existing cascade/validation code.
- FT04's round-trip test is the natural regression guard for all of this.
- Stages 2–3 should wait for real external consumers — building them speculatively violates
  YAGNI; *deciding the staging now* prevents building the wrong thing under pressure later.

## Open questions for the user

- Is Stage 1 (impact dry-run) worth pulling forward into the near-term roadmap? It is small and
  immediately useful in the modeling UI (show impact before delete).
