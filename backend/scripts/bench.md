# Runtime API Benchmark

Measures round-trip latency of the runtime REST API against a live Neo4j instance.

## Workflow

Every benchmark run requires three phases in order. Skipping or reordering phases invalidates results.

### Phase 1: Fresh infrastructure

Start from a clean Neo4j — no leftover data from previous runs. Without this, results are not comparable across branches.

```bash
# From repo root
docker compose down -v          # remove container AND volume
docker compose up -d            # start fresh Neo4j
```

Wait until Neo4j is ready (check `docker compose logs -f` for "Started.").

Then start the backend:

```bash
cd backend
uv run uvicorn ontoforge_server.main:app --host 0.0.0.0 --port 8000
```

### Phase 2: Schema setup

Import the test fixture into the fresh database:

```bash
cd backend
uv run python scripts/bench-setup.py
```

This imports `tests/fixtures/test_ontology.json` via `POST /api/model/import` and verifies the runtime schema is accessible. The fixture format may differ across branches — the setup script handles whatever format the current branch provides.

### Phase 3: Benchmark

```bash
cd backend
uv run python scripts/bench.py              # 30 iterations (default)
uv run python scripts/bench.py -n 100       # more iterations for stable p95
uv run python scripts/bench.py --compare    # show delta against baseline/previous
```

The benchmark only uses the runtime API (`/api/runtime/...`). It discovers the schema dynamically — no hardcoded property names.

Results are saved to `scripts/.bench-results.json` (gitignored).

## Cross-branch comparison

To compare runtime performance between branches (e.g. main vs. a feature branch):

```bash
# 1. Benchmark the baseline branch
git checkout main
docker compose down -v && docker compose up -d
# start server, wait for ready
uv run python scripts/bench-setup.py
uv run python scripts/bench.py -n 50
cp scripts/.bench-results.json scripts/.bench-baseline.json

# 2. Benchmark the feature branch (fresh Neo4j!)
git checkout feature/my-branch
docker compose down -v && docker compose up -d
# start server, wait for ready
uv run python scripts/bench-setup.py
uv run python scripts/bench.py -n 50 --compare
```

With `--compare`, the script looks for `.bench-baseline.json` first, then falls back to `.bench-results.json`. The delta column shows the difference:

```
Operation                        min        avg   ...           Δ avg
──────────────────────────────────────────────────────────────────────
entity create                   5.31       6.52   ...   -1.8ms (-21%)
```

## What it measures

| Operation | Endpoint |
|---|---|
| entity create | `POST /api/runtime/{key}/entities/{type}` |
| entity get | `GET /api/runtime/{key}/entities/{type}/{id}` |
| entity list | `GET /api/runtime/{key}/entities/{type}?limit=50` |
| entity update | `PATCH /api/runtime/{key}/entities/{type}/{id}` |
| entity delete | `DELETE /api/runtime/{key}/entities/{type}/{id}` |
| relation create | `POST /api/runtime/{key}/relations/{type}` |
| relation get | `GET /api/runtime/{key}/relations/{type}/{id}` |
| relation list | `GET /api/runtime/{key}/relations/{type}?limit=50` |
| relation delete | `DELETE /api/runtime/{key}/relations/{type}/{id}` |
| neighbors | `GET /api/runtime/{key}/entities/{type}/{id}/neighbors` |

## Extending

Add entity or relation types to `tests/fixtures/test_ontology.json`, then add a `bench_*` function in `bench.py` and wire it into `run()`.
