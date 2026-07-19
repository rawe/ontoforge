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
- **Every architectural decision requires user approval.** Never settle a design or architectural choice silently — always ask the user first.

## Documentation Principles

1. **Consistency first.** All docs, code, and architecture must be consistent with each other. If an inconsistency is detected, STOP and ask the user — never silently resolve or ignore it.
2. **Single source of truth.** Each piece of information belongs in exactly one place. Avoid redundancy by default. When a fact is needed elsewhere, reference the source — don't copy it.
3. **Progressive disclosure.** Layer documents from overview to detail. High-level docs link to deeper docs, not duplicate their content.
4. **When redundancy exists, maintain consistency.** Brief summaries referencing detail docs are acceptable. But if two places state the same fact, both must stay in sync. When they diverge, flag it.
5. **Don't document what the code makes obvious.** Reference code by semantic anchors (module names, class names, section names) — never by file:line numbers. Feature docs should weave code references into prose, not be bare reference lists. Avoid code blocks in docs unless needed to illustrate a major pattern.
6. **Respect document lifecycle.** Documents form a directed chain: PRD → Architecture → Code. Later documents may reference earlier ones, never the reverse. Place information where it belongs in this lifecycle.

## Git Commits

- Do NOT add `Co-Authored-By` lines mentioning Claude or any AI model.
- Do NOT reference the AI model in commit messages.
- Write commit messages as if authored solely by the developer.

## Testing with Agent Teams

When running multi-agent test-and-bugfix cycles, follow the strategy in [docs/testing-strategy.md](docs/testing-strategy.md). It defines agent roles (tester, dev, team lead), sequential execution flow, fresh-state protocol, handover formats, and test plans for backend and frontend.

## Releasing

Before tagging a release, read [docs/releasing.md](docs/releasing.md).

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

## Key Concepts

- **Schema** — the global set of entity types, relation types, and property definitions. The ground truth, independent of any ontology.
- **Ontology** — a named lens over the schema. Unscoped ontologies expose everything; scoped ontologies filter to specific types and properties via `INCLUDES_TYPE` edges.
- **Modeling mode** — designing and managing the global schema and ontology scopes
- **Runtime mode** — querying and mutating knowledge data through an ontology lens
- **REST API** — HTTP interface for both modeling and runtime operations
- **MCP interface** — Model Context Protocol server for AI-driven interactions
- **OQL** — the OntoForge Query Language: the read-only, openCypher-shaped graph pattern language (anchored to ISO GQL/GPML) used by the query endpoint, saved queries, and AI query generation
- **Persistence port** — all database access goes through `core/ports.py`; Neo4j is the current adapter (`adapters/neo4j/`)
