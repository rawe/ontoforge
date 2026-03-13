#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
# ]
# ///
"""Export an OntoForge ontology schema to a JSON file via the Modeling REST API."""

import argparse
import json
import os
import sys
from pathlib import Path

import httpx


def resolve_base_url(cli_value: str | None) -> str:
    if cli_value:
        return cli_value.rstrip("/")
    return os.environ.get("ONTOFORGE_BASE_URL", "http://localhost:8000").rstrip("/")


def find_ontology_id(client: httpx.Client, base_url: str, ontology_key: str) -> str:
    """Look up the ontology UUID by key."""
    resp = client.get(f"{base_url}/api/model/ontologies")
    resp.raise_for_status()
    for ont in resp.json():
        if ont["key"] == ontology_key:
            return ont["ontologyId"]
    print(f"Error: ontology with key '{ontology_key}' not found", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export an OntoForge ontology schema to a JSON file.",
    )
    parser.add_argument("ontology_key", help="Ontology key (e.g. my_ontology)")
    parser.add_argument(
        "-o", "--output",
        help="Output file path (default: ./ontology/<ontology_key>.json)",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="OntoForge server URL (default: ONTOFORGE_BASE_URL or http://localhost:8000)",
    )
    args = parser.parse_args()

    base_url = resolve_base_url(args.base_url)
    output = Path(args.output) if args.output else Path("ontology") / f"{args.ontology_key}.json"

    try:
        with httpx.Client(timeout=30) as client:
            ontology_id = find_ontology_id(client, base_url, args.ontology_key)
            resp = client.get(f"{base_url}/api/model/ontologies/{ontology_id}/export")
            resp.raise_for_status()
            payload = resp.json()

        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        print(output)

    except httpx.ConnectError:
        print(f"Error: cannot connect to {base_url}", file=sys.stderr)
        sys.exit(1)
    except httpx.HTTPStatusError as e:
        print(f"Error: API returned {e.response.status_code}: {e.response.text}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
