# OntoForge

OntoForge is a graph-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs. Storage sits behind an exchangeable database adapter — Neo4j is the current adapter. The schema (entity types, relation types, properties) is global and independent. Ontologies are named lenses over this schema — either unscoped (full schema access) or scoped to a filtered subset of types and properties. The system provides dedicated REST and MCP interfaces for modeling and runtime, stores schema and data together in one database (Neo4j adapter today) behind a persistence port, and supports JSON-based export and import.

## Project Structure

Monorepo with two main parts:

- **Frontend** — React (npm)
- **Backend** — Python

## Python: uv (NOT pip)

**This project uses [uv](https://docs.astral.sh/uv/) for all Python dependency and environment management.**

- Do NOT use `pip install`, `pip freeze`, or `pip` commands directly.
- Use `uv run` to execute scripts and commands within the project environment.
- Use `uv add` / `uv remove` to manage dependencies.
- Use `uv sync` to install dependencies from the lockfile.
- The virtual environment lives in `.venv/` and is managed by uv automatically.

## Frontend: npm

- Use `npm install`, `npm run`, etc. for frontend tasks.

## Design Principles

- **KISS** — Keep it simple. Prefer the simplest solution that meets the requirement.
- **YAGNI** — You ain't gonna need it. Don't build for hypothetical future requirements.
- **Every architectural decision requires user approval.** Never settle a design or architectural choice silently — always ask the user first. Record the outcome as a rule in [docs/decisions.md](docs/decisions.md). Write a record in [docs/adr/](docs/adr/) **only** when alternatives were seriously weighed and would otherwise be re-proposed later — that record carries the deliberation, never the rule, and links to it. Most decisions need only the rule.

## Documentation Principles

1. **Consistency first.** All docs, code, and architecture must be consistent with each other. If an inconsistency is detected, STOP and ask the user — never silently resolve or ignore it.
2. **Single source of truth.** Each piece of information belongs in exactly one place. Avoid redundancy by default. When a fact is needed elsewhere, reference the source — don't copy it.
3. **Progressive disclosure.** Layer documents from overview to detail. High-level docs link to deeper docs, not duplicate their content.
4. **When redundancy exists, maintain consistency.** Brief summaries referencing detail docs are acceptable. But if two places state the same fact, both must stay in sync. When they diverge, flag it.
5. **Don't document what the code makes obvious.** Reference code by semantic anchors (module names, class names, section names) — never by file:line numbers. Feature docs should weave code references into prose, not be bare reference lists. Avoid code blocks in docs unless needed to illustrate a major pattern.
6. **Respect document lifecycle.** Documents form a directed chain: concepts → architecture → capabilities → code. Later documents may reference earlier ones, never the reverse. Place information where it belongs in this lifecycle.
7. **Status quo only.** `docs/` describes the system as it is. No history, no dates, no "planned", no migration notes, no rejected alternatives — those belong in `docs/adr/`. Unbuilt ideas are not documented at all.
8. **Technology-neutral above the adapter.** Everything in `docs/` except `storage-adapters.md` must hold for a reimplementation in another language. No library names, no file paths, no class or function names.

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

Documentation of a single script stays beside that script (`scripts/USAGE.md`,
`backend/scripts/bench.md`).

## Local Development Setup

```bash
# 1. Start Neo4j
docker compose up -d

# 2. Start the backend (serves both modeling and runtime APIs)
cd backend && uv run uvicorn ontoforge_server.main:app --host 0.0.0.0 --port 8000

# 3. Start the frontend (in a separate terminal)
cd frontend && npm run dev
```

The backend runs on `http://localhost:8000`, the frontend on `http://localhost:5173`.

## Documentation

Start at [docs/README.md](docs/README.md) — concepts, glossary and the map of everything
else. Do not restate its definitions here; this file is about how to *work* in the repo,
not what the system is.

| Need | Read |
|---|---|
| Concepts and vocabulary | [docs/README.md](docs/README.md) |
| How it is put together | [docs/architecture.md](docs/architecture.md) |
| What a capability does and its rules | [docs/capabilities/](docs/capabilities/) |
| Every endpoint and MCP tool | [docs/interfaces.md](docs/interfaces.md) |
| Implementing a storage backend | [docs/storage-adapters.md](docs/storage-adapters.md) |
| What the web client offers | [docs/product-surface.md](docs/product-surface.md) |
| Rules you may not violate | [docs/decisions.md](docs/decisions.md) |
