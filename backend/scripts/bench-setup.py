#!/usr/bin/env python3
"""Set up the benchmark schema by importing the test fixture.

Imports tests/fixtures/test_ontology.json via POST /api/model/import.
Verifies the runtime schema is accessible afterwards.

Usage:
    uv run python scripts/bench-setup.py
    uv run python scripts/bench-setup.py --base-url http://host:8000
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx

FIXTURE = Path(__file__).parent / "../tests/fixtures/test_ontology.json"
ONTOLOGY_KEY = "test_ontology"


def main():
    parser = argparse.ArgumentParser(description="Import benchmark schema")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Server base URL")
    args = parser.parse_args()

    client = httpx.Client(base_url=args.base_url, timeout=30)

    # 1. Verify server is reachable
    try:
        client.get("/api/model/ontologies").raise_for_status()
    except httpx.HTTPError as e:
        print(f"Cannot reach server at {args.base_url}: {e}", file=sys.stderr)
        sys.exit(1)

    # 2. Check if schema already exists
    resp = client.get(f"/api/runtime/{ONTOLOGY_KEY}/schema")
    if resp.status_code == 200:
        schema = resp.json()
        et_keys = [et["key"] for et in schema.get("entityTypes", [])]
        rt_keys = [rt["key"] for rt in schema.get("relationTypes", [])]
        print(f"Schema already exists: {et_keys} / {rt_keys}")
        print("Ready for benchmarking.")
        return

    # 3. Import fixture
    payload = json.loads(FIXTURE.read_text())
    fmt = payload.get("formatVersion", "?")
    print(f"Importing {FIXTURE.name} (format {fmt})...")

    resp = client.post("/api/model/import", json=payload)
    if resp.status_code != 201:
        print(f"Import failed ({resp.status_code}): {resp.text}", file=sys.stderr)
        sys.exit(1)

    # 4. Verify runtime schema is accessible
    resp = client.get(f"/api/runtime/{ONTOLOGY_KEY}/schema")
    if resp.status_code != 200:
        print(f"Schema imported but runtime can't load it: {resp.text}", file=sys.stderr)
        sys.exit(1)

    schema = resp.json()
    et_keys = [et["key"] for et in schema.get("entityTypes", [])]
    rt_keys = [rt["key"] for rt in schema.get("relationTypes", [])]
    print(f"Schema ready: {et_keys} / {rt_keys}")
    print("Ready for benchmarking.")


if __name__ == "__main__":
    main()
