# OntoForge Setup Plugin

A Claude Code plugin that helps bootstrap OntoForge in any project. It generates the Docker Compose, environment variables, and MCP configuration needed to get OntoForge running.

## What It Does

When invoked, the skill interactively gathers requirements and generates:

1. **`docker-compose.yml`** — Neo4j, OntoForge server, and OntoForge UI, with optional Ollama for local embeddings.
2. **`.mcp.json`** — Claude Code MCP configuration pointing to the OntoForge modeling and runtime servers.
3. **`.env`** (optional) — Environment variables for secrets and local overrides.

The skill uses bundled templates as starting points and adapts them based on user input. It never invents environment variables — only the ones recognized by OntoForge are used.

## Installation

From a repository that has the OntoForge marketplace configured:

```bash
claude plugin install ontoforge-setup
```

## Templates

The plugin ships two templates under `skills/ontoforge-setup/templates/`:

| Template | Purpose |
|---|---|
| `docker-compose.yml` | Full OntoForge stack (Neo4j + server + UI) with commented embedding and Ollama config |
| `mcp.json` | MCP server entries for modeling and runtime |

These templates reflect the container images published at `ghcr.io/rawe/ontoforge-server` and `ghcr.io/rawe/ontoforge-ui`.

## Environment Variables

The skill only uses variables that OntoForge actually reads. See the full reference in the [SKILL.md](skills/ontoforge-setup/SKILL.md#ontoforge-server-environment-variables).

Key groups:

- **Database** — `DB_URI`, `DB_USER`, `DB_PASSWORD`
- **Embedding** — `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS`
- **MCP** — `DEFAULT_MCP_ONTOLOGY_KEY`
- **Server** — `PORT`

## Embedding Providers

OntoForge supports two embedding providers for semantic search:

- **Ollama** (`EMBEDDING_PROVIDER=ollama`) — runs locally, default model `nomic-embed-text` (768 dimensions). Can run on the host or as a Docker container.
- **OpenAI-compatible** (`EMBEDDING_PROVIDER=openai`) — works with OpenAI, Azure OpenAI, vLLM, LM Studio. Requires `EMBEDDING_API_KEY`. Default 1536 dimensions.

Omit `EMBEDDING_PROVIDER` entirely to disable semantic search.

## Related Plugins

- **ontoforge** — Export and import ontology schemas. Use after setup to manage schemas as JSON files.
