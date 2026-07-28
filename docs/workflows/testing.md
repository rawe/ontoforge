# Testing

> How to run and write tests for OntoForge.

## Test Types

| Type | Directory | External deps | Default run |
|------|-----------|---------------|-------------|
| **Unit** | `tests/` (excl. `integration/`) | None | Yes |
| **Integration** | `tests/integration/` | Neo4j, Ollama, etc. | No (opt-in) |

**Unit tests** mock all external dependencies (Neo4j driver, embedding providers, AI models). They run fast and require no infrastructure.

**Integration tests** hit real services. They are marked with `@pytest.mark.integration` and excluded from default runs.

## Running Tests

All commands are run from `backend/`.

```bash
# Unit tests only (default — integration tests excluded)
uv run pytest

# Integration tests only
uv run pytest -m integration

# All tests (unit + integration)
uv run pytest -m ""

# Specific test file
uv run pytest tests/integration/test_ai.py -v

# Verbose with output
uv run pytest -v -s
```

## Integration Test Requirements

Integration tests require external services to be running. Tests auto-skip when their required services are unavailable.

### Neo4j

Required by all five integration modules:

| Module | Also needs |
|---|---|
| `test_semantic_search.py` | embedding model |
| `test_ai.py` | tool-calling model |
| `test_store_errors.py` | embedding model |
| `test_vector_index_drift.py` | embedding model |
| `test_reserved_type_keys.py` | — |

```bash
docker compose up -d
```

Default connection: `bolt://localhost:7687` (user: `neo4j`, password: `ontoforge_dev`)

`test_store_errors.py` and `test_vector_index_drift.py` deliberately reach past the
persistence port — inducing a genuine driver failure means putting the database into a
state the code never produces on its own. They are the only adapter-specific tests.

### Ollama (Embedding)

Required by: `test_semantic_search.py`, `test_store_errors.py`, `test_vector_index_drift.py`

```bash
ollama pull nomic-embed-text
```

The embedding model (`nomic-embed-text`) must be pulled. Tests check for availability and skip if the model is missing.

### Ollama (AI / Tool Calling)

Required by: `test_ai.py`

```bash
ollama pull qwen3:14b
```

AI integration tests need a model that supports **tool calling** (function calling). Not all Ollama models support this. Verified models:

- `qwen3:14b` — what the tests pin, good tool calling
- `qwen3:8b` — the server default; smaller and faster, less reliable under tool use
- `llama3.1` — works but less reliable for structured output

The model name is defined in `tests/integration/test_ai.py` as `AI_MODEL`. Changing it
there is the only place it needs changing.

**Note on AI test flakiness:** AI integration tests interact with a real LLM, so results are non-deterministic. Tests are written to validate structure and basic correctness rather than exact output. Occasional failures from LLM variability are expected — re-run before investigating.

### Running All Integration Tests

```bash
# 1. Start Neo4j
docker compose up -d

# 2. Ensure Ollama models are available
ollama pull nomic-embed-text
ollama pull qwen3:14b

# 3. Run integration tests
uv run pytest -m integration -v
```

## Writing Tests

### Unit Tests

- Place in `tests/` subdirectories matching the module structure (`modeling/`, `runtime/`, etc.)
- Use the `mock_driver` and `client` fixtures from `tests/conftest.py`
- Mock the adapter query modules (`adapters.neo4j.modeling_queries` / `runtime_queries`) — never hit a real database
- See `tests/runtime/conftest.py` for schema fixtures

### Integration Tests

- Place in `tests/integration/`
- Always add `pytestmark = pytest.mark.integration`
- Include availability checks that `pytest.skip()` when services are down
- Create and clean up test data (ontologies, entities) within fixtures
- Set configuration overrides in fixtures and restore in teardown

### Pytest Configuration

Defined in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
markers = [
    "integration: requires external services (Neo4j, Ollama, etc.)",
]
addopts = "-m 'not integration'"
```

The `addopts` line ensures `uv run pytest` runs only unit tests by default. Use `-m integration` or `-m ""` to include integration tests.
