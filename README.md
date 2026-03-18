# OntoForge

A Neo4j-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs.

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

The key idea: **no unstructured writes**. Every entity and relation that goes into the graph must conform to the schema. Read access can be more flexible (e.g., direct Neo4j queries for analytics), but writes are always schema-enforced through the runtime API.

## Quick Start (Docker)

Start the full stack — Neo4j, backend, and frontend — with a single command:

```bash
cd docker
docker compose up -d --build
```

| Service  | URL |
|----------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |
| Neo4j Browser | http://localhost:17474 |

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

See `docs/mcp-architecture.md` for the full tool catalog and design details.

## Development Setup

For local development with hot reload, run Neo4j in Docker and the backend/frontend natively:

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [Node.js](https://nodejs.org/) 18+ and npm

### 1. Start Neo4j

```bash
docker compose up -d neo4j
```

### 2. Start the Backend

```bash
cd backend
uv sync
uv run uvicorn ontoforge_server.main:app --reload --port 8000
```

The API is available at `http://localhost:8000`. On startup it creates Neo4j constraints. The runtime schema cache is loaded lazily on first request per ontology.

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
cd backend
uv run pytest -v
```

Tests are mocked — no running Neo4j instance required.

## Architecture

OntoForge is a modular monolith backed by a single Neo4j database that holds both schema and instance data.

- **Modeling module** — global schema CRUD, ontology scope management, validation, JSON export/import (`/api/model`)
- **Runtime module** — schema-driven instance CRUD, validation, search, graph traversal through ontology lenses (`/api/runtime/{ontologyKey}`)
- **Frontend** — React UI for schema design, ontology scope configuration, and runtime data management
- **MCP layer** — two MCP servers: modeling (global schema) and runtime (data access through an ontology)

Schema nodes and instance nodes coexist in the same database, separated by label conventions. The runtime validates every write against an in-memory schema cache (lazily loaded, invalidated on modeling changes), ensuring instance data always conforms to the schema as seen through the selected ontology.

See `docs/architecture.md` for the full system design.

## Project Structure

```
ontoforge/
├── docker-compose.yml              # Neo4j only (for local development)
├── docker/
│   └── docker-compose.yml          # Full stack: Neo4j + backend + frontend
├── examples/
│   └── docker-compose/             # Run OntoForge from pre-built images
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml              # Python deps (uv-managed)
│   ├── src/ontoforge_server/
│   │   ├── main.py                 # FastAPI app, mounts both routers
│   │   ├── config.py               # Environment-based settings
│   │   ├── core/                   # Shared: DB driver, exceptions, schema models
│   │   ├── modeling/               # Schema CRUD, validation, export/import
│   │   ├── runtime/                # Instance CRUD, search, graph traversal
│   │   └── mcp/                    # MCP servers (modeling + runtime tools)
│   └── tests/
├── frontend/
│   ├── Dockerfile
│   ├── package.json                # React 19 + TypeScript + Vite
│   └── src/
└── docs/
    ├── prd.md                      # Product requirements
    ├── architecture.md             # System architecture, Neo4j storage model
    ├── mcp-architecture.md         # MCP integration architecture
    ├── api-contracts/              # REST endpoint specifications
    ├── decisions.md                # Architectural decision log
    ├── feature-ideas/              # Future extension proposals
    └── releasing.md                # Release checklist
```

## Configuration

The backend reads settings from environment variables (or a `.env` file in `backend/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_URI` | `bolt://localhost:7687` | Neo4j Bolt connection |
| `DB_USER` | `neo4j` | Neo4j username |
| `DB_PASSWORD` | `ontoforge_dev` | Neo4j password |
| `PORT` | `8000` | HTTP listen port |
| `DEFAULT_MCP_ONTOLOGY_KEY` | *(unset)* | MCP default ontology key — used when no key is in the URL or header |

In Docker, `DB_URI` is set to `bolt://neo4j:7687` automatically via `docker-compose.yml`.

## Optional Features

OntoForge has two optional features — **semantic search** and **AI-powered runtime** — that require an external model provider. Both are disabled by default and all core functionality (schema modeling, entity/relation CRUD, MCP) works without them.

Both features support two provider types:

- **`ollama`** — local inference via [Ollama](https://ollama.com). No API key needed, models run on your machine.
- **`openai`** — any OpenAI-compatible API (OpenAI, Azure, LiteLLM, vLLM, etc.). Requires an API key.

### Semantic Search

Find entities by meaning rather than exact keywords. Requires an embedding model.

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | *(unset — disabled)* | `ollama` or `openai` |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `EMBEDDING_BASE_URL` | `http://localhost:11434` | Embedding API endpoint |
| `EMBEDDING_API_KEY` | *(unset)* | API key (required for `openai` provider) |
| `EMBEDDING_DIMENSIONS` | *(auto)* | Vector dimensions (defaults: ollama=768, openai=1536) |

### AI-Powered Runtime

Natural language query, entity extraction from text, and conversational chat over your knowledge graph. These features use tool calling to interact with the schema and data, so the model must support function/tool calling.

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | *(unset — disabled)* | `ollama` or `openai` |
| `AI_MODEL` | `qwen3:8b` | AI model name (must support tool calling) |
| `AI_BASE_URL` | `http://localhost:11434` | AI model API endpoint |
| `AI_API_KEY` | *(unset)* | API key (required for `openai` provider) |

**Recommended Ollama models** by available RAM (Apple Silicon / unified memory):

| RAM | Model | Params | Memory Used |
|-----|-------|--------|-------------|
| ~8 GB | `qwen3:8b` | 8B dense | ~6 GB |
| ~16 GB | `qwen3:14b` | 14B dense | ~11 GB |
| ~32 GB+ | `qwen3:32b` | 32B dense | ~22 GB |

Account for OS and other services (Docker, Neo4j) when choosing a model — pick one tier below your total RAM to leave headroom.

## Container Images

Pushing a version tag triggers GitHub Actions to build and publish both images to GHCR:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

| Image | Description |
|-------|-------------|
| `ghcr.io/rawe/ontoforge-server:1.0.0` | Python FastAPI backend |
| `ghcr.io/rawe/ontoforge-ui:1.0.0` | React frontend (nginx) |

Each image is also tagged `:latest`. See `Makefile` for manual builds and [`examples/docker-compose/`](examples/docker-compose/) for a ready-to-use setup.

## License

TBD
