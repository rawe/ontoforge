# FT04 — Complete Data Portability (Instance Export/Import)

> **Type: Feature concept** · **Effort: Medium** · **Priority: Medium — finishes a started story**
> Completes the work designed in `scripts/IMPORT_NOTES.md` and listed as "To Do" in
> `docs/feature-ideas/skill-and-marketplace.md`.

## Problem

The PRD promises portability ("schema and data must be self-contained", backup, initialization of
new installations). Today only half exists:

- **Schema**: full export/import via `/api/model/export|import` — done.
- **Instance data**: export exists as a standalone script (`scripts/export_ontology.py`), import
  is *designed* (`IMPORT_NOTES.md` two-pass strategy) but **not implemented**.

So a round-trip — backup an installation, restore it elsewhere — is not possible. For a tool that
positions itself as the schema-enforced persistence layer of other applications, backup/restore
is a baseline expectation, and it is also the missing piece for "initialization of new
installations" (seed data, demo datasets, test fixtures for the agent-team testing strategy).

## Concept

1. **Implement the data import script** exactly as designed in `IMPORT_NOTES.md` (entities first,
   relations second, resolved by type + file reference), as a PEP 723 script beside the exporter,
   wired into the `ontoforge-sync` skill.
2. **Decide the API question deliberately**: scripts pump data through the runtime REST API
   entity-by-entity, which is correct-by-construction (full validation) but slow for large
   graphs. Recommended stance for now: stay with API-driven import (KISS, validation guaranteed),
   and only consider a server-side bulk endpoint when a real dataset makes the cost concrete.
3. **Round-trip test**: an integration test that exports the test fixture ontology + data,
   imports into a clean database, re-exports, and diffs. This test is the durable definition of
   "portability works" and guards the export format against accidental breakage (supports FT06).

## Explicitly not in scope

Instance-data migration on schema change (that is FT06 territory), incremental sync, conflict
resolution. Import targets an empty-or-disjoint database; ID collision handling is
reject-and-report.

## Dependencies

- Format stability from the doc consolidation (F08 fixes the documented `formatVersion`).
- Independent of FT01–FT03; pairs naturally with FT06 (versioning) later.

## Open questions for the user

- Should instance export/import remain **script/skill-level** (current direction, recommended)
  or become first-class REST endpoints? The IMPORT_NOTES design assumes scripts; endpoints would
  be a scope expansion worth its own decision.
