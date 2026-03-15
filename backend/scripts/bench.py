#!/usr/bin/env python3
"""Runtime REST API performance benchmark.

Measures round-trip latency of runtime CRUD endpoints.
Requires a running server with the benchmark schema already imported
(see bench-setup.py).

Usage:
    uv run python scripts/bench.py
    uv run python scripts/bench.py -n 50
    uv run python scripts/bench.py --compare
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import httpx

RESULTS_DIR = Path(__file__).parent
RESULTS_FILE = RESULTS_DIR / ".bench-results.json"
BASELINE_FILE = RESULTS_DIR / ".bench-baseline.json"

ONTOLOGY_KEY = "test_ontology"

# Sample values by data type for generating test payloads
SAMPLE_VALUES = {
    "string": lambda i: f"bench_{i}",
    "integer": lambda i: 20 + (i % 50),
    "boolean": lambda i: i % 2 == 0,
    "float": lambda i: round(1.5 + i * 0.1, 2),
    "date": lambda _: "2025-01-15",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def timed(fn):
    """Call fn(), return (elapsed_ms, result)."""
    start = time.perf_counter()
    result = fn()
    elapsed = (time.perf_counter() - start) * 1000
    return elapsed, result


def stats(timings: list[float]) -> dict:
    s = sorted(timings)
    n = len(s)
    return {
        "min": round(s[0], 2),
        "avg": round(statistics.mean(s), 2),
        "p50": round(s[n // 2], 2),
        "p95": round(s[int(n * 0.95)], 2) if n >= 20 else round(s[-1], 2),
        "max": round(s[-1], 2),
    }


def fmt_delta(current: float, previous: float) -> str:
    diff = current - previous
    pct = (diff / previous) * 100 if previous else 0
    sign = "+" if diff > 0 else ""
    return f"{sign}{diff:+.1f}ms ({sign}{pct:.0f}%)"


def make_entity_body(props: list[dict], index: int) -> dict:
    body = {}
    for p in props:
        gen = SAMPLE_VALUES.get(p["dataType"], SAMPLE_VALUES["string"])
        body[p["key"]] = gen(index)
    return body


def make_update_body(props: list[dict], index: int) -> dict:
    candidates = [p for p in props if not p.get("required")] or props[:1]
    if not candidates:
        return {}
    p = candidates[0]
    gen = SAMPLE_VALUES.get(p["dataType"], SAMPLE_VALUES["string"])
    return {p["key"]: gen(index + 100)}


# ---------------------------------------------------------------------------
# Schema discovery (runtime API only)
# ---------------------------------------------------------------------------


def load_schema(client: httpx.Client) -> dict:
    """Load the runtime schema. Exits if not available."""
    resp = client.get(f"/api/runtime/{ONTOLOGY_KEY}/schema")
    if resp.status_code != 200:
        print(
            f"Ontology '{ONTOLOGY_KEY}' not found. Run bench-setup.py first.",
            file=sys.stderr,
        )
        sys.exit(1)

    schema = resp.json()
    et_map = {et["key"]: et for et in schema.get("entityTypes", [])}
    rt_map = {rt["key"]: rt for rt in schema.get("relationTypes", [])}

    # Find entity pair connected by a relation
    entity_key = target_key = relation_key = None
    for rt in schema.get("relationTypes", []):
        src = rt.get("fromEntityTypeKey")
        tgt = rt.get("toEntityTypeKey")
        if src in et_map and tgt in et_map and src != tgt:
            entity_key, target_key, relation_key = src, tgt, rt["key"]
            break

    if not entity_key:
        keys = list(et_map.keys())
        entity_key = keys[0] if keys else None
        target_key = keys[1] if len(keys) > 1 else None

    return {
        "entity_key": entity_key,
        "entity_props": et_map.get(entity_key, {}).get("properties", []),
        "target_key": target_key,
        "target_props": et_map.get(target_key, {}).get("properties", []),
        "relation_key": relation_key,
        "relation_props": rt_map.get(relation_key, {}).get("properties", []) if relation_key else [],
    }


# ---------------------------------------------------------------------------
# Benchmark operations (runtime API only)
# ---------------------------------------------------------------------------


def bench_entity_create(client, n, entity_key, props):
    results = []
    for i in range(n):
        body = make_entity_body(props, i)
        elapsed, resp = timed(
            lambda b=body: client.post(f"/api/runtime/{ONTOLOGY_KEY}/entities/{entity_key}", json=b)
        )
        assert resp.status_code == 201, f"Create failed: {resp.status_code} {resp.text}"
        results.append((elapsed, resp.json()["_id"]))
    return results


def bench_entity_get(client, entity_key, entity_ids):
    timings = []
    for eid in entity_ids:
        elapsed, resp = timed(
            lambda eid=eid: client.get(f"/api/runtime/{ONTOLOGY_KEY}/entities/{entity_key}/{eid}")
        )
        assert resp.status_code == 200
        timings.append(elapsed)
    return timings


def bench_entity_list(client, entity_key, n):
    timings = []
    for _ in range(n):
        elapsed, resp = timed(
            lambda: client.get(f"/api/runtime/{ONTOLOGY_KEY}/entities/{entity_key}", params={"limit": 50})
        )
        assert resp.status_code == 200
        timings.append(elapsed)
    return timings


def bench_entity_update(client, entity_key, entity_ids, props):
    timings = []
    for i, eid in enumerate(entity_ids):
        body = make_update_body(props, i)
        if not body:
            continue
        elapsed, resp = timed(
            lambda eid=eid, b=body: client.patch(
                f"/api/runtime/{ONTOLOGY_KEY}/entities/{entity_key}/{eid}", json=b
            )
        )
        assert resp.status_code == 200
        timings.append(elapsed)
    return timings


def bench_entity_delete(client, entity_key, entity_ids):
    timings = []
    for eid in entity_ids:
        elapsed, resp = timed(
            lambda eid=eid: client.delete(f"/api/runtime/{ONTOLOGY_KEY}/entities/{entity_key}/{eid}")
        )
        assert resp.status_code == 204
        timings.append(elapsed)
    return timings


def bench_relation_create(client, relation_key, source_ids, target_id, props):
    results = []
    for i, sid in enumerate(source_ids):
        body = {"fromEntityId": sid, "toEntityId": target_id}
        for p in props:
            gen = SAMPLE_VALUES.get(p["dataType"], SAMPLE_VALUES["string"])
            body[p["key"]] = gen(i)
        elapsed, resp = timed(
            lambda b=body: client.post(f"/api/runtime/{ONTOLOGY_KEY}/relations/{relation_key}", json=b)
        )
        assert resp.status_code == 201, f"Relation create failed: {resp.status_code} {resp.text}"
        results.append((elapsed, resp.json()["_id"]))
    return results


def bench_relation_get(client, relation_key, relation_ids):
    timings = []
    for rid in relation_ids:
        elapsed, resp = timed(
            lambda rid=rid: client.get(f"/api/runtime/{ONTOLOGY_KEY}/relations/{relation_key}/{rid}")
        )
        assert resp.status_code == 200
        timings.append(elapsed)
    return timings


def bench_relation_list(client, relation_key, n):
    timings = []
    for _ in range(n):
        elapsed, resp = timed(
            lambda: client.get(f"/api/runtime/{ONTOLOGY_KEY}/relations/{relation_key}", params={"limit": 50})
        )
        assert resp.status_code == 200
        timings.append(elapsed)
    return timings


def bench_neighbors(client, entity_key, entity_ids):
    timings = []
    for eid in entity_ids:
        elapsed, resp = timed(
            lambda eid=eid: client.get(f"/api/runtime/{ONTOLOGY_KEY}/entities/{entity_key}/{eid}/neighbors")
        )
        assert resp.status_code == 200
        timings.append(elapsed)
    return timings


def bench_relation_delete(client, relation_key, relation_ids):
    timings = []
    for rid in relation_ids:
        elapsed, resp = timed(
            lambda rid=rid: client.delete(f"/api/runtime/{ONTOLOGY_KEY}/relations/{relation_key}/{rid}")
        )
        assert resp.status_code == 204
        timings.append(elapsed)
    return timings


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

COL_W = 10


def print_table(results: dict[str, dict], previous: dict[str, dict] | None = None):
    header = f"{'Operation':<25} {'min':>{COL_W}} {'avg':>{COL_W}} {'p50':>{COL_W}} {'p95':>{COL_W}} {'max':>{COL_W}}"
    if previous:
        header += f"  {'Δ avg':>16}"
    print()
    print(header)
    print("─" * len(header))

    for op, s in results.items():
        row = f"{op:<25} {s['min']:>{COL_W}.2f} {s['avg']:>{COL_W}.2f} {s['p50']:>{COL_W}.2f} {s['p95']:>{COL_W}.2f} {s['max']:>{COL_W}.2f}"
        if previous and op in previous:
            row += f"  {fmt_delta(s['avg'], previous[op]['avg']):>16}"
        print(row)

    print()
    print("  All times in milliseconds (ms).")


def save_results(results: dict[str, dict]):
    RESULTS_FILE.write_text(json.dumps(results, indent=2) + "\n")
    print(f"  Results saved to {RESULTS_FILE.name}")


def load_previous() -> dict[str, dict] | None:
    if BASELINE_FILE.exists():
        return json.loads(BASELINE_FILE.read_text())
    if RESULTS_FILE.exists():
        return json.loads(RESULTS_FILE.read_text())
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run(base_url: str, n: int, compare: bool):
    client = httpx.Client(base_url=base_url, timeout=30)

    # Verify server is reachable
    try:
        client.get(f"/api/runtime/{ONTOLOGY_KEY}/schema").raise_for_status()
    except httpx.HTTPError:
        print(
            f"Cannot reach runtime schema at {base_url}. Is the server running "
            f"and was bench-setup.py executed?",
            file=sys.stderr,
        )
        sys.exit(1)

    schema = load_schema(client)
    ek = schema["entity_key"]
    tk = schema["target_key"]
    rk = schema["relation_key"]

    print(f"Benchmark: {n} iterations against {base_url}")
    print(f"  Schema: {ek} --[{rk}]--> {tk}")
    print(f"  {ek} props: {[p['key'] for p in schema['entity_props']]}")
    if schema["relation_props"]:
        print(f"  {rk} props: {[p['key'] for p in schema['relation_props']]}")

    # Create a target entity for relations
    target_body = make_entity_body(schema["target_props"], 0)
    resp = client.post(f"/api/runtime/{ONTOLOGY_KEY}/entities/{tk}", json=target_body)
    assert resp.status_code == 201, f"Target create failed: {resp.status_code} {resp.text}"
    target_id = resp.json()["_id"]

    results: dict[str, dict] = {}

    try:
        print("\nRunning benchmarks...")

        print(f"  entity create (×{n})")
        create_results = bench_entity_create(client, n, ek, schema["entity_props"])
        results["entity create"] = stats([t for t, _ in create_results])
        entity_ids = [eid for _, eid in create_results]

        print(f"  entity get (×{n})")
        results["entity get"] = stats(bench_entity_get(client, ek, entity_ids))

        print(f"  entity list (×{n})")
        results["entity list"] = stats(bench_entity_list(client, ek, n))

        print(f"  entity update (×{n})")
        results["entity update"] = stats(bench_entity_update(client, ek, entity_ids, schema["entity_props"]))

        if rk:
            print(f"  relation create (×{n})")
            rel_results = bench_relation_create(client, rk, entity_ids, target_id, schema["relation_props"])
            results["relation create"] = stats([t for t, _ in rel_results])
            relation_ids = [rid for _, rid in rel_results]

            print(f"  relation get (×{n})")
            results["relation get"] = stats(bench_relation_get(client, rk, relation_ids))

            print(f"  relation list (×{n})")
            results["relation list"] = stats(bench_relation_list(client, rk, n))

            print(f"  neighbors (×{n})")
            results["neighbors"] = stats(bench_neighbors(client, ek, entity_ids))

            print(f"  relation delete (×{n})")
            results["relation delete"] = stats(bench_relation_delete(client, rk, relation_ids))

        print(f"  entity delete (×{n})")
        results["entity delete"] = stats(bench_entity_delete(client, ek, entity_ids))

    finally:
        # Clean up benchmark data (not schema)
        client.delete(f"/api/runtime/{ONTOLOGY_KEY}/entities/{tk}/{target_id}")

    previous = load_previous() if compare else None
    print_table(results, previous)
    save_results(results)


def main():
    parser = argparse.ArgumentParser(description="OntoForge runtime API benchmark")
    parser.add_argument("-n", type=int, default=30, help="Iterations per operation (default: 30)")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Server base URL")
    parser.add_argument("--compare", action="store_true", help="Show delta against baseline or previous run")
    args = parser.parse_args()

    run(base_url=args.base_url, n=args.n, compare=args.compare)


if __name__ == "__main__":
    main()
