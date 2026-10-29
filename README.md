# OntoForge

A graph-native ontology studio for designing graph schemas and using them through generic, schema-driven APIs. Storage sits behind a persistence port with a PostgreSQL adapter.

## Motivation

When building applications that depend on structured domain knowledge — whether it's a research tool, a recommendation system, or an internal knowledge base — the schema behind the data matters as much as the data itself. Without a way to define and enforce that schema, knowledge graphs tend to drift into inconsistency.

OntoForge exists to solve this. It lets you **model a schema** (entity types, relation types, property definitions) through a dedicated UI and API, and then **interact with instance data** through a generic, schema-driven runtime API that validates every write against your schema. You define the rules once; the system enforces them on every operation.

**One server, many ontologies.** An ontology is a totally isolated unit: one domain's schema together with its lenses, saved queries, agents, and all of its instance data. Nothing spans two ontologies — every request addresses exactly one, named in the URL.

**Lenses are views.** Within an ontology, lenses are named views over its schema — either unscoped (full access to all types and properties) or scoped to a filtered subset. This lets different teams or applications work with the same data through focused, domain-specific views without fragmenting the data model.

The intended workflow:

1. **Create an ontology** — a named, isolated home for one domain.
2. **Design** its schema using the modeling UI or API — define what entity types, relation types, and properties exist in that domain.
3. **Create lenses** — named views over the schema, optionally scoping each to specific types and properties.
4. **Test** your schema by creating instance data through the runtime API and iterating until it fits.
5. **Integrate** the runtime API into your application's backend — OntoForge becomes the schema-enforced persistence layer for your domain knowledge.
6. **Connect AI tools** via MCP servers — one for modeling the schema, one for structured read/write access to instance data through one lens, giving coding assistants controlled access to your knowledge graph.

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

OntoForge exposes two MCP servers for AI-assisted workflows — one for schema design, one for data access. Both run inside the same backend process, and both are bound to one ontology by their mount URL. The URL is the only binding channel: no tool takes an ontology parameter, and a bound client can never reach another ontology.

### Modeling Server

Design and iterate on one ontology's schema. Tools for managing entity types, relation types, properties, lenses, search indices and search settings, validation, and export/import — plus the argument-less `ensure_ontology`, which creates the mount's own ontology if it does not exist yet (only with authentication off; with it on, the tool creates nothing).

**Endpoint:** `http://localhost:8000/mcp/ontologies/{ontologyKey}/model`

### Runtime Server

Read and write one ontology's instance data through one lens. Tools for entity/relation CRUD, semantic search, filtering, and graph exploration.

**Endpoint:** `http://localhost:8000/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`

### Client Configuration

To connect an MCP client (e.g., Claude Code, Cursor), add one or both servers to your MCP configuration — one config entry per ontology. Replace `my_ontology` and `my_lens` with your keys. Example config at `mcp-example.json`:

```bash
claude --mcp-config mcp-example.json
```

```json
{
  "mcpServers": {
    "ontoforge-modeling": {
      "type": "http",
      "url": "http://localhost:8000/mcp/ontologies/my_ontology/model"
    },
    "ontoforge-runtime": {
      "type": "http",
      "url": "http://localhost:8000/mcp/ontologies/my_ontology/runtime/lenses/my_lens"
    }
  }
}
```

With authentication on, connect through the deployment's public address (`PUBLIC_URL`,
e.g. `http://localhost:5173/mcp/ontologies/my_ontology/model`) and leave out any token:
an OAuth-capable client signs in through the browser on first connect.

### Example: Runtime Server Quick Start

Once connected to the runtime server, an AI assistant can work with your knowledge graph:

1. **Inspect the schema** — `get_schema()` returns all entity types, relation types, and property definitions so the assistant knows what data structures are available.
2. **Create data** — `create_entity(entity_type_key="person", properties={"name": "Alice", "age": 30})` creates a schema-validated entity. Required properties are enforced, types are checked.
3. **Search** — `search(query="distributed systems engineers")` ranks entities by properties and documents using the best available strategy. PostgreSQL keyword search works without an embedding provider; a local provider also enables semantic and hybrid search.
4. **Explore the graph** — `get_neighbors(entity_type_key="person", entity_id="...", direction="outgoing")` discovers what an entity is connected to.

Every write is validated against the ontology's schema — the assistant cannot invent entity types, add undefined properties, or write structurally invalid data.

See [docs/interfaces/](docs/interfaces/README.md) for the full tool catalog.

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
fails the boot rather than falling back to defaults. Files never layer and launchers do
not carry configuration values, so a setting cannot come from a file the operator did
not choose; an environment variable already set in the shell wins over the file.

With authentication on, against a development Keycloak:

```bash
./dev.sh keycloak             # Keycloak on :8180 with realm, clients and test users; writes env/auth.local.env
./dev.sh env/auth.local.env   # authentication on; sign in at http://localhost:5173
```

The test users, their generated passwords and how to reset Keycloak:
[scripts/keycloak/USAGE.md](scripts/keycloak/USAGE.md).

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

The API is available at `http://localhost:8000`. On startup it initializes the server-wide database objects; each ontology's storage is provisioned when the ontology is created. The runtime schema cache is loaded lazily on first request per ontology and lens.

- Registry endpoints: `/api/ontologies`
- Modeling endpoints: `/api/ontologies/{ontologyKey}/model/...`
- Runtime endpoints: `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/...`
- Server capability report: `/api/server/features`

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
Integration tests are opt-in. Their dependencies vary by suite; the database, model
provider and shared-state requirements are listed in
[docs/workflows/testing.md](docs/workflows/testing.md). The same guide links to the
authentication checks and multi-server test harness.

## Architecture

OntoForge is a modular monolith. One ontology database holds every ontology's
schema and instance data. Ontology storage goes through a persistence port with
per-ontology bound stores, implemented by the PostgreSQL adapter (one PostgreSQL schema
per ontology). With authentication enabled, principals and assignments live in a
separate access database. Threads and browser sessions use the separate shared-state
interfaces described in [architecture](docs/architecture.md#shared-state).

- **Registry** — ontologies as manageable units (`/api/ontologies`)
- **Modeling** — one ontology's schema, lenses, validation, export/import (`/api/ontologies/{ontologyKey}/model`)
- **Runtime** — schema-driven instance data through one lens (`/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`)
- **MCP** — two servers, modeling and runtime, for AI clients, bound by their mount URLs
- **Frontend** — a start page managing the ontologies, then two surfaces per ontology: Workbench for data, Studio for schema design

Full documentation starts at **[docs/README.md](docs/README.md)**:

| | |
|---|---|
| [architecture.md](docs/architecture.md) | System components, boundaries, invariants and flows |
| [Architectural constraints](docs/architecture-constraints.md) | Essential boundaries to preserve when changing the system |
| [capabilities/](docs/capabilities/) | One document per capability, end to end |
| [interfaces](docs/interfaces/README.md) | REST surfaces and MCP tools; exact schemas are in OpenAPI |
| [storage-adapters](docs/storage-adapters/README.md) | Persistence contract and PostgreSQL adapter |
| [product surface](docs/product-surface/README.md) | Web UI screens and interactions |

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
│   │   ├── adapters/               # Database adapter (PostgreSQL)
│   │   ├── registry/               # Ontology registry CRUD
│   │   ├── modeling/               # Schema CRUD, validation, export/import
│   │   ├── runtime/                # Instance CRUD, search, graph traversal
│   │   ├── server/                 # Server capability report
│   │   └── mcp/                    # MCP servers (modeling + runtime tools)
│   └── tests/
├── dev.sh                          # Start PostgreSQL + backend + frontend for local development
├── env/                            # Committed configuration presets for ./dev.sh
├── frontend/
│   ├── Dockerfile
│   ├── package.json                # Web client (Workbench + Studio): React 19 + TypeScript + Vite
│   └── src/
└── docs/
    ├── README.md                   # Reading paths and documentation map
    ├── concepts.md                 # Mental model and relationships
    ├── glossary.md                 # Shared vocabulary
    ├── architecture.md             # Components, boundaries, invariants and flows
    ├── architecture-constraints.md # Essential architectural guardrails
    ├── implementation/             # Contributor details tied to the implementation
    ├── capabilities/               # One document per capability
    ├── interfaces/                 # REST, MCP and the shared conventions
    ├── storage-adapters/           # Persistence contract and PostgreSQL adapter
    ├── product-surface/            # Web UI screens and interactions
    ├── adr/                        # Alternatives weighed behind decisions
    └── workflows/                  # Procedures for working on OntoForge
```

## Configuration

The backend reads settings from environment variables (or a `.env` file in `server/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_BACKEND` | `postgres` | Persistence adapter selection (`postgres`, the only adapter) |
| `DB_URI` | `postgresql://localhost:5432/ontoforge` | Database connection — the DSN carries host, port and database |
| `DB_USER` | `postgres` | Database username |
| `DB_PASSWORD` | `ontoforge_dev` | Database password |
| `DB_POOL_SIZE` | `10` | Connections the ontology database pool of one server opens at most (positive integer) |
| `DB_LISTEN_URI` | `DB_URI` | Where the search worker's wake-up subscription (`LISTEN`) connects; set it to the database itself when `DB_URI` names a transaction-mode pooler, which cannot hold a subscription |
| `PORT` | `8000` | HTTP listen port |
| `SHUTDOWN_DRAIN_SECONDS` | `20` | Seconds a stopping server lets running requests and chat streams finish before it cuts them; readiness answers 503 meanwhile (positive integer) |
| `SHARED_STATE` | `memory` | Where shared state such as assistant conversations lives: `memory` serves one server process; `valkey` is shared by every server naming the same Valkey |
| `VALKEY_URL` | *(required with `SHARED_STATE=valkey`)* | `redis://` or `rediss://` URL of the shared Valkey, which must run without persistence and with `maxmemory-policy noeviction`; an unreachable Valkey, another eviction policy or a Valkey that cannot run the scripts fails the boot, and so does `VALKEY_URL` set without `SHARED_STATE=valkey` |
| `SEARCH_MAX_ATTEMPTS` | `5` | Failed attempts before a queued search-indexing item counts as failed — a rebuild or a new write of its entity retries it (positive integer) |
| `SEARCH_WORKER_BATCH` | `64` | Queued search-indexing items the background worker claims per batch (positive integer) |
| `SEARCH_POLL_MS` | `5000` | Milliseconds the background worker waits between queue checks when no wake-up notification arrives (positive integer) |
| `CHANGESET_MAX_BYTES` | `33554432` (32 MiB) | The most bytes one changeset's staged values hold, document text included (positive integer) |
| `CHANGESET_MAX_OBJECTS` | `10000` | The most staged objects one changeset holds; a larger import commits in several changesets (positive integer) |
| `REQUEST_BODY_LIMIT` | `16777216` (16 MiB) | The largest request body the server reads, in bytes, such as a staging request that lists many calls; a larger one answers `413 PAYLOAD_TOO_LARGE` (positive integer) |
| `PUBLIC_URL` | *(unset)* | The address browsers and clients reach the deployment at, reported by `/api/server/info` for client configuration. Required with `AUTH_ENABLED=true`: the browser's origin, whose `/api/auth/callback` is the sign-in callback and which the web client must be served from; it must be `https` unless its host is localhost |

In Docker, `DB_URI` is set to `postgresql://postgres:5432/ontoforge` automatically via `docker-compose.yml`.

### Authentication

Off by default: every caller may do everything. With `AUTH_ENABLED=true` callers sign in
through an OpenID provider and OntoForge's own roles decide what they may do
([docs/capabilities/authentication.md](docs/capabilities/authentication.md)). Every
variable below without a default is then required, as is `PUBLIC_URL`; a missing one, an
unreachable provider or an unusable access database fails the boot. With it off they are
not read. Every server of one deployment needs the same values.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | `true` turns sign-in and role checks on; any other value than `true` or `false` fails the boot |
| `OIDC_ISSUER` | *(required)* | The provider's issuer URL, exactly as tokens carry it and browsers reach it; it must be `https` unless its host is localhost |
| `OIDC_BACKCHANNEL_URL` | `OIDC_ISSUER` | Where this server reaches the provider when it cannot reach `OIDC_ISSUER` itself, such as from a container; tokens still name `OIDC_ISSUER` |
| `OIDC_CLIENT_ID` | *(required)* | The confidential client the server signs browsers in with |
| `OIDC_CLIENT_SECRET` | *(required)* | That client's secret; never in a committed file |
| `OIDC_AUDIENCE` | *(required)* | The audience an access token must carry for REST and MCP; it must differ from `OIDC_CLIENT_ID` |
| `AUTH_ADMIN_SUBJECT` | *(required)* | The subject, at `OIDC_ISSUER`, that is made an active Platform Administrator whenever it signs in |
| `AUTH_SESSION_IDLE_SECONDS` | `28800` (8 h) | How long a browser session lasts unused; at most 24 hours after sign-in in any case (positive integer) |
| `ACCESS_DB_URI` | *(required)* | `postgresql://` URL of the access database, which holds users and roles; the server creates it when missing. Its user and password are `DB_USER` and `DB_PASSWORD` unless the URL carries its own |

## Optional Features

**Semantic search** and **AI-powered runtime** are optional model-backed capabilities.
Both are disabled by default; schema modeling, entity/relation CRUD and MCP work without
them. [Entity identity comparison](#entity-identity-comparison) uses its own independent
Decision provider.

Both features support these provider types:

- **`ollama`** — local inference via [Ollama](https://ollama.com). No API key needed, models run on your machine.
- **`openai`** — any OpenAI-compatible API (OpenAI, Azure, OpenRouter, OVHcloud, LiteLLM, vLLM, etc.). Requires an API key.
- **`anthropic`** — Claude models through Anthropic's own API. AI-powered runtime only; Anthropic offers no embeddings. Requires an API key.

An AI or embedding base URL is written as the provider documents it: the host for `ollama`
(`http://localhost:11434`) and `anthropic` (`https://api.anthropic.com`), the API base
including its version for `openai` (`https://openrouter.ai/api/v1`). A base URL that breaks this rule stops the server at
startup with the corrected value in the message. This catches a misplaced API path at
startup instead of a 404 on the first model call
([ADR 0024](docs/adr/0024-provider-base-urls-as-documented.md)).

### Semantic Search

Find entities by meaning rather than exact keywords — within a single entity type or across all types at once. Available via REST, MCP, and the UI (command palette and entity pickers). Requires an embedding model.

Each server uses one embedding model. Search merges indices by similarity, which is a
single comparable scale only under one model; each semantic generation records the model
it was built with ([search index lifecycle](docs/capabilities/search-indices.md#lifecycle)).

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | *(unset — disabled)* | `ollama` or `openai` |
| `EMBEDDING_MODEL` | `bge-m3` | Embedding model name; the default is multilingual, because an ontology's content may mix German and English |
| `EMBEDDING_BASE_URL` | `http://localhost:11434` (`ollama`), `https://api.openai.com/v1` (`openai`) | Embedding API base, as the provider documents it |
| `EMBEDDING_API_KEY` | *(unset)* | API key (required for `openai` provider) |
| `EMBEDDING_DIMENSIONS` | `1024` | Vector dimensions — must match what the model returns |
| `EMBEDDING_BATCH_SIZE` | `1` | Texts per embedding request when many texts are embedded together (positive integer; cloud endpoints typically take 16 or more) |
| `EMBEDDING_CONCURRENCY` | `1` | Embedding requests in flight at once when many texts are embedded together (positive integer) |

Changing `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` on an existing database — including a reused Docker volume — needs no action for entity search: the search indices notice the new model and build new semantic entries in the background; until those are ready, semantic ranking finds nothing and hybrid search answers from keyword entries alone. Saved-query discovery is the exception: its description index is built for the vector width of the model that created it, and startup names each mismatched one in a warning. `POST /api/ontologies/{ontologyKey}/model/rebuild-search-data` rebuilds one ontology's saved-query description vectors and that index at the new width — run it once per ontology after a provider switch.

### AI-Powered Runtime

Natural language query and conversational chat over your knowledge graph. These features use tool calling to interact with the schema and data, so the model must support function/tool calling.

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | *(unset — disabled)* | `ollama`, `openai` or `anthropic` |
| `AI_MODEL` | *(required with `AI_PROVIDER`)* | AI model name (must support tool calling) |
| `AI_BASE_URL` | `http://localhost:11434` (`ollama`), `https://api.openai.com/v1` (`openai`), `https://api.anthropic.com` (`anthropic`) | AI model API base, as the provider documents it |
| `AI_API_KEY` | *(unset)* | API key (required for `openai` and `anthropic`) |
| `AI_REASONING_EFFORT` | *(unset — model default)* | `none`, `low`, `medium` or `high` — how hard the model thinks |

Thinking effort is a deployment-wide setting, not a per-agent setting: it controls the
deployment's latency and cost budget. Keeping it out of individual agent configurations
also avoids making a level that a model ignores look like a broken agent configuration.
The configured value is validated at boot.

**Recommended Ollama models** by available RAM (Apple Silicon / unified memory):

| RAM | Model | Params | Memory Used |
|-----|-------|--------|-------------|
| ~8 GB | `qwen3:8b` | 8B dense | ~6 GB |
| ~16 GB | `qwen3:14b` | 14B dense | ~11 GB |
| ~32 GB+ | `qwen3:32b` | 32B dense | ~22 GB |

Account for OS and other services (Docker, PostgreSQL) when choosing a model — pick one tier below your total RAM to leave headroom.

### Entity identity comparison

The optional [identity comparison](docs/capabilities/entity-identity-comparison.md)
capability uses a Decision provider independently of AI chat and embeddings. Its
[provider contract](docs/providers/decision-api.md) is distinct from those providers.

| Variable | Default | Description |
|---|---|---|
| `DECISION_BASE_URL` | *(unset — disabled)* | Provider base URL before `/v1/systemone` |
| `DECISION_MODEL` | `jev-1.13.0` | Provider model identifier |
| `DECISION_API_KEY` | `TYPESAFE_API_KEY` when set, otherwise none | Optional Bearer credential; an explicit `DECISION_API_KEY` takes precedence |

Startup installs the configured client without contacting the provider. The provider
guide describes programmatic use and an example deployment.

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

For a multi-server Kubernetes example, including its assumptions and limitations, see
[deploy/kubernetes/README.md](deploy/kubernetes/README.md). The release and storage-upgrade
procedure is in [docs/workflows/releasing.md](docs/workflows/releasing.md).

## License

TBD
