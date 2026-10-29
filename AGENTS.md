# OntoForge

OntoForge is a graph-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs. Storage sits behind a persistence port with a PostgreSQL adapter. One server holds many ontologies — totally isolated units, each with its own schema (entity types, relation types, properties), its lenses, saved queries, agents, and instance data; nothing spans two. Lenses are named views over one ontology's schema — either unscoped (full schema access) or scoped to a filtered subset of types and properties. The system provides a registry for managing ontologies plus dedicated, ontology-scoped REST and MCP interfaces for modeling and runtime, stores ontology schema and data together in one ontology database behind a persistence port, and supports JSON-based export and import of one ontology's design. When authentication is on, a separate access database stores principals and assignments.

## Project Structure

`frontend/` and `server/` are independent npm projects — there is no workspace root.

## Design Principles

Before changing system behavior, read [Architectural constraints](docs/architecture-constraints.md)
and the relevant capability and interface sections. The constraints are the common
architectural starting point; detailed feature rules stay with their owners.

- **KISS** — Keep it simple. Prefer the simplest solution that meets the requirement.
- **YAGNI** — You ain't gonna need it. Don't build for hypothetical future requirements.
- **Every architectural decision requires user approval.** Never settle a design or architectural choice silently — always ask the user first. Record it as [docs/workflows/recording-decisions.md](docs/workflows/recording-decisions.md) describes.

## Documentation Principles

1. **Consistency first.** Docs, code, and architecture must agree. When they disagree, investigate against the implementation and tests first, and fix what is clearly wrong. Ask the user only when the correct behavior or a design choice stays unclear; never settle a design disagreement silently.
2. **Single source of truth.** Each fact has exactly one home, given by the structure in [docs/AGENTS.md](docs/AGENTS.md). Elsewhere, name the concept and link to its home — don't copy it.

The remaining principles for writing under `docs/` — progressive disclosure, one home per
fact, the right level, linking, status quo only, ontology storage neutrality — live in
[docs/AGENTS.md](docs/AGENTS.md). Read it before writing under `docs/`.

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
- **Recording decisions** — [docs/workflows/recording-decisions.md](docs/workflows/recording-decisions.md): where an approved decision is written down, when it gets an ADR, and the ADR format.
- **Writing documentation** — [docs/workflows/documenting.md](docs/workflows/documenting.md): choose an owner and document type, preserve moved information, and review the result. Read it before adding or reorganizing documentation.
- **Writing tool descriptions** — [docs/workflows/writing-tool-descriptions.md](docs/workflows/writing-tool-descriptions.md): self-contained parameter rules, caller-facing scope, description budget and checks for MCP and agent tools.
- **Naming concepts and keys** — [docs/workflows/naming.md](docs/workflows/naming.md): consistent domain vocabulary and shared key rules across entrances.
- **Development fixtures** — [fixtures/README.md](fixtures/README.md): load, save and unload known ontologies (schema + data) on a running server.

Documentation of a single script stays beside that script (`scripts/USAGE.md`).

## Local Development Setup

Start PostgreSQL and Valkey (`docker compose up -d`) before running `npm run dev` in `server/` and
`frontend/`. The backend runs on `http://localhost:8000`. `./dev.sh [env-file]` does all
three at once, starting Valkey only when the env file uses it. `./dev.sh scale` runs two
backends sharing one database and one Valkey ([scripts/scale/USAGE.md](scripts/scale/USAGE.md)).

Configuration comes from exactly one env file — the one `ENV_FILE` names, otherwise
`server/.env`. Presets live in `env/`. A variable already set in the shell wins over the
file; a named file that is missing fails the boot.

## Documentation

Start at [docs/README.md](docs/README.md) for reading paths and the documentation map.
The [concepts](docs/concepts.md) explain the mental model; the [glossary](docs/glossary.md)
defines the vocabulary.

| Need | Read |
|---|---|
| Concepts and vocabulary | [Concepts](docs/concepts.md) and [glossary](docs/glossary.md) |
| Essential architectural constraints | [docs/architecture-constraints.md](docs/architecture-constraints.md) |
| How it is put together | [docs/architecture.md](docs/architecture.md) |
| What a capability does and its rules | [docs/capabilities/](docs/capabilities/) |
| Every endpoint and MCP tool | [docs/interfaces/](docs/interfaces/README.md) |
| Implementing a storage backend | [docs/storage-adapters/](docs/storage-adapters/README.md) |
| What the web client offers | [docs/product-surface.md](docs/product-surface.md) |

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`, gitignored. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context; glossary and decision records live in the existing `docs/` tree. See [docs/agents/domain.md](docs/agents/domain.md).
