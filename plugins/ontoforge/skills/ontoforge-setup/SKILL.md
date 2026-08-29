---
name: ontoforge-setup
description: "Bootstrap a project with OntoForge. Use when the user wants to set up OntoForge in a new or existing project — Docker Compose, environment variables, and MCP configuration."
---

# Goal

Help the user set up OntoForge in their project by generating the necessary configuration files: Docker Compose for PostgreSQL and OntoForge services, environment variables, and `.mcp.json` for MCP integration.

This skill uses **templates** shipped with the plugin. Never invent environment variable names — only use the variables documented below.

## Stack

The Docker Compose stack consists of three core services:

- **postgres** — PostgreSQL database (with pgvector) used by the default storage adapter. Stores both schema and instance data.
- **ontoforge-server** — Backend: REST API and MCP servers. All environment variables documented below apply to this service.
- **ontoforge-ui** — Frontend: web UI served on port 3000. Requires `BACKEND_URL` pointing to the backend's Docker-internal URL so nginx can proxy `/api` and `/mcp` requests.

Semantic search is optional and supports two embedding providers: **Ollama** (local) or an **OpenAI-compatible** API. AI-powered runtime (natural language query, entity extraction, chat) is also optional and requires a model with tool calling support. Both features can use Ollama or an OpenAI-compatible API. When using Ollama, an optional **ollama** service can be added to the compose stack.

## Templates

The following templates are bundled with this plugin:

- **Docker Compose**: `templates/docker-compose.yml`
- **MCP configuration**: `templates/mcp.json`

Read these templates as the starting point. Adapt them to the user's needs and write the result into the user's project.

## Workflow

### 1. Gather Requirements

Ask the user:

1. **Lens key** — the name/key for their lens (e.g. `my_lens`). Used in the MCP runtime `X-Lens-Key` header and optionally as `DEFAULT_MCP_LENS_KEY`.
2. **Embedding provider** — whether they want semantic search enabled, and if so which provider:
   - `ollama` — local Ollama instance (default model: `nomic-embed-text`)
   - `openai` — OpenAI-compatible API (requires API key)
   - None — skip embedding configuration
3. **AI provider** — whether they want AI-powered runtime (NL query, entity extraction, chat), and if so which provider:
   - `ollama` — local Ollama instance (default model: `qwen3:8b`; recommended: `qwen3:14b` or `qwen3:32b` for better quality)
   - `openai` — OpenAI-compatible API (requires API key)
   - None — skip AI configuration
4. **Ollama deployment** (if ollama chosen for embeddings or AI) — whether Ollama runs on the host machine or should be added as a Docker container in the compose file.
5. **Database password** — the password for the PostgreSQL database (default: `changeme`).
6. **Port conflicts** — whether the default ports (5432, 8000, 3000) conflict with other services.

### 2. Generate Docker Compose

Read the template from `templates/docker-compose.yml` and adapt it based on the user's answers:

- Set the database password in `POSTGRES_PASSWORD` and `DB_PASSWORD`.
- If the user wants embeddings, uncomment and configure the `EMBEDDING_*` environment variables on the `ontoforge-server` service.
- If the user wants Ollama in Docker, uncomment the `ollama` service.
- If the user wants Ollama on the host (common setup), set `EMBEDDING_BASE_URL` and/or `AI_BASE_URL` to `http://host.docker.internal:11434` (Docker connects to the host's Ollama). The `ollama` service in the compose file is not needed in this case.
- If the user chose `openai`, set `EMBEDDING_PROVIDER: openai` and note that `EMBEDDING_API_KEY` must be provided (do not write a real key into the file).
- If the user wants AI, uncomment and configure the `AI_*` environment variables on the `ontoforge-server` service. The same Ollama/host/Docker/OpenAI logic applies as for embeddings.
- If the user chose `openai` for AI, set `AI_PROVIDER: openai` and note that `AI_API_KEY` must be provided (do not write a real key into the file).
- Adjust port mappings if the user reported conflicts.
- If the backend service is renamed, update `BACKEND_URL` on the `ontoforge-ui` service to match (e.g. `http://<new-service-name>:8000`).
- `DEFAULT_MCP_LENS_KEY` is a server-side fallback: if an MCP request arrives without an `X-Lens-Key` header or a URL path key, the server uses this value. Uncomment it in the Docker Compose if the user wants a fallback; the primary mechanism is the `X-Lens-Key` header set in `.mcp.json`.

Write the result as `docker-compose.yml` (or `docker-compose.ontoforge.yml` if the user already has a compose file) in the project root.

### 3. Generate MCP Configuration

Read the template from `templates/mcp.json` and adapt it:

- Replace `my_lens` in the `X-Lens-Key` header with the user's lens key.
- Adjust the host/port if the user changed defaults.

Write the result as `.mcp.json` in the project root. If a `.mcp.json` already exists, merge the `mcpServers` entries into it — do not overwrite existing servers.

### 4. Generate .env (optional)

If the user needs a `.env` file for local (non-Docker) development or to store secrets like `EMBEDDING_API_KEY`, generate one. Use this as a reference for the variable names and defaults:

```env
# PostgreSQL connection (the DSN carries host, port and database)
DB_URI=postgresql://localhost:5432/ontoforge
DB_USER=postgres
DB_PASSWORD=changeme

# Semantic search (optional — omit EMBEDDING_PROVIDER to disable)
# EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL=nomic-embed-text
# EMBEDDING_BASE_URL=http://localhost:11434
# EMBEDDING_API_KEY=
# EMBEDDING_DIMENSIONS=

# AI-powered runtime (optional — omit AI_PROVIDER to disable)
# AI_PROVIDER=ollama
# AI_MODEL=qwen3:8b
# AI_BASE_URL=http://localhost:11434
# AI_API_KEY=
# AI_REASONING_EFFORT=

# MCP default lens key (optional)
# DEFAULT_MCP_LENS_KEY=my_lens
```

Add `.env` to `.gitignore` if not already there.

## OntoForge UI Environment Variable

The `ontoforge-ui` container runs nginx, which proxies `/api` and `/mcp` requests to the backend. The backend URL must be set via an environment variable so nginx knows where to forward these requests.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BACKEND_URL` | yes | `http://localhost:8000` | Docker-internal URL of the `ontoforge-server` service. Must match the backend service name in the compose file (e.g. `http://ontoforge-server:8000`). |

If the user renames the backend service in Docker Compose, update `BACKEND_URL` on the UI service accordingly.

## OntoForge Server Environment Variables

These are the **only** environment variables recognized by the `ontoforge-server` service. Do not invent others.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_BACKEND` | no | `postgres` | Storage adapter selection (`postgres` or `neo4j`) |
| `DB_URI` | yes | `postgresql://localhost:5432/ontoforge` | PostgreSQL connection DSN (carries host, port and database) |
| `DB_USER` | yes | `postgres` | Database username |
| `DB_PASSWORD` | yes | `ontoforge_dev` | Database password |
| `PORT` | no | `8000` | HTTP server port |
| `EMBEDDING_PROVIDER` | no | *(disabled)* | `ollama` or `openai` — omit to disable semantic search |
| `EMBEDDING_MODEL` | no | `nomic-embed-text` | Embedding model name |
| `EMBEDDING_BASE_URL` | no | `http://localhost:11434` | Embedding provider API base URL |
| `EMBEDDING_API_KEY` | no | *(none)* | API key — **required** when `EMBEDDING_PROVIDER=openai` |
| `EMBEDDING_DIMENSIONS` | no | *(auto)* | Vector dimensions (defaults: ollama=768, openai=1536) |
| `AI_PROVIDER` | no | *(disabled)* | `ollama` or `openai` — omit to disable AI features |
| `AI_MODEL` | no | `qwen3:8b` | AI model name (must support tool calling) |
| `AI_BASE_URL` | no | `http://localhost:11434` | AI provider API base URL |
| `AI_API_KEY` | no | *(none)* | API key — **required** when `AI_PROVIDER=openai` |
| `AI_REASONING_EFFORT` | no | *(model default)* | `none`, `low`, `medium` or `high` — how hard the model thinks |
| `DEFAULT_MCP_LENS_KEY` | no | *(none)* | Fallback lens key for MCP when not in URL/header |

## Container Images

| Image | Description |
|---|---|
| `pgvector/pgvector:0.8.6-pg18-trixie` | PostgreSQL 18 with pgvector |
| `ghcr.io/rawe/ontoforge-server:latest` | OntoForge backend (REST API + MCP) |
| `ghcr.io/rawe/ontoforge-ui:latest` | OntoForge frontend |
| `ollama/ollama:latest` | Ollama (optional, for local embeddings and AI) |

## MCP Endpoints

OntoForge exposes two MCP servers:

- **Modeling**: `http://<host>:8000/mcp/model` — schema design (entity types, relation types, properties, ontologies)
- **Runtime**: `http://<host>:8000/mcp/runtime` — data operations through a lens. The lens key is provided via the `X-Lens-Key` HTTP header.

## Post-Setup Checklist

After generating the files, remind the user:

1. Run `docker compose up -d` to start the services.
2. Wait for PostgreSQL to become healthy (check `docker compose ps`).
3. Access the OntoForge UI at `http://localhost:3000`.
4. Access the API at `http://localhost:8000`.
5. If using Ollama in Docker, pull the required models:
   - For semantic search: `docker exec <container> ollama pull nomic-embed-text`
   - For AI features: `docker exec <container> ollama pull qwen3:8b` (or whichever model was configured)
6. Use the **ontoforge-sync** skill (also part of this plugin) for schema and data import/export.
