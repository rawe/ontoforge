# Testing

> How to run and write tests for OntoForge.

## Test Suites

All commands are run from `server/`.

| Command | Suite | External deps |
|---|---|---|
| `npm test` | Unit | None |
| `npm run test:integration` | Integration | Neo4j |
| `npm run test:integration:embedding` | Semantic search | Neo4j + Ollama (embedding model) |
| `npm run test:integration:ai` | AI (slow, real model) | Neo4j + Ollama (tool-calling model) |

**Unit tests** (`tests/`, excluding `tests/integration/`) mock all external
dependencies (Neo4j driver, embedding providers, AI models). They run fast and require
no infrastructure.

**Integration tests** (`tests/integration/`) hit real services and run serially — they
wipe the database between files. The embedding suite (`tests/integration/embedding/`)
and the AI suite (`tests/integration/ai/`) are separate because they configure live
providers, while the plain integration suite's feature-disabled assertions depend on
running with *no* provider configured.

`npm run typecheck` runs the TypeScript compiler without emitting.

## Integration Test Requirements

Tests auto-skip when their required services are unavailable.

### Neo4j

Required by all integration suites:

```bash
docker compose up -d
```

Default connection: `bolt://localhost:7687` (user: `neo4j`, password: `ontoforge_dev`)

The store-error and vector-index-drift tests deliberately reach past the persistence
port — inducing a genuine driver failure means putting the database into a state the
code never produces on its own. They are the only adapter-specific tests.

### Ollama (Embedding)

Required by the embedding suite:

```bash
ollama pull nomic-embed-text
```

### Ollama (AI / Tool Calling)

Required by the AI suite:

```bash
ollama pull qwen3:8b
```

AI tests need a model that supports **tool calling** (function calling); not all Ollama
models do. The suite uses the `AI_MODEL` default from `src/config.ts` (`qwen3:8b`).

**Note on AI test flakiness:** AI integration tests interact with a real LLM, so results
are non-deterministic. Tests are written to validate structure and basic correctness
rather than exact output. Occasional failures from LLM variability are expected — re-run
before investigating.

### Running Everything

```bash
# 1. Start Neo4j
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
- Include availability checks that skip when services are down (see each suite's
  `support.ts`)
- Create and clean up test data (ontologies, entities) within fixtures
- Set configuration overrides in setup and restore them in teardown

### Vitest Configuration

One config per suite: `vitest.config.ts` (unit), `vitest.integration.config.ts`,
`vitest.integration.embedding.config.ts`, `vitest.integration.ai.config.ts`. The unit
config excludes `tests/integration/`, so `npm test` needs no services; the integration
configs run files serially (`fileParallelism: false`) because the suites wipe the
database and mutate global provider state.
