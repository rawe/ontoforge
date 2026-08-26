# OntoForge

A graph-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs. Storage sits behind an exchangeable database adapter — PostgreSQL is the default deployment, Neo4j the alternative adapter.

## Motivation

When building applications that depend on structured domain knowledge — whether it's a research tool, a recommendation system, or an internal knowledge base — the schema behind the data matters as much as the data itself. Without a way to define and enforce that schema, knowledge graphs tend to drift into inconsistency.

OntoForge exists to solve this. It lets you **model a global schema** (entity types, relation types, property definitions) through a dedicated UI and API, and then **interact with instance data** through a generic, schema-driven runtime API that validates every write against your schema. You define the rules once; the system enforces them on every operation.

**Ontologies are lenses.** The schema is global and independent. Ontologies are named views over this schema — either unscoped (full access to all types and properties) or scoped to a filtered subset. This lets different teams or applications work with the same data through focused, domain-specific views without fragmenting the data model.

The intended workflow:

1. **Design** your schema using the modeling UI or API — define what entity types, relation types, and properties exist in your domain.
2. **Create ontologies** — define named lenses over the schema, optionally scoping each to specific types and properties.
3. **Test** your schema by creating instance data through the runtime API and iterating until it fits.
4. **Integrate** the runtime API into your application's backend — OntoForge becomes the schema-enforced persistence layer for your domain knowledge.
5. **Connect AI tools** via MCP servers — one for modeling the schema, one for structured read/write access to instance data, giving coding assistants controlled access to your knowledge graph.

The key idea: **no unstructured writes**. Every entity and relation that goes into the graph must conform to the schema. Read access can be more flexible (e.g., OQL queries for analytics), but writes are always schema-enforced through the runtime API.

## Quick Start (Docker)

Start the full stack — PostgreSQL, backend, and frontend — with a single command:

```bash
cd docker
docker compose up -d --build
```

| Service  | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

Stop everything (data is preserved):

```bash
cd docker
docker compose stop
```

## MCP Servers

OntoForge exposes two MCP servers for AI-assisted workflows — one for schema design, one for data access. Both run inside the same backend process.

### Modeling Server

Design and iterate on the global schema. Tools for managing entity types, relation types, properties, ontology scopes, validation, and export/import.

**Endpoint:** `http://localhost:8000/mcp/model`

The modeling server operates on the global schema — no ontology key required.

### Runtime Server

Read and write instance data validated against the schema through an ontology lens. Tools for entity/relation CRUD, semantic search, filtering, and graph exploration.

**Endpoint:** `http://localhost:8000/mcp/runtime/{ontologyKey}`

The runtime server requires an ontology key to determine which lens to apply.

### Client Configuration

To connect an MCP client (e.g., Claude Code, Cursor), add one or both servers to your MCP configuration. Replace `my_ontology` with your ontology's key.

#### URL-based (default)

The ontology key is part of the runtime URL path. Example config at `mcp-example.json`:

```bash
claude --mcp-config mcp-example.json
```

```json
{
  "mcpServers": {
    "ontoforge-modeling": {
      "type": "http",
      "url": "http://localhost:8000/mcp/model"
    },
    "ontoforge-runtime": {
      "type": "http",
      "url": "http://localhost:8000/mcp/runtime/my_ontology"
    }
  }
}
```

#### Header-based

The ontology key is passed via the `X-Ontology-Key` HTTP header. Useful for orchestration frameworks that manage config via headers. Example config at `mcp-example-header.json`:

```bash
claude --mcp-config mcp-example-header.json
```

```json
{
  "mcpServers": {
    "ontoforge-modeling": {
      "type": "http",
      "url": "http://localhost:8000/mcp/model"
    },
    "ontoforge-runtime": {
      "type": "http",
      "url": "http://localhost:8000/mcp/runtime",
      "headers": {
        "X-Ontology-Key": "my_ontology"
      }
    }
  }
}
```

#### Environment variable

For single-ontology deployments, set `DEFAULT_MCP_ONTOLOGY_KEY` on the server. Runtime MCP connections without a URL key or header will use this default.

**Runtime resolution order:** URL path (highest priority) → `X-Ontology-Key` header → `DEFAULT_MCP_ONTOLOGY_KEY` env var → 400 error.

### Example: Runtime Server Quick Start

Once connected to the runtime server, an AI assistant can work with your knowledge graph:

1. **Inspect the schema** — `get_schema()` returns all entity types, relation types, and property definitions so the assistant knows what data structures are available.
2. **Create data** — `create_entity(entity_type_key="person", properties={"name": "Alice", "age": 30})` creates a schema-validated entity. Required properties are enforced, types are checked.
3. **Search by meaning** — `semantic_search(query="distributed systems engineers")` finds entities by semantic similarity, not just keyword matching. Requires `EMBEDDING_PROVIDER` to be configured.
4. **Explore the graph** — `get_neighbors(entity_type_key="person", entity_id="...", direction="outgoing")` discovers what an entity is connected to.

Every write is validated against the ontology — the assistant cannot invent entity types, add undefined properties, or write structurally invalid data.

See [docs/interfaces.md](docs/interfaces.md) for the full tool catalog.

## Development Setup

For local development with hot reload, run PostgreSQL in Docker and the backend/frontend natively — either manually as below, or all at once with `./dev.sh`.

Configuration comes from exactly one env file. `./dev.sh` uses `server/.env`; naming a
file uses that one instead, and nothing else is read:

```bash
./dev.sh                    # server/.env
./dev.sh env/ollama.env     # committed preset — everything on Ollama
AI_MODEL=qwen3:8b ./dev.sh  # a shell variable still wins over the file
```

Running the server directly honours the same rule: `ENV_FILE=<path> npm run dev` reads
that file, and plain `npm run dev` reads `server/.env`. A named file that does not exist
fails the boot rather than falling back to defaults.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) ≥ 22 LTS and npm

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Start the Backend

```bash
cd server
npm install
npm run dev
```

The API is available at `http://localhost:8000`. On startup it initializes the database schema. The runtime schema cache is loaded lazily on first request per ontology.

- Modeling endpoints: `/api/model/...`
- Runtime endpoints: `/api/runtime/{ontologyKey}/...`

### 3. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Run Tests

```bash
cd server
npm test
```

This runs the unit tests only — they are mocked and need no running services.
Integration tests are opt-in and do require a running database and Ollama; see
[docs/workflows/testing.md](docs/workflows/testing.md).

## Architecture

OntoForge is a modular monolith backed by a single database holding both schema and
instance data. All database access goes through a persistence port; PostgreSQL is the
default adapter, Neo4j the alternative.

- **Modeling** — the global schema, ontology scopes, validation, export/import (`/api/model`)
- **Runtime** — schema-driven instance data through an ontology lens (`/api/runtime/{ontologyKey}`)
- **MCP** — two servers, modeling and runtime, for AI clients
- **Frontend** — two surfaces: Workbench for data, Studio for schema design

Full documentation starts at **[docs/README.md](docs/README.md)**:

| | |
|---|---|
| [architecture.md](docs/architecture.md) | How the system is put together |
| [capabilities/](docs/capabilities/) | One document per capability, end to end |
| [interfaces.md](docs/interfaces.md) | Every REST endpoint and MCP tool |
| [storage-adapters.md](docs/storage-adapters.md) | What a storage backend must implement |
| [product-surface.md](docs/product-surface.md) | What the web client offers |
| [decisions.md](docs/decisions.md) | Rules that constrain the design |

## Project Structure

```
ontoforge/
├── docker-compose.yml              # PostgreSQL only (for local development)
├── docker/
│   └── docker-compose.yml          # Full stack: PostgreSQL + backend + frontend
├── examples/
│   └── docker-compose/             # Run OntoForge from pre-built images
├── server/
│   ├── Dockerfile
│   ├── package.json                # TypeScript backend (Node.js + Fastify)
│   ├── src/
│   │   ├── main.ts                 # Server startup
│   │   ├── app.ts                  # Fastify app, mounts routes and MCP servers
│   │   ├── config.ts               # Environment-based settings
│   │   ├── core/                   # Shared: persistence port, exceptions, OQL, AI
│   │   ├── adapters/               # Database adapters (PostgreSQL, Neo4j)
│   │   ├── modeling/               # Schema CRUD, validation, export/import
│   │   ├── runtime/                # Instance CRUD, search, graph traversal
│   │   └── mcp/                    # MCP servers (modeling + runtime tools)
│   └── tests/
├── dev.sh                          # Start PostgreSQL + backend + frontend for local development
├── env/                            # Committed configuration presets for ./dev.sh
├── frontend/
│   ├── Dockerfile
│   ├── package.json                # UI v3 (Workbench + Studio): React 19 + TypeScript + Vite
│   └── src/
└── docs/
    ├── README.md                   # Concepts, glossary, documentation map
    ├── architecture.md             # Components, data model, error model
    ├── capabilities/               # One document per capability
    ├── interfaces.md               # Every REST endpoint and MCP tool
    ├── storage-adapters.md         # The persistence port contract
    ├── product-surface.md          # What the web client offers
    ├── decisions.md                # Binding design rules
    ├── adr/                        # Decision records (archive)
    └── workflows/                  # Procedures: testing, release, test cycles
```

## Configuration

The backend reads settings from environment variables (or a `.env` file in `server/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_BACKEND` | `postgres` | Persistence adapter selection (`postgres` or `neo4j`) |
| `DB_URI` | `postgresql://localhost:5432/ontoforge` | Database connection — the DSN carries host, port and database |
| `DB_USER` | `postgres` | Database username |
| `DB_PASSWORD` | `ontoforge_dev` | Database password |
| `PORT` | `8000` | HTTP listen port |
| `DEFAULT_MCP_ONTOLOGY_KEY` | *(unset)* | MCP default ontology key — used when no key is in the URL or header |

In Docker, `DB_URI` is set to `postgresql://postgres:5432/ontoforge` automatically via `docker-compose.yml`.

## Optional Features

OntoForge has two optional features — **semantic search** and **AI-powered runtime** — that require an external model provider. Both are disabled by default and all core functionality (schema modeling, entity/relation CRUD, MCP) works without them.

Both features support two provider types:

- **`ollama`** — local inference via [Ollama](https://ollama.com). No API key needed, models run on your machine.
- **`openai`** — any OpenAI-compatible API (OpenAI, Azure, LiteLLM, vLLM, etc.). Requires an API key.

### Semantic Search

Find entities by meaning rather than exact keywords — within a single entity type or across all types at once. Available via REST, MCP, and the UI (command palette and entity pickers). Requires an embedding model.

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | *(unset — disabled)* | `ollama` or `openai` |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `EMBEDDING_BASE_URL` | `http://localhost:11434` | Embedding API endpoint |
| `EMBEDDING_API_KEY` | *(unset)* | API key (required for `openai` provider) |
| `EMBEDDING_DIMENSIONS` | *(auto)* | Vector dimensions (defaults: ollama=768, openai=1536) |

Semantic indexes are built for the vector width of the model that created them, so changing `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` on an existing database — including a reused Docker volume — leaves indexes the new model cannot be searched against. Startup names each one in a warning; `POST /api/model/rebuild-embeddings` rebuilds them at the new width and regenerates the vectors.

### AI-Powered Runtime

Natural language query, entity extraction from text, and conversational chat over your knowledge graph. These features use tool calling to interact with the schema and data, so the model must support function/tool calling.

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | *(unset — disabled)* | `ollama` or `openai` |
| `AI_MODEL` | `qwen3:8b` | AI model name (must support tool calling) |
| `AI_BASE_URL` | `http://localhost:11434` | AI model API endpoint |
| `AI_API_KEY` | *(unset)* | API key (required for `openai` provider) |
| `AI_REASONING_EFFORT` | *(unset — model default)* | `none`, `low`, `medium` or `high` — how hard the model thinks |

**Recommended Ollama models** by available RAM (Apple Silicon / unified memory):

| RAM | Model | Params | Memory Used |
|-----|-------|--------|-------------|
| ~8 GB | `qwen3:8b` | 8B dense | ~6 GB |
| ~16 GB | `qwen3:14b` | 14B dense | ~11 GB |
| ~32 GB+ | `qwen3:32b` | 32B dense | ~22 GB |

Account for OS and other services (Docker, PostgreSQL) when choosing a model — pick one tier below your total RAM to leave headroom.

## Container Images

Pushing a version tag triggers GitHub Actions to build and publish both images to GHCR:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

| Image | Description |
|-------|-------------|
| `ghcr.io/rawe/ontoforge-server:1.0.0` | Backend server (Node.js) |
| `ghcr.io/rawe/ontoforge-ui:1.0.0` | React frontend (nginx) |

Each image is also tagged `:latest`. See `Makefile` for manual builds and [`examples/docker-compose/`](examples/docker-compose/) for a ready-to-use setup.

## License

TBD
