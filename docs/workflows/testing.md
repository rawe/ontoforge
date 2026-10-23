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
| `npm run test:integration:decision` | Decision HTTP contract | Local decision API; no database |
| `npm run test:integration:valkey` | Valkey shared state | The dev Valkey; no database |

**Unit tests** (`tests/`, excluding `tests/integration/`) mock all external
dependencies (database drivers, embedding providers, AI models). They run fast and
require no infrastructure — but they still read `env/test.env`, because some assert that
the capability flags are false, which only holds with no provider configured.

**Database integration tests** (`tests/integration/`, excluding `decision/`) hit real
services and run serially — they wipe the database between files. The integration suite *is* the conformance suite of the
persistence port: it runs against the adapter `DB_BACKEND` selects. The embedding suite (`tests/integration/embedding/`) and the AI suite
(`tests/integration/ai/`) are separate because they configure live providers, while the
plain integration suite's feature-disabled assertions depend on running with *no*
provider configured. Where the plain suite needs semantic entries — search-index storage,
the indexing pipeline, index search — it installs the deterministic fake embedding provider
of `tests/fakeEmbedding.ts` for the test and removes it afterwards, so it still needs no
Ollama. The AI suite's retriever tests run with no embedding provider: their indices
search by keyword.

The embedding and AI suites auto-skip when their provider is unavailable, naming the
cause. The integration suite does not: it requires a running database and fails loudly by
design when the selected one is down.

`npm run typecheck` runs the TypeScript compiler without emitting.

The decision suite uses `env/test.env` with an explicitly configured local Decision
API and its own test configuration, without database setup or reset. It sends synthetic
text and checks the wire contract, not model quality. The suite requires a loopback URL
and no credential; it does not load the TypeSafe example template.

```sh
DECISION_BASE_URL=http://localhost:8002 DECISION_MODEL=Mapika/decider-0.8b \
  DECISION_API_KEY= TYPESAFE_API_KEY= npm run test:integration:decision
```

The provider contract and configuration template are described in
[Decision API](../providers/decision-api.md).

The Valkey suite checks the shared-state connection — a wrong eviction policy, a Valkey that
may not run scripts, two scripts of one name — and runs the thread-store contract against a
real Valkey, plus what only Valkey can do to it: a flush, a restart or a full memory under a
running turn, a dropped connection. After every test each key it left must expire. It uses the Valkey
of `docker-compose.yml` (`docker compose up -d valkey`) in a logical database of its own,
which `env/test-valkey.env` names and the suite insists on: it flushes only that database
and restores the settings it changes, but it pauses and restarts the container, which
ends the conversations a dev server keeps there. Like the integration suite, it fails
loudly when its Valkey is down.

Behaviour across several servers sharing one database and one Valkey — a conversation
continued on another server, a server replaced or drained, a schema change seen
everywhere — is checked by the shared-state harness, `./dev.sh scale`
([scripts/scale/USAGE.md](../../scripts/scale/USAGE.md)).

## Integration Test Requirements

### The database

The dev compose file carries PostgreSQL. It starts with:

```bash
docker compose up -d
```

### The test database

Every integration suite reads its own env file — `env/test.env`,
`env/test-embedding.env`, `env/test-ai.env` — named by the npm script. `server/.env` is
never read by a test.

All three point at `ontoforge_test` in the dev compose container, a database of its own.
The suite-level hard reset drops and recreates it, so it is created on the first run and
your development database is never touched.

Run the embedding suite whenever search behaviour is touched.

### Ollama (Embedding)

Required by the embedding suite:

```bash
ollama pull bge-m3
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

The suite probes the provider's model listing — `{AI_BASE_URL}/models` for `openai`,
`{AI_BASE_URL}/v1/models` for an Ollama or Anthropic host — and skips with a message naming the
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
ollama pull bge-m3
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
- Adapter-specific tests live in an adapter folder beside the shared files —
  `tests/integration/postgres/` — and in the adapter-internal unit folder
  `tests/adapters/postgres/`, which mocks the driver. The
  store-error and vector-drift tests among them
  deliberately reach past the persistence port: inducing a genuine driver failure means
  putting the database into a state the code never produces on its own.
- The embedding and AI suites include availability checks that skip when their provider
  is down (see each suite's `support.ts`)
- Create and clean up test data (ontologies, entities) within fixtures
- Set configuration overrides in setup and restore them in teardown

### Vitest Configuration

One config per suite: `vitest.config.ts` (unit), `vitest.integration.config.ts`,
`vitest.integration.embedding.config.ts`, `vitest.integration.ai.config.ts`,
`vitest.integration.decision.config.ts` and `vitest.integration.valkey.config.ts` (both
without database hooks). The unit
config excludes `tests/integration/`, so `npm test` needs no services; the integration
configs run files serially (`fileParallelism: false`) because the suites wipe the
database and mutate global provider state.
