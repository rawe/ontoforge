# OntoForge Plugin

A plugin for AI coding assistants (Claude Code and OpenAI Codex) that provides OntoForge skills for ontology schema management and project setup.

## Skills

### ontoforge

Export and import OntoForge ontology schemas via the Modeling REST API.

- **Export**: save an ontology schema to a JSON file for version control
- **Import**: load a schema from a JSON file, replacing any existing schema with the same ID

### ontoforge-setup

Bootstrap a project with OntoForge: Docker Compose, environment variables, and MCP configuration.

When invoked, the skill interactively gathers requirements and generates:

1. **`docker-compose.yml`** — Neo4j, OntoForge server, and OntoForge UI, with optional Ollama for local embeddings.
2. **`.mcp.json`** — Claude Code MCP configuration pointing to the OntoForge modeling and runtime servers.
3. **`.env`** (optional) — Environment variables for secrets and local overrides.

The skill uses bundled templates as starting points and adapts them based on user input. It never invents environment variables — only the ones recognized by OntoForge are used.

### ontoforge-runtime-api

Help an agent build `curl` calls, clients, and integrations against the OntoForge runtime REST API. The skill stays runtime-only and points to the existing endpoint contract and usage guide instead of duplicating the API docs.

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
| `docker-compose.yml` | Full OntoForge stack (Neo4j + server + UI) with commented embedding and Ollama config |
| `mcp.json` | MCP server entries for modeling and runtime |

## Environment Variables

The setup skill only uses variables that OntoForge actually reads. See the full reference in the [SKILL.md](skills/ontoforge-setup/SKILL.md#ontoforge-server-environment-variables).

## Embedding Providers

OntoForge supports two embedding providers for semantic search:

- **Ollama** (`EMBEDDING_PROVIDER=ollama`) — local, no API key needed. Default model: `nomic-embed-text`. Default 768 dimensions.
- **OpenAI-compatible** (`EMBEDDING_PROVIDER=openai`) — works with OpenAI, Azure OpenAI, vLLM, LM Studio. Requires `EMBEDDING_API_KEY`. Default 1536 dimensions.

Omit `EMBEDDING_PROVIDER` entirely to disable semantic search.
