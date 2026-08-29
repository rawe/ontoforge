# Testing

> How to run and write tests for OntoForge.

## Test Suites

All commands are run from `server/`.

| Command | Suite | External deps |
|---|---|---|
| `npm test` | Unit | None |
| `npm run test:integration` | Integration | The selected database |
| `npm run test:integration:embedding` | Semantic search | The selected database + Ollama (embedding model) |
| `AI_TEST=1 npm run test:integration:ai` | AI (slow, real model) | The selected database + an armed AI provider |

**Unit tests** (`tests/`, excluding `tests/integration/`) mock all external
dependencies (database drivers, embedding providers, AI models). They run fast and
require no infrastructure.

**Integration tests** (`tests/integration/`) hit real services and run serially — they
wipe the database between files. The integration suite *is* the conformance suite: the
same tests run against whichever adapter `DB_BACKEND` selects, and nothing is renamed
per backend. The embedding suite (`tests/integration/embedding/`) and the AI suite
(`tests/integration/ai/`) are separate because they configure live providers, while the
plain integration suite's feature-disabled assertions depend on running with *no*
provider configured.

The embedding suite auto-skips when Ollama is unavailable. The AI suite skips unless
`AI_TEST=1` is set *and* the configured model answers — see [The AI
gate](#the-ai-gate). The integration suite does neither: it requires a running database
and fails loudly by design when the selected one is down.

`npm run typecheck` runs the TypeScript compiler without emitting.

## Integration Test Requirements

### The two databases

The dev compose file carries both databases. PostgreSQL — the default — starts with:

```bash
docker compose up -d
```

A Neo4j run additionally needs the `neo4j` service block in `docker-compose.yml`
uncommented; both databases run side by side with no port conflicts.

### Selecting the adapter

- **PostgreSQL (the default):** no `.env` needed — the built-in defaults
  (`DB_BACKEND=postgres`, `postgresql://localhost:5432/ontoforge`) match the dev
  compose service.
- **Neo4j:** set the four values explicitly in `server/.env`:

  ```
  DB_BACKEND=neo4j
  DB_URI=bolt://localhost:7687
  DB_USER=neo4j
  DB_PASSWORD=ontoforge_dev
  ```

Run the embedding suite on both adapters whenever search behaviour is touched.

### Ollama (Embedding)

Required by the embedding suite:

```bash
ollama pull nomic-embed-text
```

### The AI gate

The AI suite drives a **real** language model through whatever `AI_PROVIDER` names — so
against a paid endpoint every run costs money. It therefore never runs unless asked:

```bash
AI_TEST=1 npm run test:integration:ai
```

`AI_TEST` is the only switch. Provider, model, base URL and key all come from the
ordinary `AI_*` variables in the active env file, so the suite tests the provider you
have actually configured. It is a test-only variable: it is read straight from
`process.env` in the suite's `support.ts` and is absent from `Settings`, so nothing in
`src/` can see it.

`server/.env` carries it as `AI_TEST=0`. Arm it per run on the command line, as above —
a shell variable wins over the env file — rather than editing the file, so paid runs
stay deliberate.

The suite skips with a message naming the exact cause and fix when `AI_TEST` is unset,
when no provider is configured, or when the endpoint does not list `AI_MODEL`. It
probes the OpenAI-compatible listing at `{AI_BASE_URL}/v1/models`, which OpenRouter and
Ollama's compatibility layer both serve.

The model must support **tool calling** (function calling); not all do. For a local
Ollama run, `env/ollama.env` is already configured — `ollama pull qwen3:8b` (or
whichever `AI_MODEL` names).

**Note on AI test flakiness:** AI integration tests interact with a real LLM, so results
are non-deterministic. Tests are written to validate structure and basic correctness
rather than exact output. Occasional failures from LLM variability are expected — re-run
before investigating.

### Running Everything

```bash
# 1. Start the database
docker compose up -d

# 2. Ensure Ollama models are available
ollama pull nomic-embed-text
ollama pull qwen3:8b

# 3. Run the suites
npm test
npm run test:integration
npm run test:integration:embedding
AI_TEST=1 npm run test:integration:ai
```

## Writing Tests

### Unit Tests

- Place in `tests/` subdirectories matching the module structure (`modeling/`,
  `runtime/`, `mcp/`, `core/`, `adapters/`)
- Mock at the adapter boundary — never hit a real database
- Shared schema fixtures live in `tests/fixtures/`

### Integration Tests

- Place in `tests/integration/` — plain suite, or `embedding/` / `ai/` when the test
  configures a live provider
- Adapter-specific tests live in per-adapter folders beside the shared files —
  `tests/integration/neo4j/`, `tests/integration/postgres/`,
  `tests/integration/embedding/neo4j/`, and the adapter-internal unit folders
  `tests/adapters/neo4j/` and `tests/adapters/postgres/` — gated so they skip when the
  other backend is selected. The store-error and vector-drift tests among them
  deliberately reach past the persistence port: inducing a genuine driver failure means
  putting the database into a state the code never produces on its own.
- The embedding and AI suites include availability checks that skip when their provider
  is down (see each suite's `support.ts`)
- Create and clean up test data (ontologies, entities) within fixtures
- Set configuration overrides in setup and restore them in teardown

### Vitest Configuration

One config per suite: `vitest.config.ts` (unit), `vitest.integration.config.ts`,
`vitest.integration.embedding.config.ts`, `vitest.integration.ai.config.ts`. The unit
config excludes `tests/integration/`, so `npm test` needs no services; the integration
configs run files serially (`fileParallelism: false`) because the suites wipe the
database and mutate global provider state.
