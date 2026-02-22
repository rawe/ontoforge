# OntoForge

A Neo4j-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs.

## Motivation

When building applications that depend on structured domain knowledge — whether it's a research tool, a recommendation system, or an internal knowledge base — the schema behind the data matters as much as the data itself. Without a way to define and enforce that schema, knowledge graphs tend to drift into inconsistency.

OntoForge exists to solve this. It lets you **model an ontology** (entity types, relation types, property definitions) through a dedicated UI and API, and then **interact with instance data** through a generic, schema-driven runtime API that validates every write against your ontology. You define the rules once; the system enforces them on every operation.

The intended workflow:

1. **Design** your ontology using the modeling UI or API — define what entities, relations, and properties exist in your domain.
2. **Test** your ontology by creating instance data through the runtime API and iterating on the schema until it fits.
3. **Integrate** the runtime API into your application's backend — OntoForge becomes the schema-enforced persistence layer for your domain knowledge.
4. **Connect AI tools** via MCP servers (planned) — one for modeling the ontology, one for structured read/write access to instance data, giving coding assistants controlled access to your knowledge graph.

The key idea: **no unstructured writes**. Every entity and relation that goes into the graph must conform to the ontology. Read access can be more flexible (e.g., direct Neo4j queries for analytics), but writes are always schema-enforced through the runtime API.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [Node.js](https://nodejs.org/) 18+ and npm

### 1. Start Neo4j

```bash
docker compose up -d
```

This starts a single Neo4j 5.x instance at `localhost:7474` (HTTP) / `localhost:7687` (Bolt).

### 2. Start the Backend

```bash
cd backend
uv sync
uv run uvicorn ontoforge_server.main:app --reload --port 8000
```

The API is available at `http://localhost:8000`. On startup it creates Neo4j constraints and loads the schema cache automatically.

- API docs: `http://localhost:8000/docs`
- Modeling endpoints: `/api/model/...`
- Runtime endpoints: `/api/runtime/{ontologyKey}/...`

### 3. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### 4. Run Tests

```bash
cd backend
uv run pytest -v
```

Tests are mocked — no running Neo4j instance required.

## Architecture

OntoForge is a modular monolith backed by a single Neo4j database that holds both schema and instance data.

- **Modeling module** — ontology schema CRUD, validation, JSON export/import (`/api/model`)
- **Runtime module** — schema-driven instance CRUD, validation, search, graph traversal (`/api/runtime/{ontologyKey}`)
- **Frontend** — React UI for schema design (runtime UI planned)
- **MCP layer** — planned: separate servers for modeling and runtime, giving AI assistants structured access

Schema nodes and instance nodes coexist in the same database, separated by label conventions. The runtime validates every write against an in-memory schema cache, ensuring instance data always conforms to the ontology.

See `docs/architecture.md` for the full system design.

## Project Structure

```
ontoforge/
├── docker-compose.yml              # Single Neo4j instance
├── backend/
│   ├── pyproject.toml              # Python deps (uv-managed)
│   ├── src/ontoforge_server/
│   │   ├── main.py                 # FastAPI app, mounts both routers
│   │   ├── config.py               # Environment-based settings
│   │   ├── core/                   # Shared: DB driver, exceptions, schema models
│   │   ├── modeling/               # Schema CRUD, validation, export/import
│   │   └── runtime/                # Instance CRUD, search, graph traversal
│   └── tests/
├── frontend/
│   ├── package.json                # React 19 + TypeScript + Vite
│   └── src/
└── docs/
    ├── prd.md                      # Product requirements
    ├── architecture.md             # System architecture, Neo4j storage model
    ├── api-contracts/              # REST endpoint specifications
    ├── decisions.md                # Architectural decision log
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

## Current Status

- **Phase 0 (Architecture)** — Complete
- **Phase 1 (Modeling API)** — Complete (26 endpoints, 36 unit tests)
- **Phase 2 (Runtime API)** — In progress (17 endpoints, 56 unit tests)
- **Phase 3 (Frontend UI)** — Modeling UI complete, runtime UI deferred
- **Phase 4 (MCP)** — Deferred

See `docs/roadmap.md` for details.

## License

TBD
