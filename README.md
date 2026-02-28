# OntoForge

A Neo4j-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs.

## Motivation

When building applications that depend on structured domain knowledge — whether it's a research tool, a recommendation system, or an internal knowledge base — the schema behind the data matters as much as the data itself. Without a way to define and enforce that schema, knowledge graphs tend to drift into inconsistency.

OntoForge exists to solve this. It lets you **model an ontology** (entity types, relation types, property definitions) through a dedicated UI and API, and then **interact with instance data** through a generic, schema-driven runtime API that validates every write against your ontology. You define the rules once; the system enforces them on every operation.

The intended workflow:

1. **Design** your ontology using the modeling UI or API — define what entities, relations, and properties exist in your domain.
2. **Test** your ontology by creating instance data through the runtime API and iterating on the schema until it fits.
3. **Integrate** the runtime API into your application's backend — OntoForge becomes the schema-enforced persistence layer for your domain knowledge.
4. **Connect AI tools** via MCP servers — one for modeling the ontology, one for structured read/write access to instance data, giving coding assistants controlled access to your knowledge graph.

The key idea: **no unstructured writes**. Every entity and relation that goes into the graph must conform to the ontology. Read access can be more flexible (e.g., direct Neo4j queries for analytics), but writes are always schema-enforced through the runtime API.

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

OntoForge exposes two MCP servers for AI-assisted workflows — one for schema design, one for data access. Both run inside the same backend process and are scoped to a single ontology via the URL.

### Modeling Server

Design and iterate on ontology schemas. 15 tools for managing entity types, relation types, properties, validation, and export/import.

**Endpoint:** `http://localhost:8000/mcp/model/{ontologyKey}`

### Runtime Server

Read and write instance data validated against the ontology. Tools for entity/relation CRUD, semantic search, filtering, graph exploration, and data management.

**Endpoint:** `http://localhost:8000/mcp/runtime/{ontologyKey}`

### Client Configuration

To connect an MCP client (e.g., Claude Code, Cursor), add one or both servers to your MCP configuration. Replace `my_ontology` with your ontology's key.

An example config is provided at the project root — edit the ontology key and use it directly:

```bash
# Claude Code
claude --mcp-config mcp-example.json
```

```json
{
  "mcpServers": {
    "ontoforge-modeling": {
      "type": "http",
      "url": "http://localhost:8000/mcp/model/my_ontology"
    },
    "ontoforge-runtime": {
      "type": "http",
      "url": "http://localhost:8000/mcp/runtime/my_ontology"
    }
  }
}
```

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

The API is available at `http://localhost:8000`. On startup it creates Neo4j constraints and loads the schema cache automatically.

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

- **Modeling module** — ontology schema CRUD, validation, JSON export/import (`/api/model`)
- **Runtime module** — schema-driven instance CRUD, validation, search, graph traversal (`/api/runtime/{ontologyKey}`)
- **Frontend** — React UI for schema design and runtime data management
- **MCP layer** — two MCP servers: modeling (schema design) and runtime (data access)

Schema nodes and instance nodes coexist in the same database, separated by label conventions. The runtime validates every write against an in-memory schema cache, ensuring instance data always conforms to the ontology.

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
    └── roadmap.md                  # Phase tracking
```

## Configuration

The backend reads settings from environment variables (or a `.env` file in `backend/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_URI` | `bolt://localhost:7687` | Neo4j Bolt connection |
| `DB_USER` | `neo4j` | Neo4j username |
| `DB_PASSWORD` | `ontoforge_dev` | Neo4j password |
| `PORT` | `8000` | HTTP listen port |
| `EMBEDDING_PROVIDER` | *(unset — disabled)* | Set to `ollama` to enable semantic search |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `EMBEDDING_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |

In Docker, `DB_URI` is set to `bolt://neo4j:7687` automatically via `docker-compose.yml`. Semantic search is opt-in — when `EMBEDDING_PROVIDER` is unset, all entity CRUD works normally without embeddings.

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
