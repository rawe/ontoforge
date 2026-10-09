# OntoForge Server

The OntoForge backend: modeling API, runtime API, both MCP servers, and the
OpenAPI description — one process, serving everything. It implements the API
described in [docs/](../docs/README.md).

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22 LTS and npm
- Docker (for the PostgreSQL dev database)
- Optional: [Ollama](https://ollama.com/) for semantic search and AI capabilities
  (`bge-m3` by default for embeddings; the chat model is always configured)

## Quickstart

```bash
# 1. Start PostgreSQL (from the repository root)
docker compose up -d

# 2. Install and run the server (hot reload)
cd server
npm install
npm run dev
```

The server listens on http://localhost:8000 — interactive API docs at
[/docs](http://localhost:8000/docs), the OpenAPI description at
[/openapi.json](http://localhost:8000/openapi.json), MCP mounts at
`/mcp/ontologies/{ontologyKey}/model` and
`/mcp/ontologies/{ontologyKey}/runtime/lenses/{lensKey}`.

For production-style runs: `npm run build && npm start`.

## Configuration

Environment variables only — see [.env.example](.env.example) for the full,
commented list. The defaults match the docker-compose dev stack, so no
configuration is needed for local development. To enable semantic search and AI,
set `EMBEDDING_PROVIDER=ollama` and `AI_PROVIDER=ollama` (e.g. in a local `.env`).

Exactly one env file is read: the one `ENV_FILE` names, otherwise `.env` in the
working directory. A variable already set in the environment wins over the file,
and a named file that is missing fails the boot rather than falling back.

The optional decision-model client is available for programmatic use only. See
[Decision API](../docs/providers/decision-api.md) for its contract, configuration and
local integration test. No decision-specific REST endpoint or UI is exposed.

## Tests

| Command | Suite | Needs |
|---|---|---|
| `npm test` | Unit | nothing |
| `npm run test:integration` | Integration | docker-compose PostgreSQL |
| `npm run test:integration:embedding` | Semantic search | PostgreSQL + Ollama |
| `npm run test:integration:ai` | AI (slow, real model) | PostgreSQL + Ollama |
| `npm run test:integration:decision` | Decision HTTP contract | Local decision API; no database |

`npm run typecheck` runs the TypeScript compiler without emitting.

## OQL parser

The OQL grammar lives in [grammar/](grammar/); the generated antlr4ng parser is
committed under `src/core/oql/generated/`. After changing the grammar, regenerate
with `npm run generate:oql`.
