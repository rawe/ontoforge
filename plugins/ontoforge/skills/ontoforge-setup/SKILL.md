---
name: ontoforge-setup
description: "Set up a project to work with OntoForge, either by running OntoForge locally with Docker Compose or by connecting to a remote OntoForge server at a given base URL, with or without authentication enabled. Generates Docker Compose, environment variables and MCP configuration."
---

# Goal

Set up the user's project to work with OntoForge, in one of two modes:

- **Local** — run OntoForge on this machine with Docker Compose. Generates
  `docker-compose.yml`, an optional `.env` for the server, and `.mcp.json`.
- **Remote** — use an OntoForge server that already runs elsewhere, at a base URL the user
  is given. Generates `.mcp.json` only; nothing is deployed.

Both modes end in the same client configuration, so every other skill of this plugin
works the same afterwards. How clients find the server and the token is the plugin's
[connection contract](../../CONNECTION.md).

This skill uses **templates** shipped with the plugin. Never invent environment variable
names — only use the variables documented here and in the connection contract.

## Choose the mode

Ask first: **run OntoForge locally, or connect to an existing server?** A base URL the
user mentions, or a server someone else runs, means remote. Then ask, for both modes:

- **Ontology key and lens key** — the ontology the project binds to (e.g. `my_ontology`)
  and the lens for runtime data operations (e.g. `my_lens`). Both are path segments of
  the MCP mount URLs — the URL is the only binding channel.

## Templates

- **Docker Compose** (local mode): `templates/docker-compose.yml`
- **MCP configuration** (both modes): `templates/mcp.json`

Read these templates as the starting point. Adapt them to the user's needs and write the
result into the user's project.

## Local mode

### Stack

The Docker Compose stack consists of three core services:

- **postgres** — PostgreSQL database (with pgvector) used by the default storage adapter. Stores both schema and instance data.
- **ontoforge-server** — Backend: REST API and MCP servers. All environment variables documented below apply to this service.
- **ontoforge-ui** — Frontend: web UI served on port 3000. Requires `BACKEND_URL` pointing to the backend's Docker-internal URL so nginx can proxy `/api` and `/mcp` requests.

Semantic search is optional and supports two embedding providers: **Ollama** (local) or an **OpenAI-compatible** API. AI-powered runtime (assistants: chat with agents, retrievers and navigators) is also optional and requires a model with tool calling support. Both features can use Ollama or an OpenAI-compatible API; AI-powered runtime can also use Anthropic's API. When using Ollama, an optional **ollama** service can be added to the compose stack.


### 1. Gather Requirements

Ask the user:

1. **Embedding provider** — whether they want semantic search enabled, and if so which provider:
   - `ollama` — local Ollama instance (default model: `bge-m3`)
   - `openai` — OpenAI-compatible API (requires API key)
   - None — skip embedding configuration
2. **AI provider** — whether they want AI-powered runtime (assistants), and if so which provider:
   - `ollama` — local Ollama instance (ask which model; suggest `qwen3:8b`, or `qwen3:14b` / `qwen3:32b` for better quality)
   - `openai` — OpenAI-compatible API (requires API key)
   - `anthropic` — Claude models through Anthropic's API (requires API key; `AI_BASE_URL` can stay unset)
   - None — skip AI configuration
3. **Ollama deployment** (if ollama chosen for embeddings or AI) — whether Ollama runs on the host machine or should be added as a Docker container in the compose file.
4. **Database password** — the password for the PostgreSQL database (default: `changeme`).
5. **Port conflicts** — whether the default ports (5432, 8000, 3000) conflict with other services.

### 2. Generate Docker Compose

Read the template from `templates/docker-compose.yml` and adapt it based on the user's answers:

- Set the database password in `POSTGRES_PASSWORD` and `DB_PASSWORD`.
- If the user wants embeddings, uncomment and configure the `EMBEDDING_*` environment variables on the `ontoforge-server` service.
- If the user wants Ollama in Docker, uncomment the `ollama` service.
- If the user wants Ollama on the host (common setup), set `EMBEDDING_BASE_URL` and/or `AI_BASE_URL` to `http://host.docker.internal:11434` (Docker connects to the host's Ollama). The `ollama` service in the compose file is not needed in this case.
- If the user chose `openai`, set `EMBEDDING_PROVIDER: openai`, set `EMBEDDING_BASE_URL` to the provider's API base exactly as the provider documents it — including its version, e.g. `https://api.openai.com/v1` (the default) or `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` — and note that `EMBEDDING_API_KEY` must be provided (do not write a real key into the file). A base URL without its version stops the server at startup.
- If the user wants AI, uncomment and configure the `AI_*` environment variables on the `ontoforge-server` service, always with the `AI_MODEL` the user chose — it has no default, and the server will not start without it. The same Ollama/host/Docker/OpenAI logic applies as for embeddings.
- If the user chose `openai` for AI, set `AI_PROVIDER: openai` and `AI_BASE_URL` to the API base including its version (e.g. `https://openrouter.ai/api/v1`), and note that `AI_API_KEY` must be provided (do not write a real key into the file).
- Adjust port mappings if the user reported conflicts.
- If the backend service is renamed, update `BACKEND_URL` on the `ontoforge-ui` service to match (e.g. `http://<new-service-name>:8000`).

Write the result as `docker-compose.yml` (or `docker-compose.ontoforge.yml` if the user already has a compose file) in the project root.

### 3. Generate .env (optional)

If the user needs a `.env` file for local (non-Docker) development or to store secrets like `EMBEDDING_API_KEY`, generate one. Use this as a reference for the variable names and defaults:

```env
# PostgreSQL connection (the DSN carries host, port and database)
DB_URI=postgresql://localhost:5432/ontoforge
DB_USER=postgres
DB_PASSWORD=changeme

# Semantic search (optional — omit EMBEDDING_PROVIDER to disable)
# EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL=bge-m3
# EMBEDDING_BASE_URL=http://localhost:11434
# EMBEDDING_API_KEY=
# EMBEDDING_DIMENSIONS=1024
# EMBEDDING_BATCH_SIZE=1
# EMBEDDING_CONCURRENCY=1

# AI-powered runtime (optional — omit AI_PROVIDER to disable)
# AI_PROVIDER=ollama
# AI_MODEL=qwen3:8b
# AI_BASE_URL=http://localhost:11434
# AI_API_KEY=
# AI_REASONING_EFFORT=
```

Add `.env` to `.gitignore` if not already there.

### 4. Post-Setup Checklist

After generating the files, remind the user:

1. Run `docker compose up -d` to start the services.
2. Wait for PostgreSQL to become healthy (check `docker compose ps`).
3. Access the OntoForge UI at `http://localhost:3000`.
4. Access the API at `http://localhost:8000` — the plugin's default server, so no `ONTOFORGE_BASE_URL` is needed.
5. If using Ollama in Docker, pull the required models:
   - For semantic search: `docker exec <container> ollama pull bge-m3`
   - For AI features: `docker exec <container> ollama pull qwen3:8b` (or whichever model was configured)
6. Use the **ontoforge-sync** skill (also part of this plugin) for schema and data import/export.

Then continue with **MCP Configuration** below.

### OntoForge UI Environment Variable

The `ontoforge-ui` container runs nginx, which proxies `/api` and `/mcp` requests to the backend. The backend URL must be set via an environment variable so nginx knows where to forward these requests.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BACKEND_URL` | yes | `http://localhost:8000` | Docker-internal URL of the `ontoforge-server` service. Must match the backend service name in the compose file (e.g. `http://ontoforge-server:8000`). |

If the user renames the backend service in Docker Compose, update `BACKEND_URL` on the UI service accordingly.

### OntoForge Server Environment Variables

These are the **only** environment variables recognized by the `ontoforge-server` service. Do not invent others. They configure the server itself; the variables the plugin's clients read (`ONTOFORGE_BASE_URL`, `ONTOFORGE_API_TOKEN`, `ONTOFORGE_ENV_FILE`) are a separate set, described in [CONNECTION.md](../../CONNECTION.md).

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_BACKEND` | no | `postgres` | Storage adapter selection (`postgres`, the only adapter) |
| `DB_URI` | yes | `postgresql://localhost:5432/ontoforge` | PostgreSQL connection DSN (carries host, port and database) |
| `DB_USER` | yes | `postgres` | Database username |
| `DB_PASSWORD` | yes | `ontoforge_dev` | Database password |
| `PORT` | no | `8000` | HTTP server port |
| `EMBEDDING_PROVIDER` | no | *(disabled)* | `ollama` or `openai` — omit to disable semantic search |
| `EMBEDDING_MODEL` | no | `bge-m3` | Embedding model name |
| `EMBEDDING_BASE_URL` | no | `http://localhost:11434` (`ollama`), `https://api.openai.com/v1` (`openai`) | Embedding API base as the provider documents it — the Ollama host, or the OpenAI-compatible base including its version |
| `EMBEDDING_API_KEY` | no | *(none)* | API key — **required** when `EMBEDDING_PROVIDER=openai` |
| `EMBEDDING_DIMENSIONS` | no | `1024` | Vector dimensions — must match what the model returns |
| `EMBEDDING_BATCH_SIZE` | no | `1` | Texts per embedding request when many texts are embedded together (positive integer) |
| `EMBEDDING_CONCURRENCY` | no | `1` | Embedding requests in flight at once when many texts are embedded together (positive integer) |
| `SEARCH_MAX_ATTEMPTS` | no | `5` | Failed attempts before a queued search-indexing item counts as failed (positive integer) |
| `SEARCH_WORKER_BATCH` | no | `64` | Queued search-indexing items the background worker claims per batch (positive integer) |
| `SEARCH_POLL_MS` | no | `5000` | Milliseconds the background search worker waits between queue checks when no wake-up arrives (positive integer) |
| `AI_PROVIDER` | no | *(disabled)* | `ollama`, `openai` or `anthropic` — omit to disable AI features |
| `AI_MODEL` | with `AI_PROVIDER` | *(none)* | AI model name (must support tool calling) |
| `AI_BASE_URL` | no | `http://localhost:11434` (`ollama`), `https://api.openai.com/v1` (`openai`), `https://api.anthropic.com` (`anthropic`) | AI API base as the provider documents it — the Ollama or Anthropic host, or the OpenAI-compatible base including its version |
| `AI_API_KEY` | no | *(none)* | API key — **required** when `AI_PROVIDER` is `openai` or `anthropic` |
| `AI_REASONING_EFFORT` | no | *(model default)* | `none`, `low`, `medium` or `high` — how hard the model thinks |

### Container Images

| Image | Description |
|---|---|
| `pgvector/pgvector:0.8.6-pg18-trixie` | PostgreSQL 18 with pgvector |
| `ghcr.io/rawe/ontoforge-server:latest` | OntoForge backend (REST API + MCP) |
| `ghcr.io/rawe/ontoforge-ui:latest` | OntoForge frontend |
| `ollama/ollama:latest` | Ollama (optional, for local embeddings and AI) |

## Remote mode

Nothing is deployed and no server variables apply — the server is configured by whoever
runs it.

1. **Base URL** — ask for the address the OntoForge API is served at, without a path
   (e.g. `https://ontoforge.example.com`). Check it answers:
   `curl -s "$URL/api/server/info"` returns the server's version.
2. **Authentication** — a `401` on that check means authentication is enabled and every
   request needs a Bearer token. Never ask for, read or write the token's value.
3. **Client settings** — tell the user to set, before starting the assistant:
   - `ONTOFORGE_BASE_URL` to the base URL
   - `ONTOFORGE_API_TOKEN`, only when authentication is enabled, from their own secret
     source, e.g. `ONTOFORGE_API_TOKEN=$(<their source>) claude`

   Scripts also accept both from a connection profile named by `ONTOFORGE_ENV_FILE`; the
   MCP client does not, so `.mcp.json` needs the variables themselves.
4. **MCP configuration** — as below.
5. **Ontology** — if the configured ontology does not exist on the server yet, the
   modeling server's `ensure_ontology` tool creates it.

## MCP Configuration

Both modes write the same file. Read `templates/mcp.json` and adapt it:

- Replace `my_ontology` and `my_lens` in the mount URLs with the user's ontology key and
  lens key.
- Keep `${ONTOFORGE_BASE_URL:-http://localhost:8000}` and `${ONTOFORGE_API_TOKEN:-}` as
  they are: the MCP client expands them from the environment it starts in. Unset, they
  mean the local server without authentication; set, any server with a token. The file
  holds no address that differs per developer and no secret, so it can be committed.
- In local mode with changed ports, change only the default inside
  `${ONTOFORGE_BASE_URL:-…}`.

Write the result as `.mcp.json` in the project root. If a `.mcp.json` already exists,
merge the `mcpServers` entries into it — do not overwrite existing servers.

## MCP Endpoints

OntoForge exposes two MCP servers, each bound to one ontology by its mount URL:

- **Modeling**: `<baseUrl>/mcp/ontologies/<ontologyKey>/model` — schema design (entity types, relation types, properties, lenses)
- **Runtime**: `<baseUrl>/mcp/ontologies/<ontologyKey>/runtime/lenses/<lensKey>` — data operations through one lens

If the configured ontology does not exist yet, the modeling server's argument-less `ensure_ontology` tool creates it (and no-ops when it already exists); creating ontologies under other keys, renaming, and deleting are REST/UI operations.
