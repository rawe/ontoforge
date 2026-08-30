# OntoForge Plugin

A plugin for AI coding assistants (Claude Code and OpenAI Codex) that provides OntoForge skills for ontology schema management and project setup.

## Ontologies and lenses

One OntoForge server holds many **ontologies** — isolated units, each with its own schema, lenses, saved queries, agents and instance data. Nothing spans two. A **lens** is a named view over one ontology's schema; instance data is read and written through one.

Every skill here works against one ontology at a time, and every skill that touches instance data also names a lens. Neither has a default, so both are explicit inputs — a flag or an environment variable for `ontoforge-sync`, `okf.config.json` for `ontoforge-okf`, and the mount URL for the MCP servers `ontoforge-setup` configures.

## Skills

### ontoforge-sync

Export and import one ontology's design and instance data via the REST API.

- **Design export/import**: save and restore one ontology's schema, lenses, agents and saved queries as JSON, in the server's own transfer format
- **Data export/import**: save and restore instance data (entities, relations) with automatic ID remapping — this is the only instance-data export there is, since the transfer format carries the design alone
- **Embedding rebuild**: regenerate one ontology's semantic-search vectors, with streamed progress
- Resolves the ontology key from `--ontology` or `ONTOFORGE_ONTOLOGY`, and stops with a clear message when neither is set
- Uses Node.js 18+ with built-in `fetch` — no external dependencies

### ontoforge-okf

Sync Markdown documents with YAML frontmatter (Google's [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)) with OntoForge entities — one file, one entity.

- **Push**: `okf-push.mjs <file.md>` turns a concept document into an entity — frontmatter keys become scalar properties, the Markdown body becomes the `document` property, the file path becomes the concept ID (natural key). Idempotent: re-pushing updates instead of duplicating.
- **Pull**: `okf-pull.mjs <conceptId>` writes an entity back to `<conceptId>.md` with deterministic frontmatter ordering for clean git diffs.
- Document content moves filesystem ↔ API directly, never through an LLM context — use it alongside the MCP tools, not instead of them.
- `okf.config.json` at the bundle root carries the per-bundle state: the ontology key, the lens key, the type mapping and the list-property handling. Only the server URL stays per-developer, in `ONTOFORGE_BASE_URL`.

See [SKILL.md](skills/ontoforge-okf/SKILL.md) for the full usage reference, schema requirements, and the supported YAML subset.

### ontoforge-setup

Bootstrap a project with OntoForge: Docker Compose, environment variables, and MCP configuration.

When invoked, the skill interactively gathers requirements and generates:

1. **`docker-compose.yml`** — PostgreSQL (the database used by OntoForge's default storage adapter), OntoForge server, and OntoForge UI, with optional Ollama for local embeddings.
2. **`.mcp.json`** — Claude Code MCP configuration pointing to the OntoForge modeling and runtime servers.
3. **`.env`** (optional) — Environment variables for secrets and local overrides.

The skill uses bundled templates as starting points and adapts them based on user input. It never invents environment variables — only the ones recognized by OntoForge are used.

### ontoforge-runtime-api

Help an agent build `curl` calls, clients, and integrations against the OntoForge runtime REST API under `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`. The skill stays runtime-only — it covers neither the modeling surface nor the ontology registry — and bundles a reference covering the endpoint contract, the filter and projection syntax, the error envelope, and what the surface deliberately does not offer.

## Installation

### Claude Code

From a repository that has the OntoForge marketplace configured:

```bash
claude plugin install ontoforge
```

### OpenAI Codex

Load the plugin directory directly:

```
plugins/ontoforge/
```

## Templates

The plugin ships two templates under `skills/ontoforge-setup/templates/`:

| File | Contents |
| --- | --- |
| `docker-compose.yml` | Full OntoForge stack (PostgreSQL + server + UI) with commented embedding and Ollama config |
| `mcp.json` | MCP server entries for modeling and runtime |

## Environment Variables

The setup skill only uses variables that OntoForge actually reads. See the full reference in the [SKILL.md](skills/ontoforge-setup/SKILL.md#ontoforge-server-environment-variables).

## Embedding Providers

OntoForge supports two embedding providers for semantic search:

- **Ollama** (`EMBEDDING_PROVIDER=ollama`) — local, no API key needed. Default model: `nomic-embed-text`. Default 768 dimensions.
- **OpenAI-compatible** (`EMBEDDING_PROVIDER=openai`) — works with OpenAI, Azure OpenAI, vLLM, LM Studio. Requires `EMBEDDING_API_KEY`. Default 1536 dimensions.

Omit `EMBEDDING_PROVIDER` entirely to disable semantic search.
