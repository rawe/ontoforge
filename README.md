# OntoForge

A Neo4j-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [Node.js](https://nodejs.org/) 18+ and npm

### 1. Start Neo4j

```bash
docker compose up -d
```

This starts two Neo4j 5.x instances:
- **Model DB** — schema storage at `localhost:7474` (HTTP) / `localhost:7687` (Bolt)
- **Instance DB** — runtime data at `localhost:7475` (HTTP) / `localhost:7688` (Bolt)

Wait for health checks to pass:

```bash
docker compose ps
```

### 2. Start the Backend

```bash
cd backend
uv sync
uv run uvicorn ontoforge_server.main:app --reload --port 8000
```

The API is available at `http://localhost:8000`. On startup it creates Neo4j uniqueness constraints automatically.

- API docs: `http://localhost:8000/docs`
- Modeling endpoints: `http://localhost:8000/api/model/...`

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

## Project Structure

```
ontoforge/
├── docker-compose.yml          # Neo4j Model DB + Instance DB
├── backend/
│   ├── pyproject.toml          # Python deps (uv-managed)
│   ├── src/ontoforge_server/
│   │   ├── main.py             # FastAPI app, CORS, exception handlers
│   │   ├── config.py           # Environment-based settings
│   │   ├── core/
│   │   │   ├── database.py     # Neo4j async driver + constraint bootstrap
│   │   │   └── exceptions.py   # Domain exceptions → HTTP mapping
│   │   └── modeling/
│   │       ├── router.py       # 26 REST endpoints at /api/model
│   │       ├── service.py      # Business logic, validation
│   │       ├── repository.py   # Neo4j Cypher queries
│   │       └── schemas.py      # Pydantic request/response models
│   └── tests/                  # 25 unit tests (mocked repository)
├── frontend/
│   ├── package.json            # React 19 + TypeScript + Vite
│   └── src/
│       ├── api/client.ts       # API client for all modeling endpoints
│       ├── types/models.ts     # TypeScript DTOs
│       ├── pages/              # Ontology list, detail, type editors
│       └── components/         # Layout, forms, tables
└── docs/
    ├── prd.md                  # Product requirements
    ├── architecture.md         # System architecture, Neo4j storage model
    ├── api-contracts/          # REST endpoint specifications
    ├── decisions.md            # Architectural decision log
    └── roadmap.md              # Phase tracking and session continuity
```

## Configuration

The backend reads settings from environment variables (or a `.env` file in `backend/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_DB_URI` | `bolt://localhost:7687` | Neo4j Model DB connection |
| `MODEL_DB_USER` | `neo4j` | Model DB username |
| `MODEL_DB_PASSWORD` | `ontoforge_dev` | Model DB password |

Copy `backend/.env.example` to `backend/.env` to customize.

## Architecture

OntoForge is a modular monolith:

- **Modeling module** — schema CRUD, validation, export/import against the Model DB
- **Runtime module** — instance CRUD against the Instance DB (not yet implemented)
- **Two Neo4j databases** — fully decoupled, connected only by a provisioning step

See `docs/architecture.md` for the full system design.

## Current Status

- **Phase 0 (Architecture)** — Complete
- **Phase 1 (Modeling API)** — Complete (26 endpoints, 25 tests)
- **Phase 2 (Runtime API)** — Not started
- **Phase 3 (Frontend UI)** — Modeling UI first draft complete
- **Phase 4 (MCP)** — Deferred

See `docs/roadmap.md` for details.
