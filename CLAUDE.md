# OntoForge

OntoForge is a graph-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs. Storage sits behind an exchangeable database adapter. The schema (entity types, relation types, properties) is global and independent. Ontologies are named lenses over this schema — either unscoped (full schema access) or scoped to a filtered subset of types and properties. The system provides dedicated REST and MCP interfaces for modeling and runtime, stores schema and data together in one database behind a persistence port, and supports JSON-based export and import.

## Project Structure

`frontend/` and `server/` are independent npm projects — there is no workspace root.

## Design Principles

- **KISS** — Keep it simple. Prefer the simplest solution that meets the requirement.
- **YAGNI** — You ain't gonna need it. Don't build for hypothetical future requirements.
- **Every architectural decision requires user approval.** Never settle a design or architectural choice silently — always ask the user first. Record the outcome as a rule in [docs/decisions.md](docs/decisions.md). Write a record in [docs/adr/](docs/adr/) **only** when alternatives were seriously weighed and would otherwise be re-proposed later — that record carries the deliberation, never the rule, and links to it. Most decisions need only the rule.

## Documentation Principles

1. **Consistency first.** All docs, code, and architecture must be consistent with each other. If an inconsistency is detected, STOP and ask the user — never silently resolve or ignore it.
2. **Single source of truth.** Each piece of information belongs in exactly one place. Avoid redundancy by default. When a fact is needed elsewhere, reference the source — don't copy it.

The remaining principles for writing under `docs/` — progressive disclosure, redundancy,
document lifecycle, status quo only, technology neutrality — live in
[docs/CLAUDE.md](docs/CLAUDE.md), which loads when working there.

## Git Commits

- Do NOT add `Co-Authored-By` lines mentioning Claude or any AI model.
- Do NOT reference the AI model in commit messages.
- Write commit messages as if authored solely by the developer.

## Workflows

Procedures live in [docs/workflows/](docs/workflows/) — they are instructions to follow,
not documentation of the system.

- **Testing** — [docs/workflows/testing.md](docs/workflows/testing.md): running unit and integration tests, prerequisites, conventions.
- **Multi-agent test-and-fix cycles** — [docs/workflows/test-cycle.md](docs/workflows/test-cycle.md): agent roles, execution flow, fresh-state protocol, handover formats.
- **Releasing** — [docs/workflows/releasing.md](docs/workflows/releasing.md). Read it before tagging a release.

Documentation of a single script stays beside that script (`scripts/USAGE.md`).

## Local Development Setup

Start Neo4j (`docker compose up -d`) before running `npm run dev` in `server/` and
`frontend/`. The backend runs on `http://localhost:8000`.

## Documentation

Start at [docs/README.md](docs/README.md) for the full picture — concepts, glossary and
the map of everything else.

| Need | Read |
|---|---|
| Concepts and vocabulary | [docs/README.md](docs/README.md) |
| How it is put together | [docs/architecture.md](docs/architecture.md) |
| What a capability does and its rules | [docs/capabilities/](docs/capabilities/) |
| Every endpoint and MCP tool | [docs/interfaces.md](docs/interfaces.md) |
| Implementing a storage backend | [docs/storage-adapters.md](docs/storage-adapters.md) |
| What the web client offers | [docs/product-surface.md](docs/product-surface.md) |
| Rules you may not violate | [docs/decisions.md](docs/decisions.md) |
