# Testing

> How to run and write tests for OntoForge.

## Test Suites

All commands are run from `server/`.

| Command | Suite | External deps |
|---|---|---|
| `npm test` | Unit | None |
| `npm run test:integration` | Integration | The test database |
| `npm run test:integration:embedding` | Semantic search | The test database + Ollama (embedding model) |
| `npm run test:integration:ai` | AI (slow, real model) | The test database + Ollama (tool-calling model) |

**Unit tests** (`tests/`, excluding `tests/integration/`) mock all external
dependencies (database drivers, embedding providers, AI models). They run fast and
require no infrastructure — but they still read `env/test.env`, because some assert that
the capability flags are false, which only holds with no provider configured.

**Integration tests** (`tests/integration/`) hit real services and run serially — they
wipe the database between files. The integration suite *is* the conformance suite: the
same tests run against whichever adapter `DB_BACKEND` selects, and nothing is renamed
per backend. The embedding suite (`tests/integration/embedding/`) and the AI suite
(`tests/integration/ai/`) are separate because they configure live providers, while the
plain integration suite's feature-disabled assertions depend on running with *no*
provider configured.

The embedding and AI suites auto-skip when their provider is unavailable, naming the
cause. The integration suite does not: it requires a running database and fails loudly by
design when the selected one is down.

`npm run typecheck` runs the TypeScript compiler without emitting.

## Integration Test Requirements

### The two databases

The dev compose file carries both databases. PostgreSQL — the default — starts with:

```bash
docker compose up -d
```

A Neo4j run additionally needs the `neo4j` service block in `docker-compose.yml`
uncommented; both databases run side by side with no port conflicts.

### The test database

Every integration suite reads its own env file — `env/test.env`,
`env/test-embedding.env`, `env/test-ai.env` — named by the npm script. `server/.env` is
never read by a test.

All three point at `ontoforge_test` in the dev compose container, a database of its own.
The suite-level hard reset drops and recreates it, so it is created on the first run and
your development database is never touched.

### Selecting the adapter

- **PostgreSQL (the default):** what the three test presets configure.
- **Neo4j:** change the four `DB_*` values in the test preset you are running, or copy it
  to an uncommitted `env/*.local.env` and name that file:

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

### Testing a paid AI provider

`env/test-ai.env` names a local Ollama model and carries no credential, so the default
run is free. The AI suite drives a **real** language model, so against a paid endpoint
every run costs money — which is why no committed preset can reach one.

To test a paid provider, copy the preset to an uncommitted local file, put the provider
and key there, and name it for that run:

```bash
cp env/test-ai.env env/test-ai.local.env    # then edit in your provider and key
ENV_FILE=../env/test-ai.local.env npm run test:integration:ai
```

`env/*.local.env` is gitignored. **Never put a key in a file under `env/` itself** — that
directory is committed. Each `test:integration*` script defaults its `ENV_FILE` with
`${ENV_FILE:-…}`, so a value from your shell wins over the preset.

The suite probes the OpenAI-compatible listing at `{AI_BASE_URL}/v1/models` — served by
OpenRouter and by Ollama's compatibility layer — and skips with a message naming the
cause when no provider is configured, the endpoint is unreachable, or it does not list
`AI_MODEL`.

The model must support **tool calling** (function calling); not all do. For the default
Ollama run: `ollama pull qwen3:8b`.

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
npm run test:integration:ai
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
